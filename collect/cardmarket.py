#!/usr/bin/env python3
"""
Collecteur Cardmarket — le second morceau du projet en Python, pour une raison
cousine de celle de `collect/lbc.py`, mais pas identique.

Pourquoi un script séparé, et pourquoi un navigateur
----------------------------------------------------
Cardmarket est derrière Cloudflare, qui sert un défi JavaScript (« Just a
moment… ») à toute requête sans laissez-passer. Deux mesures, faites le 31 août
2026, ont tranché l'approche :

- le `fetch` de Node, comme un `curl` nu, reçoit le défi : 403 systématique ;
- `curl_cffi` avec l'empreinte Chrome — l'arme qui suffit pour Datadome sur
  leboncoin — **ne suffit pas ici**. En rejouant le cookie `cf_clearance` d'un
  vrai navigateur, il obtient bien 200… pendant quelques requêtes, puis 403. Le
  cookie de Cloudflare est lié à l'empreinte TLS *d'Edge* qui l'a résolu, là où
  `curl_cffi` présente celle de Chrome : Cloudflare l'accepte le temps de
  quelques appels, puis le rejette.

Le navigateur, lui, passe de façon stable : c'est *son* empreinte qui a résolu
le défi, et il renouvelle le cookie tout seul. D'où ce collecteur piloté par
Edge, là où leboncoin se contente de `curl_cffi`.

Le collecteur **lance son propre Edge**, sur un profil à lui
(`.data/cardmarket/profil`) persistant d'un passage à l'autre, où se garde le
`cf_clearance` de Cloudflare. Par défaut la fenêtre est **hors écran** :
invisible, mais un vrai navigateur, qui passe Cloudflare bien mieux qu'un mode
*headless*. `--visible` la ramène à l'écran, pour le seul cas où un défi doit
être levé à la main — aucun script ne coche un CAPTCHA à ta place. Un verrou
(`collect.lock`) empêche deux collecteurs de se disputer le profil.

Amorçage : au tout premier usage, ou quand Cloudflare a durci, lancer une fois
`python collect/cardmarket.py --visible --resolve` et lever le défi à la main
dans la fenêtre ; le `cf_clearance` obtenu sert ensuite les passages invisibles.

Deux modes, une raison de les séparer
-------------------------------------
- **sondage** (défaut) : pour chaque carte dont on connaît déjà l'URL produit,
  relever les offres. C'est la valeur quotidienne, et c'est fiable : une URL
  produit canonique se charge sans faute.
- **résolution** (`--resolve`) : retrouver l'URL produit d'une carte à partir de
  son nom anglais et de son numéro. C'est fragile — l'endpoint de recherche est
  le plus protégé de Cardmarket, et une carte ancienne ne remonte pas en page 1
  d'une recherche générique (même écueil que les cartes rares sur leboncoin,
  cf. l'en-tête de `lib/lbc.ts`). On ne le paie donc qu'**une fois par carte**,
  et le résultat est mis en cache dans `produits.json`. Une carte non résolue se
  corrige à la main plutôt que de bloquer le sondage des autres.

Ce que le script ne fait pas
----------------------------
Aucune notation, aucun calcul d'écart, aucune détection de « nouveauté » : tout
cela vit en TypeScript, où `lib/cardmarket.ts` lira `cartes.json` et où
`recordSightings` datera chaque `idArticle` inconnu — c'est de là que naîtront
les alertes, sans une ligne de plus ici. Le script dépose les offres brutes, et
rien d'autre. C'est le même partage qu'entre `collect/lbc.py` et `lib/lbc.ts`.

Ce qu'il produit
----------------
`.data/cardmarket/cartes.json` : par carte, les offres relevées et la date du
relevé. Format jumeau de `cartes.json` de leboncoin, pour que
`lib/cardmarket.ts` le lise comme `lib/lbc.ts` lit le sien.

Fichiers
--------
    .data/cardmarket/produits.json   cardId -> {url, idProduct}   (cache de résolution)
    .data/cardmarket/cartes.json     cardId -> {at, url, items}   (offres relevées)
    .data/cardmarket/collect.log     trace d'exécution

Usage
-----
    python collect/cardmarket.py                    # sonde la liste de chasse
    python collect/cardmarket.py --cards ex9-15      # ne sonde que ces cartes
    python collect/cardmarket.py --resolve           # résout les cartes sans URL
    python collect/cardmarket.py --visible --resolve # fenêtre visible : lever un défi
    python collect/cardmarket.py --dry-run           # n'écrit rien, résume
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - dépend de l'environnement
    sys.exit("playwright manquant : pip install playwright")

# Comme `lbc.py`, ce script hérite sous le planificateur d'une sortie en cp1252,
# où les accents et les drapeaux des titres n'existent pas. Un
# `UnicodeEncodeError` tuerait la collecte après l'avoir menée à bien ; on
# remplace plutôt que d'échouer.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

PARIS = ZoneInfo("Europe/Paris")

# Au-delà, un verrou est tenu pour mort : le processus qui le posait a dû être
# tué sans le libérer. Large, car un tour de collecte à froid (résolution
# comprise) peut durer — et un tour où chaque carte est défiée, le temps des
# clics et des rechargements, aussi. Un quart d'heure : au pire, un verrou
# abandonné coûte un passage de la minuterie.
LOCK_STALE_S = 900

# La langue est toujours le français : un collectionneur francophone ne guette
# pas une carte japonaise ou anglaise. `language=2` est l'identifiant du français
# chez Cardmarket (1=anglais, 2=français, 3=allemand…). Ce n'est pas un choix
# offert à l'utilisateur, c'est une constante.
LANGUAGE_FR = "language=2"

# Un filtre par pays du vendeur (`sellerCountry`, France) a été essayé puis
# retiré : sur une carte comme `ex9-15`, il vidait la page de ses offres
# néerlandaises, italiennes ou belges — c'est-à-dire les affaires mêmes qu'on
# veut voir. Cardmarket est un marché paneuropéen intégré ; on garde tous les
# pays, on impose seulement la langue.


def product_params(reverse: bool = False, first_ed: bool = False) -> str:
    """La chaîne de requête d'une page produit : français toujours, plus les
    critères choisis carte par carte.

    `isReverseHolo` et `isFirstEd` sont les filtres que Cardmarket expose dans
    l'URL de la page produit. Reverse et première édition changent radicalement
    la cote — surveiller « le Dracaufeu » sans préciser lequel n'aurait pas de
    sens — d'où le choix laissé à l'utilisateur, contrairement à la langue.
    """
    parts = [LANGUAGE_FR]
    if reverse:
        parts.append("isReverseHolo=Y")
    if first_ed:
        parts.append("isFirstEd=Y")
    return "&".join(parts)

# Entre deux pages. Cardmarket tolère un navigateur qui lit des fiches produit
# l'une après l'autre ; c'est la *recherche* enchaînée qui se fait throttler.
# Deux secondes suffisent au sondage.
THROTTLE_S = 2.0
TIMEOUT_MS = 45000

# Le rendu du tableau d'offres est fait à l'ouverture de la page, pas par un
# appel réseau différé : un court répit après `domcontentloaded` suffit à le
# laisser peupler. Mesuré à ~2 s ; on prend une marge.
SETTLE_MS = 2500

# En mode visible (amorçage), temps laissé à l'utilisateur pour lever le défi
# Cloudflare à la main avant d'abandonner. Large : cocher la case, attendre le
# rechargement, ça se compte en dizaines de secondes.
VISIBLE_WAIT_S = 120

# Clic automatique (tablette) : attente du cadre Turnstile, répit entre son
# apparition et le clic (le spinner « Vérification… » précède la case de
# quelques secondes), temps laissé à Cloudflare pour recharger la page après
# le clic, et nombre d'essais. Mesuré le 4 septembre 2026 : cadre présent dès
# la page chargée, clic réussi neuf secondes plus tard, vraie page en deux.
AUTO_CADRE_WAIT_S = 25
AUTO_AVANT_CLIC_S = 6
AUTO_APRES_CLIC_S = 20
AUTO_ESSAIS = 3

# Position de la case dans le cadre Turnstile (300 × 65 px) : à gauche, à
# mi-hauteur. La case elle-même est hors de portée (shadow DOM fermé), le
# cadre non. Mesuré par VNC les 3 et 4 septembre 2026 : cadre en 191,304 dans
# la page, case cochée en 212,480 à l'écran.
CASE_DX = 21

LOG_LINES = 200

# Les codes d'état de Cardmarket, dans l'ordre décroissant. Repris tels quels
# dans `cartes.json` : la traduction vers les quatre niveaux du site est une
# règle métier, elle vit en TypeScript avec les autres (`lib/cardmarket.ts`).
CONDITION_CODES = {"MT", "NM", "EX", "GD", "LP", "PL", "PO"}


def data_dir() -> Path:
    """`.data/cardmarket/` à la racine du dépôt, créé au besoin."""
    root = Path(__file__).resolve().parent.parent
    return root / ".data" / "cardmarket"


def read_json(source: Path):
    """Lecture tolérante à l'absence : un cache qui n'existe pas encore est le
    cas normal du premier passage, pas une erreur."""
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_atomic(target: Path, payload) -> None:
    """Écriture par fichier temporaire puis renommage — même garantie que
    `writeJson` côté TypeScript : le site lit ce fichier pendant que la minuterie
    le réécrit, et ne doit jamais tomber sur un JSON tronqué."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(f".{uuid.uuid4()}.tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


class Lock:
    """Verrou par fichier, pour qu'un seul collecteur tourne à la fois.

    La minuterie et le déclencheur du site peuvent partir en même temps ; deux
    Edge sur le même profil se refusent. Un fichier suffit : sa présence dit
    qu'un collecteur travaille. Un verrou plus vieux que `LOCK_STALE_S` est tenu
    pour abandonné (processus tué) et repris — sans quoi un plantage bloquerait
    toute collecte jusqu'au prochain redémarrage.
    """

    def __init__(self, path: Path):
        self._path = path
        self._held = False

    def acquire(self) -> bool:
        try:
            if self._path.exists() and time.time() - self._path.stat().st_mtime < LOCK_STALE_S:
                return False
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(str(os.getpid()), encoding="utf-8")
            self._held = True
            return True
        except OSError:
            # Faute de pouvoir poser le verrou, mieux vaut laisser passer que
            # bloquer : au pire deux collectes se gênent une fois.
            return True

    def release(self) -> None:
        if self._held:
            self._path.unlink(missing_ok=True)
            self._held = False


def journal(message: str) -> None:
    """Trace d'exécution, à côté des instantanés. Un journal qui échoue n'a
    jamais de raison de faire échouer une collecte réussie."""
    log = data_dir() / "collect.log"
    stamp = datetime.now(PARIS).strftime("%Y-%m-%d %H:%M:%S")
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        previous = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
        kept = (previous + [f"{stamp}  {message}"])[-LOG_LINES:]
        log.write_text("\n".join(kept) + "\n", encoding="utf-8")
    except OSError:
        pass


# Vrai dans l'interstitiel Cloudflare, faux dans une page Cardmarket : les
# éléments de la page de défi et l'objet de configuration que son script pose.
CHALLENGE_JS = """() =>
  !!document.querySelector('#challenge-error-text, #challenge-stage, #challenge-running, input[name="cf-turnstile-response"]')
  || typeof window._cf_chl_opt !== 'undefined'
"""

# JavaScript exécuté dans la page produit pour en extraire les offres. Gardé
# ici, au plus près du balisage qu'il connaît : le tableau `#table` empile des
# lignes `.article-row` dont l'`id` (`articleRow<idArticle>`) porte l'unique
# clé stable d'une offre — c'est elle qui, inconnue au sondage suivant, signera
# une offre neuve. Le prix, le vendeur, l'état et le pays sont lus dans la même
# ligne ; les sélecteurs doublés couvrent les deux gabarits (bureau / mobile)
# que Cardmarket sert selon la largeur.
EXTRACT_JS = r"""() => {
  const rows = [...document.querySelectorAll('#table .article-row')];
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  return rows.map((r) => {
    const idArticle = r.id.replace('articleRow', '');
    const price = clean(
      r.querySelector('.price-container .color-primary')?.textContent ||
      r.querySelector('.mobile-offer-container .color-primary')?.textContent
    );
    const seller = clean(r.querySelector('.seller-name a')?.textContent);
    const condEl = r.querySelector('a.article-condition span, a.article-condition, .article-condition span');
    const cond = clean(condEl?.textContent);
    // Le drapeau du pays et la réputation du vendeur portent tous deux une
    // bulle : on ne retient que celle qui commence par « Localisation », sans
    // quoi on récolte « 15004 Ventes | 32496 Articles » à la place du pays.
    let country = '';
    for (const el of r.querySelectorAll('[data-bs-original-title], [aria-label], [title]')) {
      const tip = el.getAttribute('data-bs-original-title') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
      if (/localisation/i.test(tip)) { country = clean(tip); break; }
    }
    return { idArticle, price, seller, cond, country };
  });
}"""


def parse_price(raw: str) -> float | None:
    """`'0,19 €'` vers `0.19`. Cardmarket écrit la virgule décimale et le point
    des milliers à la française ; on retire tout sauf les chiffres et la virgule
    finale."""
    if not raw:
        return None
    m = re.search(r"(\d[\d.\s]*),(\d{2})", raw)
    if not m:
        return None
    entier = re.sub(r"[.\s]", "", m.group(1))
    try:
        return float(f"{entier}.{m.group(2)}")
    except ValueError:
        return None


def clean_country(raw: str) -> str | None:
    """La bulle du drapeau est « Localisation de l'article: Pays-Bas » : on ne
    garde que le pays."""
    if not raw:
        return None
    return raw.split(":")[-1].strip() or None


def normalize_offer(raw: dict, product_url: str) -> dict | None:
    """Une offre brute de la page vers la forme que `lib/cardmarket.ts`
    consomme. Rejette une offre sans identifiant : le reste du pipeline le
    suppose, et une entrée mutilée coûterait plus cher à filtrer en aval."""
    id_article = (raw.get("idArticle") or "").strip()
    if not id_article:
        return None
    cond = (raw.get("cond") or "").strip().upper()
    return {
        "idArticle": id_article,
        "price": parse_price(raw.get("price") or ""),
        # L'offre n'a pas d'URL propre : l'achat se fait sur la page produit,
        # où le panier connaît l'article. On y renvoie.
        "url": product_url,
        "condition": cond if cond in CONDITION_CODES else None,
        "country": clean_country(raw.get("country") or ""),
        "seller": raw.get("seller") or None,
    }


def clic_automatique_possible() -> bool:
    """Vrai quand un serveur X et `xdotool` sont là — c'est la tablette.

    Le défi Cloudflare est une case à cocher qui exige un vrai clic : ni le
    mode invisible ni Playwright (dont les clics sont reconnus comme tels) ne
    la lèvent. Ce qui l'a levée à la main, par VNC, est un événement XTEST
    envoyé au serveur X ; `xdotool` envoie exactement le même. Sous Windows,
    ni X ni `xdotool` : c'est l'amorçage à la main qui reste.
    """
    return (
        sys.platform != "win32"
        and bool(os.environ.get("DISPLAY"))
        and shutil.which("xdotool") is not None
    )


class Browser:
    """Le navigateur que le collecteur lance et possède.

    Il n'y a plus d'Edge à ouvrir à la main : le collecteur démarre le sien sur
    un profil à lui, persistant d'un passage à l'autre. Ce profil garde le
    laissez-passer de Cloudflare (`cf_clearance`), obtenu une fois, réutilisé
    tant qu'il est valide.

    Par défaut la fenêtre est **hors écran** (`--window-position` très négatif) :
    un vrai Edge, qui passe Cloudflare bien mieux qu'un navigateur *headless*,
    mais invisible. `visible=True` la ramène à l'écran, pour le seul cas où il
    faut lever un défi à la main — aucun script ne coche un CAPTCHA à ta place.
    """

    def __init__(self, visible: bool = False, headless: bool = False):
        # Là où un clic automatique est possible, la fenêtre va à l'écran
        # virtuel, que personne ne regarde de toute façon : c'est là que
        # `xdotool` cliquera. Le mode invisible (fenêtre hors écran) ne garde
        # de sens que sur un vrai bureau, où une fenêtre gênerait.
        self._auto = clic_automatique_possible() and not headless
        visible = visible or self._auto
        self._visible = visible
        self.defis_leves = 0
        # Un défi que trois clics n'ont pas levé ne tombera pas au quatrième :
        # les cartes suivantes n'ont droit qu'à un essai, pour ne pas étirer
        # le passage à cinq minutes de clics dans le vide.
        self._defi_tenace = False
        self._play = sync_playwright().start()
        profile = data_dir() / "profil"
        profile.mkdir(parents=True, exist_ok=True)

        # Effacer les marques d'automatisation que Cloudflare lit : sans elles,
        # son défi tourne en boucle même quand l'utilisateur coche la case. On
        # retire `--enable-automation` (qui pose `navigator.webdriver`) et on
        # débranche la détection Blink correspondante.
        args = ["--disable-blink-features=AutomationControlled"]
        if not visible and not headless:
            # Hors du bureau visible, sans être headless : le compromis
            # « invisible mais crédible » face à Cloudflare.
            args.append("--window-position=-2400,-2400")
        elif visible:
            # Chromium retient la position de sa fenêtre dans le profil : après
            # des passages invisibles, l'amorçage rouvrait la fenêtre là où il
            # l'avait laissée, hors de l'écran — mesuré sur la tablette le
            # 3 septembre 2026, trente pixels visibles sur mille deux cents, et
            # un écran VNC noir. On la ramène au coin en haut à gauche, à la
            # taille de l'écran virtuel : le clic automatique convertit des
            # coordonnées de page en coordonnées d'écran, la fenêtre doit être
            # là où on croit.
            args.append("--window-position=0,0")
            args.append("--window-size=1280,900")
        # Sous proot (la tablette), le processus se croit root et le bac à
        # sable de Chromium ne peut pas s'établir : sans ce drapeau, le
        # navigateur refuse même de démarrer. `geteuid` n'existe pas sous
        # Windows, où la question ne se pose pas.
        if getattr(os, "geteuid", lambda: 1)() == 0:
            args.append("--no-sandbox")

        # Edge d'abord — il passe Cloudflare mieux que Chromium. Mais il
        # n'existe pas partout (pas de build Linux ARM64, donc pas de tablette) :
        # à défaut, le Chromium que Playwright embarque fait l'affaire, quitte à
        # devoir lever un défi à la main un peu plus souvent.
        derniere_erreur: Exception | None = None
        for canal in ("msedge", None):
            try:
                # Fenêtre à l'écran : pas d'émulation de viewport, sinon
                # `innerHeight` ment (900 émulés pour 755 réels) et la hauteur
                # des barres du navigateur, dont dépend le clic, est fausse.
                self._ctx = self._play.chromium.launch_persistent_context(
                    user_data_dir=str(profile),
                    headless=headless,
                    args=args,
                    ignore_default_args=["--enable-automation"],
                    **(
                        {"no_viewport": True}
                        if visible
                        else {"viewport": {"width": 1280, "height": 900}}
                    ),
                    **({"channel": canal} if canal else {}),
                )
                break
            except Exception as error:
                derniere_erreur = error
        else:
            self._play.stop()
            raise RuntimeError(
                f"Impossible de lancer un navigateur ({derniere_erreur}). "
                f"Edge ou le Chromium de Playwright sont-ils installés, et le "
                f"profil `{profile}` n'est-il pas déjà ouvert ailleurs ?"
            ) from derniere_erreur
        self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()

    def fetch_offers(self, url: str) -> tuple[list[dict], bool]:
        """Les offres brutes d'une page produit, et si Cloudflare a défié.

        Le défi est signalé plutôt que levé : une page défiée n'est pas une
        panne du script mais un cookie à renouveler, décision qui revient à
        l'appelant — comme un 403 Datadome pour leboncoin.
        """
        if not self._settle(url):
            return [], True
        return self._page.evaluate(EXTRACT_JS), False

    def _settle(self, url: str) -> bool:
        """Charge `url` et franchit le défi Cloudflare s'il y en a un. Rend
        `True` si on tombe sur la vraie page, `False` si le défi persiste.

        Deux stratégies. **Invisible** : Cloudflare sert parfois son défi à la
        première navigation puis le résout seul ; deux reprises espacées
        suffisent le plus souvent. **Visible** (`--visible`) : c'est l'amorçage,
        où l'utilisateur lève le défi à la main — on lui laisse le temps, en
        guettant que le titre change, jusqu'à `VISIBLE_WAIT_S`. Une fois le
        `cf_clearance` obtenu, il vaut pour les pages suivantes.
        """
        self._page.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        self._page.wait_for_timeout(SETTLE_MS)
        if not self._is_challenge():
            return True

        if self._auto:
            return self._lever_le_defi()

        if self._visible:
            deadline = time.time() + VISIBLE_WAIT_S
            while time.time() < deadline:
                self._page.wait_for_timeout(2000)
                if not self._is_challenge():
                    return self._page_chargee()
            return False

        for _ in range(2):
            self._page.wait_for_timeout(4000)
            self._page.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            self._page.wait_for_timeout(SETTLE_MS)
            if not self._is_challenge():
                return True
        return not self._is_challenge()

    def _is_challenge(self) -> bool:
        """Vrai si la page est l'écran d'attente de Cloudflare.

        Le titre varie selon la langue — « Just a moment… » en anglais, « Un
        instant… » en français — et c'était le piège : ne guetter que l'anglais
        laissait passer le défi français pour une vraie page vide, d'où des
        « 0 offre » trompeurs. On teste donc les deux titres.

        Le script « challenge-platform », lui, n'est pas un marqueur : Cloudflare
        le glisse aussi dans les vraies pages (le 4 septembre 2026, le Kyogre
        chargé était compté comme défié, deux minutes d'attente et une carte
        perdue). On lit donc ce que seul l'interstitiel porte : son champ de
        réponse Turnstile, son texte d'erreur, son objet `_cf_chl_opt`.

        Pendant que Cloudflare recharge la page une fois la case cochée, le
        contexte d'exécution disparaît sous nos pieds : une lecture qui échoue
        est refaite une fois, après un court répit.
        """
        for essai in range(2):
            try:
                title = (self._page.title() or "").lower()
                if "just a moment" in title or "un instant" in title:
                    return True
                return bool(self._page.evaluate(CHALLENGE_JS))
            except Exception:  # noqa: BLE001 - navigation en cours
                if essai:
                    raise
                self._page.wait_for_timeout(1500)
        return False  # pragma: no cover

    def _page_chargee(self) -> bool:
        """Une fois le défi levé, Cloudflare recharge la vraie page : on la
        laisse arriver avant de lire ses offres, sinon on lit dans le vide."""
        try:
            self._page.wait_for_load_state("domcontentloaded", timeout=TIMEOUT_MS)
        except Exception:  # noqa: BLE001
            pass
        self._page.wait_for_timeout(SETTLE_MS)
        return not self._is_challenge()

    # ------------------------------------------------ clic automatique (X11)

    def _lever_le_defi(self) -> bool:
        """Coche la case Cloudflare avec `xdotool`, jusqu'à `AUTO_ESSAIS` fois.

        Rend `True` si la vraie page a suivi. On attend le cadre Turnstile,
        on laisse la case remplacer le spinner, on clique, on laisse
        Cloudflare recharger ; un essai raté (case pas encore là, cadre
        rechargé entre-temps) est simplement refait.
        """
        essais = 1 if self._defi_tenace else AUTO_ESSAIS
        for essai in range(1, essais + 1):
            cible = self._attendre_le_cadre()
            if cible is None:
                self._trace(f"défi : cadre Turnstile introuvable (essai {essai})")
                continue
            self._page.wait_for_timeout(AUTO_AVANT_CLIC_S * 1000)
            ecran = self._vers_ecran(*cible)
            if ecran is None or not self._xdotool_clic(*ecran):
                self._trace(f"défi : clic impossible (essai {essai})")
                continue
            self._trace(f"défi : case cochée en {ecran[0]},{ecran[1]} (essai {essai})")
            deadline = time.time() + AUTO_APRES_CLIC_S
            while time.time() < deadline:
                self._page.wait_for_timeout(2000)
                if not self._is_challenge():
                    if self._page_chargee():
                        self.defis_leves += 1
                        self._defi_tenace = False
                        return True
                    break
        self._defi_tenace = True
        return not self._is_challenge()

    def _attendre_le_cadre(self) -> tuple[float, float] | None:
        deadline = time.time() + AUTO_CADRE_WAIT_S
        while time.time() < deadline:
            cible = self._case_dans_le_cadre()
            if cible:
                return cible
            self._page.wait_for_timeout(2000)
        return None

    def _case_dans_le_cadre(self) -> tuple[float, float] | None:
        """La position de la case, dans le repère de la page.

        Turnstile se rend dans un shadow DOM *fermé* : ni l'`iframe` ni la case
        ne répondent à un sélecteur, la page ne montre qu'un champ caché. Mais
        Playwright connaît le cadre lui-même (il vient du protocole, pas du
        DOM) et sait retrouver l'élément qui l'héberge — sa boîte est la seule
        prise ; la case est à `CASE_DX` du bord gauche, à mi-hauteur.
        """
        for frame in self._page.frames:
            if "challenges.cloudflare.com" not in (frame.url or ""):
                continue
            try:
                box = frame.frame_element().bounding_box()
            except Exception:  # noqa: BLE001 - cadre détaché entre-temps
                box = None
            if box and box["width"] > 0 and box["height"] > 0:
                return box["x"] + CASE_DX, box["y"] + box["height"] / 2
        return None

    def _vers_ecran(self, x: float, y: float) -> tuple[int, int] | None:
        """Des coordonnées de page aux coordonnées d'écran X : la position de
        la fenêtre, plus la hauteur des barres du navigateur (onglets, adresse,
        bandeau « --no-sandbox »), que donne `outerHeight - innerHeight`."""
        try:
            m = self._page.evaluate(
                "() => ({sx: window.screenX, sy: window.screenY, ow: window.outerWidth,"
                " oh: window.outerHeight, iw: window.innerWidth, ih: window.innerHeight})"
            )
        except Exception:  # noqa: BLE001
            return None
        dx = m["sx"] + max(0, (m["ow"] - m["iw"]) // 2)
        dy = m["sy"] + max(0, m["oh"] - m["ih"])
        return round(dx + x), round(dy + y)

    @staticmethod
    def _xdotool_clic(x: int, y: int) -> bool:
        """Un vrai clic, par XTEST : déplacement, un souffle, enfoncer-relâcher
        — la séquence qui a levé le défi par VNC."""
        try:
            # Pas de `--sync` : il attend que le pointeur bouge, et ne rend
            # jamais la main s'il est déjà là (le clic précédent l'y a laissé).
            subprocess.run(["xdotool", "mousemove", str(x), str(y)], check=True, timeout=15)
            time.sleep(0.4)
            subprocess.run(["xdotool", "click", "1"], check=True, timeout=15)
            return True
        except Exception:  # noqa: BLE001 - xdotool absent, écran mort…
            return False

    @staticmethod
    def _trace(message: str) -> None:
        print(f"  {message}", file=sys.stderr, flush=True)
        journal(message)

    def product_links(self, query: str) -> list[str]:
        """Les liens produit d'une page de recherche, dédupliqués dans l'ordre.

        Réservé à la résolution. Attendre le sélecteur plutôt qu'un délai fixe :
        la page de recherche peuple sa grille en différé, et un délai trop court
        rendait zéro lien là où il y en avait trente.
        """
        url = (
            "https://www.cardmarket.com/fr/Pokemon/Products/Search"
            f"?searchString={query.replace(' ', '+')}"
        )
        if not self._settle(url):
            return []
        try:
            self._page.wait_for_selector(
                "a[href*='/Products/Singles/']", timeout=12000
            )
        except Exception:
            return []
        seen: dict[str, None] = {}
        for a in self._page.query_selector_all("a[href*='/Products/Singles/']"):
            href = a.get_attribute("href")
            if href:
                seen.setdefault(href.split("?")[0], None)
        return list(seen)

    def close(self) -> None:
        try:
            self._ctx.close()
        finally:
            self._play.stop()


def full_url(path_or_url: str, reverse: bool = False, first_ed: bool = False) -> str:
    """Un chemin `/fr/Pokemon/...` ou une URL complète vers une URL de sondage,
    en français et selon les critères de la carte."""
    base = path_or_url
    if base.startswith("/"):
        base = "https://www.cardmarket.com" + base
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{product_params(reverse, first_ed)}"


# ------------------------------------------------------------------- sondage


def card_trend(card_id: str) -> float | None:
    """La cote Cardmarket (tendance) d'une carte, via TCGdex.

    Stockée avec les offres pour que la colonne du site calcule l'écart sans
    rappeler TCGdex à chaque rendu. `trend` d'abord, `avg30` en repli — la même
    règle que le fil (`feed.ts`)."""
    try:
        with urllib.request.urlopen(
            f"https://api.tcgdex.net/v2/fr/cards/{card_id}", timeout=15
        ) as response:
            cm = (json.load(response).get("pricing") or {}).get("cardmarket") or {}
            value = cm.get("trend")
            if value is None:
                value = cm.get("avg30")
            return float(value) if value is not None else None
    except Exception:  # noqa: BLE001 - une cote absente n'est pas une panne
        return None


def poll(
    browser: Browser,
    produits: dict,
    wanted: list[str],
    options_by_id: dict,
    previous: dict,
    verbose: bool,
) -> tuple[dict, list[str]]:
    """Relève les offres de chaque carte demandée dont l'URL est connue.

    Chaque carte est sondée en français, et selon ses critères propres (reverse,
    première édition) tirés de la liste de chasse. Rend le dictionnaire des
    cartes relevées et la liste des ennuis. Une carte défiée par Cloudflare est
    comptée comme un ennui mais n'interrompt pas les suivantes : le cookie se
    renouvellera, et un relevé partiel vaut mieux que pas de relevé.
    """
    cards: dict[str, dict] = {}
    problems: list[str] = []
    now = int(time.time() * 1000)

    for card_id in wanted:
        opts = options_by_id.get(card_id) or {}
        # Le lien collé à la main l'emporte sur l'URL résolue : c'est la porte de
        # sortie pour les cartes que la recherche ne trouve pas.
        base = opts.get("url") or (produits.get(card_id) or {}).get("url")
        if not base:
            continue
        url = full_url(base, bool(opts.get("reverse")), bool(opts.get("firstEd")))
        try:
            raw, challenged = browser.fetch_offers(url)
        except Exception as error:  # noqa: BLE001 - une page ne doit pas tout perdre
            problems.append(f"{card_id} : {type(error).__name__}")
            continue
        if challenged:
            problems.append(f"{card_id} : défi Cloudflare")
            if verbose:
                print(f"  {card_id} : défi Cloudflare", file=sys.stderr)
            time.sleep(THROTTLE_S)
            continue

        offers = [o for o in (normalize_offer(r, url) for r in raw) if o]

        # Date de première apparition, reprise du relevé précédent : une offre
        # déjà vue garde sa date, une inconnue est datée de maintenant. C'est
        # elle qui classe les « derniers ajouts » de la colonne et signe une
        # nouveauté — sans dépendre d'une date que Cardmarket n'expose pas.
        seen_before = {
            item.get("idArticle"): item.get("firstSeen")
            for item in (previous.get(card_id) or {}).get("items") or []
        }
        for offer in offers:
            offer["firstSeen"] = seen_before.get(offer["idArticle"]) or now

        cards[card_id] = {"at": now, "url": url, "trend": card_trend(card_id), "items": offers}
        if verbose:
            cheapest = min((o["price"] for o in offers if o["price"]), default=None)
            tail = f", dès {cheapest:.2f} EUR" if cheapest else ""
            print(f"  {card_id} : {len(offers)} offres{tail}", file=sys.stderr)
        time.sleep(THROTTLE_S)

    return cards, problems


# --------------------------------------------------------------- résolution


def english_card(card_id: str) -> tuple[str | None, str | None]:
    """Nom et set anglais d'une carte, via TCGdex. Cardmarket est en anglais :
    chercher « Dracolosse » n'y rend rien, « Dragonite » si."""
    try:
        with urllib.request.urlopen(
            f"https://api.tcgdex.net/v2/en/cards/{card_id}", timeout=15
        ) as response:
            card = json.load(response)
            return card.get("name"), (card.get("set") or {}).get("name")
    except Exception:  # noqa: BLE001 - une carte inconnue n'est pas une panne
        return None, None


def match_link(links: list[str], number: str) -> str | None:
    """Parmi les liens d'une recherche, celui dont le slug se termine par le
    numéro imprimé de la carte.

    Le numéro est la seule clé qui traverse la barrière de langue : le slug
    Cardmarket finit par l'abréviation d'extension suivie du numéro
    (`…/Kyogre-EM15`, `…/Ninetales-H19`). On tolère les lettres d'abréviation
    entre le tiret et le numéro, et d'éventuels suffixes de variante (`-V1`).
    """
    pat = re.compile(rf"-[A-Za-z]*{re.escape(number)}(?:-V\d+)?$")
    for href in links:
        if pat.search(href.split("?")[0]):
            return href
    return None


def resolve(browser: Browser, favs: list[dict], produits: dict, verbose: bool) -> tuple[int, int]:
    """Retrouve l'URL produit des cartes qui n'en ont pas encore.

    Espacé et prudent : la recherche est l'endpoint le plus protégé, et on ne la
    paie qu'une fois par carte. Ce qui n'est pas résolu est laissé tel quel — à
    corriger à la main dans `produits.json` — plutôt que deviné faux.
    """
    resolved = 0
    attempted = 0
    for fav in favs:
        card_id = fav["cardId"]
        if produits.get(card_id, {}).get("url"):
            continue
        attempted += 1
        name_en, set_en = english_card(card_id)
        base_name = name_en or fav.get("name") or ""
        number = str(fav.get("localId") or "").strip()
        if not base_name or not number:
            continue
        # La recherche par nom seul ne remonte pas une carte ancienne : trop de
        # « Mewtwo » la relèguent hors de la première page. On qualifie donc par
        # le set d'abord — « Mewtwo Expedition Base Set » — et on retombe sur le
        # nom nu seulement si cela ne donne rien.
        queries = [f"{base_name} {set_en}", base_name] if set_en else [base_name]
        links: list[str] = []
        try:
            for query in queries:
                links = browser.product_links(query)
                if match_link(links, number):
                    break
                time.sleep(THROTTLE_S)
        except Exception as error:  # noqa: BLE001
            if verbose:
                print(f"  {card_id} : recherche impossible ({error})", file=sys.stderr)
            time.sleep(THROTTLE_S * 3)
            continue
        hit = match_link(links, number)
        if hit:
            produits[card_id] = {"url": hit}
            resolved += 1
            if verbose:
                print(f"  {card_id} -> {hit.split('/Singles/')[-1]}", file=sys.stderr)
        elif verbose:
            print(
                f"  {card_id} « {query} » n°{number} : {len(links)} liens, "
                f"aucun ne correspond",
                file=sys.stderr,
            )
        # La recherche enchaînée se fait throttler : on l'espace bien plus que le
        # sondage, quitte à ce qu'un tour de résolution soit long. Il est rare.
        time.sleep(THROTTLE_S * 3)
    return resolved, attempted


# --------------------------------------------------------------------- main


def load_favs(path: Path | None) -> list[dict]:
    """La liste de chasse : les cartes suivies, écrite par le site (comme
    `queries.json` pour leboncoin). Absente, la résolution n'a rien à faire."""
    if path is None:
        path = data_dir() / "cartes-suivies.json"
    return read_json(path) or []


def main() -> int:
    parser = argparse.ArgumentParser(description="Collecte les offres Cardmarket.")
    parser.add_argument("--cards", default=None, help="identifiants séparés par des virgules : ne sonde que ceux-là")
    parser.add_argument("--resolve", action="store_true", help="résout d'abord les URLs manquantes")
    parser.add_argument("--favs", type=Path, default=None, help="liste de chasse (défaut : .data/cardmarket/cartes-suivies.json)")
    parser.add_argument("--visible", action="store_true", help="fenêtre à l'écran (pour lever un défi Cloudflare à la main)")
    parser.add_argument("--headless", action="store_true", help="navigateur sans fenêtre (déconseillé : Cloudflare y est plus dur)")
    parser.add_argument("--dry-run", action="store_true", help="n'écrit rien")
    parser.add_argument("--quiet", action="store_true", help="pas de détail par carte")
    args = parser.parse_args()

    verbose = not args.quiet
    produits_file = data_dir() / "produits.json"
    cartes_file = data_dir() / "cartes.json"
    produits = read_json(produits_file) or {}
    previous_cards = (read_json(cartes_file) or {}).get("cards") or {}
    started = time.time()

    # Un seul collecteur à la fois : la minuterie et le déclencheur du site
    # visent le même profil de navigateur, que deux Edge ne peuvent pas ouvrir
    # ensemble. Le seul qui n'a pas le verrou s'efface — l'autre relèvera les
    # mêmes cartes dans l'instant.
    lock = Lock(data_dir() / "collect.lock")
    if not lock.acquire():
        print("cardmarket : un autre collecteur tourne déjà, passage ignoré", file=sys.stderr)
        return 0

    try:
        browser = Browser(visible=args.visible, headless=args.headless)
    except RuntimeError as error:
        print(f"cardmarket : ÉCHEC {error}", file=sys.stderr)
        journal(f"ÉCHEC lancement : {error}")
        lock.release()
        return 2

    # La liste de chasse porte les critères par carte (reverse, première
    # édition) ; on la lit toujours, pas seulement pour la résolution.
    favs = load_favs(args.favs)
    options_by_id = {
        entry["cardId"]: entry for entry in favs if entry.get("cardId")
    }

    # Par défaut on sonde la liste de chasse — les cartes actuellement cochées —
    # et non tout le cache d'URLs : une carte décochée garde son URL résolue dans
    # `produits.json`, mais ne doit plus être relevée.
    wanted = (
        [c.strip() for c in args.cards.split(",") if c.strip()]
        if args.cards
        else [entry["cardId"] for entry in favs if entry.get("cardId")]
    )

    problems: list[str] = []
    resolved = attempted = 0
    try:
        # Résolution à la demande : toute carte demandée sans URL connue est
        # résolue avant d'être sondée. Sans cela, cocher « CM » sur une carte
        # jamais résolue ne relevait rien — c'est ce qui laissait Mewtwo vide.
        # `--resolve` élargit à *toutes* les cartes suivies, pour un tour complet.
        want = set(wanted)
        to_resolve = (
            [f for f in favs if not f.get("url")]
            if args.resolve
            else [
                f
                for f in favs
                if f.get("cardId") in want
                and not f.get("url")  # lien collé à la main : rien à résoudre
                and not produits.get(f["cardId"], {}).get("url")
            ]
        )
        if to_resolve:
            resolved, attempted = resolve(browser, to_resolve, produits, verbose)
            if resolved and not args.dry_run:
                write_atomic(produits_file, produits)

        cards, problems = poll(browser, produits, wanted, options_by_id, previous_cards, verbose)
    finally:
        browser.close()
        lock.release()

    elapsed = time.time() - started
    total_offers = sum(len(c["items"]) for c in cards.values())
    summary = (
        f"{len(cards)} carte(s), {total_offers} offres ({elapsed:.1f} s)"
        + (f" ; résolu {resolved}/{attempted}" if args.resolve else "")
        + (f" ; {browser.defis_leves} défi(s) levé(s)" if browser.defis_leves else "")
        + (f" — {len(problems)} ennui(s)" if problems else "")
    )
    print(f"cardmarket : {summary}")

    if args.dry_run:
        for card_id, card in list(cards.items())[:10]:
            cheapest = min((o["price"] for o in card["items"] if o["price"]), default=None)
            price = f"{cheapest:.2f} EUR" if cheapest else "-"
            print(f"  {card_id:14} {len(card['items']):3} offres  dès {price:>9}")
        return 0

    if cards:
        # Le relevé se pose *par-dessus* l'existant : une carte non sondée à ce
        # passage garde ses offres précédentes, que `lib/cardmarket.ts` périmera
        # si le relevé vieillit trop. C'est la rotation qui économise, pas
        # l'oubli — même principe que `collect_cards` de leboncoin.
        merged = dict(previous_cards)
        merged.update(cards)
        write_atomic(cartes_file, {"at": int(started * 1000), "cards": merged})
        print(f"  → {cartes_file}")

    # État de la dernière tentative, écrit à *chaque* passage (même bredouille) :
    # c'est lui qui permet au site de dire « collecte bloquée » plutôt que de
    # laisser un fil vide sans explication. `challenged` distingue un défi
    # Cloudflare — qui appelle un amorçage `--visible` — d'un simple creux.
    challenged = any("défi" in problem.lower() for problem in problems)
    write_atomic(
        data_dir() / "status.json",
        {
            "at": int(started * 1000),
            "watched": len(wanted),
            "collected": len(cards),
            "offers": total_offers,
            "challenged": challenged,
            "message": summary,
        },
    )

    journal(summary)
    # Rien relevé *et* que des ennuis : la minuterie doit pouvoir alerter.
    return 1 if not cards and problems else 0


if __name__ == "__main__":
    sys.exit(main())
