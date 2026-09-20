#!/usr/bin/env python3
"""
Amorceur Vinted — ouvre une session anonyme dans un vrai navigateur et la
dépose sur le disque, pour que le site l'utilise sans navigateur.

Pourquoi un navigateur, et pourquoi si peu
------------------------------------------
Jusqu'au 12 septembre 2026, `lib/vinted.ts` ouvrait sa session tout seul : un
`fetch` de la page d'accueil rendait le cookie `access_token_web`, et l'API
catalogue `/api/v2/catalog/items` répondait avec. Le 13, Vinted a mis Cloudflare
devant tout `www.vinted.fr` (défi JavaScript, « Un instant… », même sur
`robots.txt`) et a déplacé son catalogue sur `api.vinted.fr/svc-catalogue/items`
— l'ancien chemin rend 404. Mesuré le 20 septembre 2026 :

- `fetch` nu comme `curl_cffi` (empreintes Chrome, Firefox, Safari) reçoivent
  le défi : 403 et un seul cookie `__cf_bm` — jamais de jeton ;
- un vrai navigateur, fenêtré, sans marque d'automatisation, obtient le jeton
  en deux secondes sur le PC comme sur la tablette, **sans même voir le
  défi** ;
- le nouveau catalogue, lui, n'est *pas* derrière le défi : il accepte le
  seul cookie `access_token_web`, depuis n'importe quelle pile HTTP (`urllib`
  nu, 200), sans jeton CSRF ni identifiant anonyme — contrairement à
  Cardmarket, où le laissez-passer est lié à l'empreinte TLS du navigateur
  qui l'a obtenu ;
- le jeton est un JWT valable **vingt-quatre heures** (`exp` − `iat`).

D'où ce partage : le navigateur ne sert qu'à *obtenir* le jeton, une fois par
jour ; les centaines de recherches quotidiennes du fil et de la veille restent
en TypeScript, avec le `fetch` de Node. C'est le même partage qu'entre
`collect/cardmarket.py` et `lib/cardmarket.ts`, en plus léger encore : ici le
script ne collecte rien.

Quand il tourne
---------------
`lib/vinted.ts` le lance lui-même (`VINTED_PYTHON`) quand la session manque,
expire ou se fait refuser ; à la main, `python collect/vinted_session.py`
suffit. Le navigateur et le défi Cloudflare — s'il se présente un jour ici
aussi — sont ceux de `collect/cloudflare.py`, partagés avec Cardmarket : sur
la tablette la case se coche toute seule, sur un bureau `--visible` laisse
l'utilisateur la cocher.

Fichiers
--------
    .data/vinted/session.json   {at, expiresAt, userAgent, cookies}
    .data/vinted/profil/        profil persistant du navigateur
    .data/vinted/collect.log    trace d'exécution

Usage
-----
    python collect/vinted_session.py             # ouvre une session si la présente expire
    python collect/vinted_session.py --force     # en ouvre une neuve quoi qu'il en soit
    python collect/vinted_session.py --visible   # fenêtre à l'écran : lever un défi à la main
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - dépend de l'environnement
    sys.exit("playwright manquant : pip install playwright")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cloudflare import Defi, clic_automatique_possible, lancer_navigateur  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

PARIS = ZoneInfo("Europe/Paris")
ACCUEIL = "https://www.vinted.fr/"
JETON = "access_token_web"

# Le jeton arrive avec la page ; on lui laisse tout de même quelques secondes,
# le temps que les scripts de la page le posent si le serveur ne l'a pas fait.
JETON_WAIT_S = 20

# Une session qui expire dans moins d'une heure est à renouveler : le site la
# tient pour valable jusqu'à cinq minutes de la fin, et une veille qui tombe
# sur l'expiration au milieu d'un passage perdrait ses cartes.
MARGE_S = 3600

# Deux appelants (le site et la veille) peuvent demander une session au même
# instant : le second attend le premier, puis trouve une session toute neuve
# et s'en contente. Un verrou plus vieux qu'un amorçage raisonnable est
# tenu pour abandonné.
LOCK_WAIT_S = 90
LOCK_STALE_S = 300
FRAICHE_S = 60

LOG_LINES = 200


def data_dir() -> Path:
    return Path(__file__).resolve().parent.parent / ".data" / "vinted"


def read_json(source: Path):
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_atomic(target: Path, payload) -> None:
    """Fichier temporaire puis renommage : le site lit ce fichier pendant qu'on
    l'écrit, et ne doit jamais tomber sur un JSON tronqué."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(f".{uuid.uuid4()}.tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def journal(message: str) -> None:
    log = data_dir() / "collect.log"
    stamp = datetime.now(PARIS).strftime("%Y-%m-%d %H:%M:%S")
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        previous = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
        kept = (previous + [f"{stamp}  {message}"])[-LOG_LINES:]
        log.write_text("\n".join(kept) + "\n", encoding="utf-8")
    except OSError:
        pass


def trace(message: str) -> None:
    print(f"  {message}", file=sys.stderr, flush=True)
    journal(message)


class Lock:
    """Verrou par fichier, *attendu* plutôt que refusé : l'appelant qui trouve
    le verrou pris veut la session que l'autre est en train d'ouvrir."""

    def __init__(self, path: Path):
        self._path = path
        self._held = False

    def acquire(self) -> bool:
        deadline = time.time() + LOCK_WAIT_S
        while True:
            try:
                if not self._path.exists() or time.time() - self._path.stat().st_mtime > LOCK_STALE_S:
                    self._path.parent.mkdir(parents=True, exist_ok=True)
                    self._path.write_text(str(os.getpid()), encoding="utf-8")
                    self._held = True
                    return True
            except OSError:
                return True
            if time.time() > deadline:
                return False
            time.sleep(1)

    def release(self) -> None:
        if self._held:
            self._path.unlink(missing_ok=True)
            self._held = False


def jwt_expiry(token: str) -> int | None:
    """La date d'expiration (`exp`, secondes epoch) d'un JWT, lue sans le
    vérifier : on n'a pas la clé, on ne veut que savoir quand renouveler."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        exp = json.loads(base64.urlsafe_b64decode(payload)).get("exp")
        return int(exp) if exp else None
    except (IndexError, ValueError, TypeError):
        return None


def session_valable(session, now: float) -> bool:
    return (
        isinstance(session, dict)
        and isinstance(session.get("cookies"), dict)
        and JETON in session["cookies"]
        and isinstance(session.get("expiresAt"), (int, float))
        and session["expiresAt"] / 1000 - now > MARGE_S
    )


def bloquer_le_superflu(route) -> None:
    """Ni images, ni polices, ni vidéos : on ne vient chercher qu'un cookie, et
    la page d'accueil pèse plusieurs mégaoctets. Les scripts passent — le défi
    Cloudflare en a besoin."""
    if route.request.resource_type in {"image", "media", "font"}:
        route.abort()
    else:
        route.continue_()


def ouvrir_session(visible: bool, headless: bool, verbose: bool) -> dict | None:
    """Visite l'accueil dans un navigateur et rend la session obtenue, ou
    `None` si le jeton n'est pas venu (défi Cloudflare non levé, réseau)."""
    auto = clic_automatique_possible() and not headless
    visible = visible or auto
    play = sync_playwright().start()
    try:
        ctx = lancer_navigateur(play, data_dir() / "profil", visible, headless)
    except RuntimeError:
        play.stop()
        raise
    try:
        ctx.route("**/*", bloquer_le_superflu)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        defi = Defi(page, trace, auto=auto, visible=visible)
        if not defi.franchir(ACCUEIL):
            trace("défi Cloudflare non levé")
            return None
        if defi.leves and verbose:
            print(f"  {defi.leves} défi(s) levé(s)", file=sys.stderr)

        deadline = time.time() + JETON_WAIT_S
        cookies: list[dict] = []
        while time.time() < deadline:
            cookies = [c for c in ctx.cookies() if "vinted.fr" in c.get("domain", "")]
            if any(c["name"] == JETON for c in cookies):
                break
            page.wait_for_timeout(1000)
        jar = {c["name"]: c["value"] for c in cookies}
        if JETON not in jar:
            trace(f"aucun jeton reçu (titre : {page.title()[:60]!r})")
            return None

        now = int(time.time())
        exp = jwt_expiry(jar[JETON]) or now + 20 * 3600
        return {
            "at": now * 1000,
            "expiresAt": exp * 1000,
            "userAgent": page.evaluate("navigator.userAgent"),
            "cookies": jar,
        }
    finally:
        try:
            ctx.close()
        finally:
            play.stop()


def main() -> int:
    parser = argparse.ArgumentParser(description="Ouvre une session Vinted anonyme et la dépose dans .data/vinted/session.json.")
    parser.add_argument("--force", action="store_true", help="ouvre une session neuve même si la présente est valable")
    parser.add_argument("--visible", action="store_true", help="fenêtre à l'écran (pour lever un défi Cloudflare à la main)")
    parser.add_argument("--headless", action="store_true", help="navigateur sans fenêtre (déconseillé : Cloudflare y est plus dur)")
    parser.add_argument("--quiet", action="store_true", help="pas de détail")
    args = parser.parse_args()
    verbose = not args.quiet

    session_file = data_dir() / "session.json"
    started = time.time()

    lock = Lock(data_dir() / "session.lock")
    if not lock.acquire():
        print("vinted : un autre amorçage n'en finit pas, on renonce", file=sys.stderr)
        return 3

    try:
        courante = read_json(session_file)
        recente = isinstance(courante, dict) and started - courante.get("at", 0) / 1000 < FRAICHE_S
        if session_valable(courante, started) and (recente or not args.force):
            fin = datetime.fromtimestamp(courante["expiresAt"] / 1000, PARIS)
            print(f"vinted : session déjà valable jusqu'au {fin:%d/%m %H:%M}, rien à faire")
            return 0

        try:
            session = ouvrir_session(args.visible, args.headless, verbose)
        except RuntimeError as error:
            print(f"vinted : ÉCHEC {error}", file=sys.stderr)
            journal(f"ÉCHEC lancement : {error}")
            return 2
        if session is None:
            print("vinted : ÉCHEC aucune session ouverte", file=sys.stderr)
            return 1

        write_atomic(session_file, session)
        elapsed = time.time() - started
        fin = datetime.fromtimestamp(session["expiresAt"] / 1000, PARIS)
        summary = f"session ouverte ({elapsed:.1f} s), valable jusqu'au {fin:%d/%m %H:%M}"
        print(f"vinted : {summary}")
        journal(summary)
        return 0
    finally:
        lock.release()


if __name__ == "__main__":
    sys.exit(main())
