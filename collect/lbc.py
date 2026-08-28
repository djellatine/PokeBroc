#!/usr/bin/env python3
"""
Collecteur leboncoin — le seul morceau du projet qui ne soit pas en TypeScript.

Pourquoi un script séparé, et en Python
---------------------------------------
Leboncoin est derrière Datadome, qui n'inspecte pas l'en-tête `User-Agent` mais
l'empreinte du *handshake* TLS et de la négociation HTTP/2. Le `fetch` de Node
en produit une immédiatement reconnaissable : mesuré sur la page d'accueil,
403 systématique. `curl_cffi` rejoue l'empreinte exacte de Chrome, et passe.
Cette contrainte est la seule raison d'être de ce fichier : il fait ce que le
reste du code ne *peut* pas faire, et rien d'autre. Aucune notation, aucun
filtrage métier — `isPokemonLot`, `scoreLots` et `lotSize` restent en
TypeScript, où vivent déjà les règles des deux autres places de marché.

Ce qu'il produit
----------------
Un instantané `.data/lbc/recents.json` au format que `toLot()` attend déjà, lu
par `lib/lbc.ts`. Le script n'est jamais appelé par le site : il tourne sur
minuterie, et le site ne lit que le disque.

Ce que coûte une IP de centre de données
----------------------------------------
Cet en-tête a longtemps affirmé qu'un hébergeur « ferait tomber Datadome dès la
première requête ». C'était une intuition, pas une mesure, et elle est fausse.
Mesuré le 5 août 2026 depuis un runner GitHub (AS8075 Microsoft, Virginie) :
**six pages abouties**, 210 résultats récupérés, avant que Datadome escalade —
et l'escalade porte sur `new_session()`, c'est-à-dire que la page d'accueil
elle-même finit par rendre 403.

Le blocage est donc **graduel** : il existe un budget de requêtes toléré, plus
court depuis un centre de données que depuis la ligne d'un particulier. La même
collecte depuis une IP résidentielle enchaîne ses quatre requêtes et sa dizaine
de pages en 18,7 s sans incident.

Deux inconnues restent, et il ne faut pas conclure sans elles :

- le runner était **américain**, pour un site franco-français. Le pays et le
  centre de données ont changé ensemble ; rien ne dit lequel des deux pèse.
- `THROTTLE_S` vaut 2 s. Personne n'a mesuré si ralentir suffit à tenir dans le
  budget d'une IP d'hébergeur.

Tant que ces deux points ne sont pas tranchés, la minuterie tourne sur une
machine à IP résidentielle — non parce que c'est prouvé nécessaire, mais parce
que c'est la configuration dont on sait qu'elle marche.

Pourquoi l'API mobile n'est pas utilisée
----------------------------------------
`api.leboncoin.fr/finder/search` rendrait le même JSON sans les 400 Ko de HTML
autour. Mais il exige un `User-Agent` d'application mobile (`LBC;iOS;…`), qui
ne s'accorde avec aucune empreinte TLS de navigateur : Datadome refuse dès la
première requête. La route web porte les mêmes champs dans `__NEXT_DATA__`.

Usage
-----
    python collect/lbc.py                 # fenêtre de 3 h, écrit .data/lbc/
    python collect/lbc.py --window 6      # remonter plus loin
    python collect/lbc.py --dry-run       # n'écrit rien, résume sur la sortie
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import quote_plus
from zoneinfo import ZoneInfo

try:
    from curl_cffi import requests
except ImportError:  # pragma: no cover - dépend de l'environnement
    sys.exit("curl_cffi manquant : pip install curl_cffi tzdata")

# Lancé par le planificateur Windows, ce script hérite d'une sortie en cp1252,
# où « → » et les drapeaux des titres n'existent pas : un `UnicodeEncodeError`
# tuerait la collecte après l'avoir menée à bien. `errors="replace"` plutôt que
# `"strict"` — un caractère de remplacement dans un journal vaut mieux qu'un
# passage perdu.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# Miroir de RECENT_QUERIES dans lib/lots.ts, à une exception près : « lot
# pokemon » est écarté. Sans le mot « cartes », leboncoin rend surtout des
# peluches, des jouets et des vêtements — là où Vinted, dont le catalogue est
# déjà celui d'une brocante de mode, restait exploitable.
QUERIES = [
    "lot cartes pokemon",
    "vrac cartes pokemon",
    "collection cartes pokemon",
    "classeur cartes pokemon",
]

HOST = "https://www.leboncoin.fr"

# Le contrat avec `lib/lbc.ts` : il compose les requêtes, on dépose les
# annonces. Composer ici obligerait à redire en Python `searchName` et sa
# traduction des symboles (`☆` → « gold star »), que la moitié des cartes
# suivies utilise — et à les laisser diverger au premier ajustement.
QUERIES_NAME = "queries.json"
CARDS_NAME = "cartes.json"

# Trois pages couvrent environ trois heures de mises en ligne : mesuré à ~30
# annonces publiées par heure et par requête, pour 35 résultats par page. Le
# filtrage sur la fenêtre reste l'autorité — ceci n'est que le nombre de pages
# à demander pour ne pas la tronquer.
PAGES_PER_QUERY = 3

# Le tri par date de leboncoin porte sur `index_date`, donc sur la dernière
# *remontée* et non sur la mise en ligne : une annonce de deux mois republiée
# arrive en tête. Mesuré sur le flux réel, environ 13 % des résultats sont dans
# ce cas, dont une de 64 jours en première position. D'où la fenêtre, appliquée
# sur `first_publication_date`, seule date de publication réelle.
DEFAULT_WINDOW_H = 3.0

# Requêtes par carte jouées à chaque passage. Le tour complet se boucle donc en
# `ceil(cartes / SLICE)` passages — à 48 cartes suivies et un passage par quart
# d'heure, une heure. Interroger les 48 à chaque fois quadruplerait le trafic
# vers un site qui en refuse déjà une sur trois, pour des annonces qui
# apparaissent au rythme de quelques-unes par semaine et par carte.
CARD_SLICE = 12

# Une seule page par carte : la requête est discriminante et triée par date, et
# la page 2 remonte déjà à des mois. C'est le contraire des requêtes de lots,
# larges par construction, où trois pages couvrent trois heures.
CARD_PAGES = 1

THROTTLE_S = 2.0
TIMEOUT_S = 30.0
MAX_ATTEMPTS = 3

# Lignes conservées dans `collect.log`. Au quart d'heure, cela couvre environ
# deux jours — de quoi voir venir une dérive de Datadome. La valeur tenait
# trois semaines du temps des huit passages quotidiens ; c'est la cadence qui a
# changé, pas le besoin, et deux jours de recul suffisent à lire une escalade.
LOG_LINES = 200

PARIS = ZoneInfo("Europe/Paris")
NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)

# Les empreintes que curl_cffi sait rejouer, tirées au sort à chaque tentative :
# deux essais consécutifs ne présentent pas le même profil.
#
# La liste a longtemps été `["chrome", "chrome124", "edge101", "safari17_0"]`.
# Trois de ces quatre valeurs imitaient des navigateurs que plus personne ne
# fait tourner — `edge101` date d'avril 2022, `safari17_0` de septembre 2023 —
# et une empreinte rare est en elle-même un signal pour Datadome, qui compare à
# la distribution du trafic réel. Les douze cibles ci-dessous ont été vérifiées
# une à une contre la build de `curl_cffi` installée (0.16.0, 53 cibles) : une
# valeur inconnue lève à la création de la session, donc en pleine collecte.
#
# La proportion suit grossièrement le parc français : Chrome domine, Safari et
# Firefox suivent, Edge ferme la marche. Le journal note l'empreinte retenue —
# c'est ce qui permettra de trancher, dans deux cents passages, laquelle se
# fait refuser, au lieu de continuer à deviner.
IMPERSONATIONS = [
    "chrome",
    "chrome142",
    "chrome145",
    "chrome146",
    "firefox144",
    "firefox147",
    "safari184",
    "safari260",
    "edge",
]


class Blocked(RuntimeError):
    """Datadome a refusé la requête."""


def parse_date(raw: str | None) -> int | None:
    """`'2026-08-05 11:02:33'`, heure de Paris, vers un epoch en millisecondes.

    Le fuseau est explicite plutôt que laissé à l'horloge locale : la machine
    qui collecte n'est pas forcément réglée sur Paris, et un décalage d'une
    heure suffirait à vider la fenêtre de trois heures d'un tiers.
    """
    if not raw:
        return None
    try:
        naive = datetime.strptime(str(raw)[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return int(naive.replace(tzinfo=PARIS).timestamp() * 1000)


def attribute(ad: dict, key: str) -> str | None:
    """Valeur lisible d'un attribut leboncoin, qui les publie en liste."""
    for entry in ad.get("attributes") or []:
        if entry.get("key") == key:
            return entry.get("value_label") or entry.get("value")
    return None


def price_of(ad: dict) -> float | None:
    """Le prix est publié en liste — `[55]` — et parfois vide."""
    raw = ad.get("price")
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if raw is None:
        cents = ad.get("price_cents")
        return round(cents / 100, 2) if cents else None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def normalize(ad: dict) -> dict | None:
    """Une annonce leboncoin vers la forme `MarketItem` que `toLot()` attend.

    Rend `None` si l'annonce n'a ni identifiant ni titre : le reste du pipeline
    suppose les deux, et une entrée mutilée coûterait plus cher à filtrer en
    aval qu'à écarter ici.
    """
    list_id = ad.get("list_id")
    subject = (ad.get("subject") or "").strip()
    if not list_id or not subject:
        return None

    images = ad.get("images") or {}
    owner = ad.get("owner") or {}

    return {
        "id": list_id,
        "title": subject,
        "url": ad.get("url") or f"{HOST}/ad/collection/{list_id}",
        "thumbnail": images.get("small_url") or images.get("thumb_url"),
        "price": price_of(ad),
        # Les frais de port dépendent du mode de remise choisi à l'achat, que
        # l'annonce ne fixe pas : pas de prix total à annoncer ici. `toLot()`
        # retombe sur `price`.
        "totalPrice": None,
        "status": attribute(ad, "condition"),
        # « Urgent » et autres options payantes existent, mais ne remontent pas
        # dans le JSON de recherche. Aucune annonce n'est donc sponsorisée.
        "promoted": False,
        # leboncoin ne publie pas de compteur de favoris en recherche :
        # `counters` est un objet vide.
        "favourites": 0,
        "createdAt": parse_date(ad.get("first_publication_date")),
        "city": (ad.get("location") or {}).get("city"),
        "seller": owner.get("name"),
    }


def new_session(impersonate: str) -> requests.Session:
    """Session amorcée sur la page d'accueil, pour son cookie `datadome`.

    Attaquer `/recherche` directement, sans cookie, se solde par un 403.
    """
    session = requests.Session(impersonate=impersonate)
    session.headers.update({"Accept-Language": "fr-FR,fr;q=0.9"})
    response = session.get(HOST + "/", timeout=TIMEOUT_S)
    if response.status_code != 200:
        raise Blocked(f"amorçage refusé (HTTP {response.status_code})")
    return session


def open_session(verbose: bool) -> tuple[requests.Session, str]:
    """Une session amorcée, en changeant d'empreinte à chaque refus.

    L'amorçage n'avait droit à aucun rattrapage, là où une recherche bloquée en
    obtenait trois : un seul refus sur la page d'accueil perdait le passage
    entier, ses quatre requêtes et son instantané. C'était la cause principale
    des échecs — mesuré sur les deux cents passages du journal, du 25 au 29 août
    2026, 66 refus pour 134 réussites, soit un tiers.

    Ce tiers n'est pas un taux de blocage durable : c'est la probabilité qu'une
    requête *isolée* tombe mal. Les refus se comportent comme des tirages
    indépendants — une seule série de cinq sur deux cents passages, ce qu'un
    tirage à p=0,33 produit — donc trois tentatives sur trois empreintes
    différentes ramènent l'échec attendu autour de 4 %.

    `random.sample` plutôt que trois `choice` : réessayer la même empreinte qui
    vient d'être refusée ne rachète rien, et c'est justement ce que faisait la
    reprise en cours de boucle.
    """
    last: Blocked | None = None

    for attempt, impersonate in enumerate(random.sample(IMPERSONATIONS, MAX_ATTEMPTS), 1):
        try:
            return new_session(impersonate), impersonate
        except Blocked as error:
            last = error
            if verbose:
                print(f"  amorçage refusé sur « {impersonate} »", file=sys.stderr)
            if attempt < MAX_ATTEMPTS:
                # Laisser le compteur de Datadome retomber, comme le fait la
                # reprise d'une recherche bloquée.
                time.sleep(THROTTLE_S * 2 * attempt)

    assert last is not None
    raise last


def search(session: requests.Session, query: str, page: int) -> list[dict]:
    """Une page de résultats, triée du plus récemment remonté au plus ancien."""
    url = (
        f"{HOST}/recherche"
        f"?text={quote_plus(query)}"
        f"&sort=time&order=desc&page={page}"
    )
    response = session.get(url, timeout=TIMEOUT_S)

    if response.status_code in (403, 429):
        raise Blocked(f"HTTP {response.status_code} sur « {query} » page {page}")
    if response.status_code != 200:
        raise RuntimeError(f"HTTP {response.status_code} sur « {query} » page {page}")

    found = NEXT_DATA.search(response.text)
    if not found:
        raise RuntimeError(f"__NEXT_DATA__ absent sur « {query} » page {page}")

    payload = json.loads(found.group(1))
    return payload["props"]["pageProps"].get("searchData", {}).get("ads") or []


def collect(
    window_h: float, verbose: bool
) -> tuple[list[dict], list[str], str, requests.Session]:
    """Toutes les requêtes, dédupliquées, restreintes à la fenêtre.

    Les erreurs sont accumulées plutôt que propagées : une requête qui échoue
    ne doit pas vider l'instantané des trois autres, exactement comme une panne
    de Vinted ne doit pas emporter eBay dans `collectRecent`.
    """
    cutoff = (time.time() - window_h * 3600) * 1000
    session, impersonate = open_session(verbose)
    items: dict[int, dict] = {}
    problems: list[str] = []

    for query in QUERIES:
        for page in range(1, PAGES_PER_QUERY + 1):
            ads: list[dict] | None = None

            for attempt in range(1, MAX_ATTEMPTS + 1):
                try:
                    ads = search(session, query, page)
                    break
                except Blocked as error:
                    if attempt == MAX_ATTEMPTS:
                        problems.append(str(error))
                        break
                    # Une empreinte grillée le reste : on en reprend une autre
                    # plutôt que de réessayer la même. `open_session` porte
                    # l'attente et le changement d'empreinte ; son échec ne doit
                    # pas emporter le passage, puisque les requêtes déjà
                    # abouties valent un instantané partiel.
                    try:
                        session, impersonate = open_session(verbose)
                    except Blocked as reopen:
                        problems.append(str(reopen))
                        break
                except (RuntimeError, ValueError, KeyError) as error:
                    problems.append(str(error))
                    break

            if ads is None:
                continue

            fresh_on_page = 0
            for ad in ads:
                item = normalize(ad)
                if item is None:
                    continue
                if item["createdAt"] is None or item["createdAt"] < cutoff:
                    continue
                fresh_on_page += 1
                items.setdefault(item["id"], item)

            if verbose:
                print(
                    f"  « {query} » page {page} : "
                    f"{fresh_on_page}/{len(ads)} dans la fenêtre",
                    file=sys.stderr,
                )

            # La page est déjà entièrement hors fenêtre : les suivantes le
            # seront davantage, le tri étant décroissant. On arrête cette
            # requête là plutôt que de payer des pages inutiles.
            if fresh_on_page == 0 and ads:
                break

            time.sleep(THROTTLE_S)

    ordered = sorted(items.values(), key=lambda item: item["createdAt"], reverse=True)
    return ordered, problems, impersonate, session


def collect_cards(
    session: requests.Session,
    queries: list[dict],
    previous: dict,
    verbose: bool,
) -> tuple[dict, int, list[str]]:
    """Une tranche des cartes suivies, en repartant d'où le passage précédent
    s'était arrêté.

    Rend le dictionnaire complet — la tranche fraîche **par-dessus** ce qui
    était déjà là, et non à la place. Sans cela, une carte hors tranche perdrait
    ses annonces à chaque passage et n'en aurait qu'un quart d'heure par heure ;
    c'est la rotation qui économise les requêtes, pas l'oubli.

    Aucune notation ici : `scoreAll` décide en TypeScript, pour les trois places
    de marché par le même chemin. On dépose ce que leboncoin a rendu.
    """
    cards = dict(previous.get("cards") or {})
    offset = int(previous.get("offset") or 0)
    problems: list[str] = []

    if not queries:
        return cards, offset, problems

    offset %= len(queries)
    slice_ = [queries[(offset + i) % len(queries)] for i in range(min(CARD_SLICE, len(queries)))]
    now = int(time.time() * 1000)

    for entry in slice_:
        card_id, query = entry.get("cardId"), entry.get("query")
        if not card_id or not query:
            continue

        time.sleep(THROTTLE_S)
        try:
            ads = search(session, query, 1)
        except Blocked as error:
            # Le passage garde ce qu'il a. Une carte non rafraîchie conserve
            # ses annonces précédentes, que `LBC_CARD_MAX_AGE_MS` périmera si
            # le blocage dure — deux tours, soit un passage manqué absorbé.
            problems.append(str(error))
            continue
        except (RuntimeError, ValueError, KeyError) as error:
            problems.append(str(error))
            continue

        items = [item for item in (normalize(ad) for ad in ads) if item is not None]
        cards[card_id] = {"at": now, "items": items}

        if verbose:
            print(f"  {card_id} « {query} » : {len(items)} annonces", file=sys.stderr)

    return cards, (offset + len(slice_)) % len(queries), problems


def read_json(source: Path):
    """Le pendant de `write_atomic`, tolérant à l'absence.

    Un fichier manquant est le cas normal : `queries.json` n'existe pas tant
    que la veille n'a pas tourné une fois, et `cartes.json` pas avant le
    premier tour de rotation. Un fichier illisible l'est moins, mais il ne doit
    pas plus faire échouer la collecte des lots — au pire la rotation repart de
    zéro, ce qui coûte un tour.
    """
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_atomic(target: Path, payload: dict) -> None:
    """Écriture par fichier temporaire puis renommage.

    Même garantie que `writeJson` côté TypeScript, et pour la même raison : le
    site lit ce fichier pendant que la minuterie le réécrit, et une lecture ne
    doit jamais tomber sur un JSON tronqué.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(f".{uuid.uuid4()}.tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def journal(target: Path, message: str) -> None:
    """Trace d'exécution, à côté de l'instantané.

    Sans elle, un passage raté sous le planificateur ne laisse qu'un code de
    sortie — et un code de sortie ne dit pas *ce qui* a échoué. Windows publie
    d'ailleurs `2` pour « fichier introuvable », valeur que ce script emploie
    aussi pour « bloqué à l'amorçage » : impossible de les distinguer sans
    journal.

    Un journal qui échoue n'a jamais de raison de faire échouer une collecte
    réussie, d'où l'erreur avalée.
    """
    log = target.parent / "collect.log"
    stamp = datetime.now(PARIS).strftime("%Y-%m-%d %H:%M:%S")
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        previous = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
        kept = (previous + [f"{stamp}  {message}"])[-LOG_LINES:]
        log.write_text("\n".join(kept) + "\n", encoding="utf-8")
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Collecte les lots récents sur leboncoin.")
    parser.add_argument(
        "--window",
        type=float,
        default=DEFAULT_WINDOW_H,
        help=f"fenêtre de mise en ligne, en heures (défaut : {DEFAULT_WINDOW_H})",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="chemin de l'instantané (défaut : .data/lbc/recents.json à la racine)",
    )
    parser.add_argument("--dry-run", action="store_true", help="n'écrit rien")
    parser.add_argument("--quiet", action="store_true", help="pas de détail par page")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    target = args.out or root / ".data" / "lbc" / "recents.json"

    started = time.time()
    try:
        items, problems, impersonate, session = collect(args.window, verbose=not args.quiet)
    except Blocked as error:
        # Aucune requête n'est passée. Le code de sortie le signale, le journal
        # dit quoi — les deux, parce que le premier seul est indéchiffrable.
        message = f"ÉCHEC bloqué à l'amorçage ({error})"
        print(f"leboncoin : {message}", file=sys.stderr)
        journal(target, message)
        return 2
    except Exception as error:  # noqa: BLE001 - dernier filet avant le planificateur
        # Sans ceci, une exception inattendue ne laisse qu'une trace Python sur
        # une sortie que personne ne lit, et un code de sortie 1 indistinct.
        message = f"ÉCHEC {type(error).__name__} : {error}"
        print(f"leboncoin : {message}", file=sys.stderr)
        journal(target, message)
        return 3

    # Les cartes suivies, sur la session déjà amorcée : c'est tout l'intérêt de
    # les collecter ici plutôt que dans un second script — l'amorçage est la
    # requête que Datadome refuse, et elle est déjà payée.
    cards_target = target.parent / CARDS_NAME
    queries = read_json(target.parent / QUERIES_NAME) or []
    cards, offset, card_problems = collect_cards(
        session, queries, read_json(cards_target) or {}, verbose=not args.quiet
    )
    problems += card_problems

    snapshot = {
        "at": int(started * 1000),
        "windowHours": args.window,
        "queries": QUERIES,
        "items": items,
    }
    if problems:
        # Le champ porte le même nom que côté TypeScript : instantané valide,
        # mais incomplet.
        snapshot["partial"] = " · ".join(dict.fromkeys(problems))

    elapsed = time.time() - started
    swept = min(CARD_SLICE, len(queries))
    summary = (
        f"{len(items)} lots publiés dans les {args.window:g} h "
        f"+ {swept}/{len(queries)} cartes "
        f"({len(QUERIES) + swept} requêtes, {elapsed:.1f} s, {impersonate})"
        + (f" — {len(problems)} erreur(s) : {snapshot.get('partial', '')}" if problems else "")
    )
    print(f"leboncoin : {summary}")

    if args.dry_run:
        for item in items[:10]:
            age_min = (started * 1000 - item["createdAt"]) / 60000
            price = f"{item['price']:.0f} EUR" if item["price"] else "-"
            print(f"  il y a {age_min:>5.0f} min  {price:>9}  {item['title'][:60]}")
        return 0

    write_atomic(target, snapshot)
    print(f"  → {target}")

    if queries:
        write_atomic(cards_target, {"at": int(started * 1000), "offset": offset, "cards": cards})
        print(f"  → {cards_target}")

    journal(target, summary)

    # Rien collecté *et* que des erreurs : la minuterie doit pouvoir alerter.
    return 1 if not items and problems else 0


if __name__ == "__main__":
    sys.exit(main())
