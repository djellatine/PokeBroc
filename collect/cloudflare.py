"""
Ce que Cardmarket et Vinted ont en commun : un navigateur piloté, et le défi
Cloudflare qu'il faut savoir franchir.

Extrait de `collect/cardmarket.py` le 20 septembre 2026, quand Vinted a mis
Cloudflare devant tout son domaine (voir l'en-tête de `collect/vinted_session.py`).
Les deux collecteurs lancent le même genre de navigateur — un vrai, fenêtré, sur
un profil persistant — et affrontent le même interstitiel ; la manière de le
lever (un clic XTEST sur la tablette, l'utilisateur sur un bureau) n'a aucune
raison d'exister deux fois.

Deux choses ici, et rien d'autre :

- `lancer_navigateur` : le navigateur tel que Cloudflare le tolère — sans les
  marques d'automatisation, hors écran ou sur l'écran virtuel, Edge de
  préférence et le Chromium de Playwright à défaut ;
- `Defi` : reconnaître l'interstitiel et le lever, selon ce que la machine
  permet.

Tout ce qui est propre à un site — ses pages, ce qu'on y lit, ses fichiers —
reste dans le collecteur qui l'appelle.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, Playwright

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

# Le rendu d'une page est fait à l'ouverture, pas par un appel réseau différé :
# un court répit après `domcontentloaded` suffit à la laisser se peupler.
# Mesuré à ~2 s sur Cardmarket ; on prend une marge.
SETTLE_MS = 2500

TIMEOUT_MS = 45000

# Vrai dans l'interstitiel Cloudflare, faux dans une vraie page : les éléments
# de la page de défi et l'objet de configuration que son script pose.
CHALLENGE_JS = """() =>
  !!document.querySelector('#challenge-error-text, #challenge-stage, #challenge-running, input[name="cf-turnstile-response"]')
  || typeof window._cf_chl_opt !== 'undefined'
"""


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


def lancer_navigateur(
    play: Playwright,
    profil: Path,
    visible: bool = False,
    headless: bool = False,
) -> BrowserContext:
    """Un navigateur tel que Cloudflare le tolère, sur un profil persistant.

    Par défaut la fenêtre est **hors écran** (`--window-position` très négatif) :
    un vrai navigateur, qui passe Cloudflare bien mieux qu'un *headless*, mais
    invisible. `visible=True` la ramène à l'écran — pour lever un défi à la
    main sur un bureau, ou pour que `xdotool` clique sur l'écran virtuel de la
    tablette. Le profil garde le laissez-passer (`cf_clearance`) d'un passage
    à l'autre.

    Lève `RuntimeError` si aucun navigateur ne démarre.
    """
    profil.mkdir(parents=True, exist_ok=True)

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
    # devoir lever un défi un peu plus souvent.
    derniere_erreur: Exception | None = None
    for canal in ("msedge", None):
        try:
            # Fenêtre à l'écran : pas d'émulation de viewport, sinon
            # `innerHeight` ment (900 émulés pour 755 réels) et la hauteur
            # des barres du navigateur, dont dépend le clic, est fausse.
            return play.chromium.launch_persistent_context(
                user_data_dir=str(profil),
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
        except Exception as error:  # noqa: BLE001 - on tente le canal suivant
            derniere_erreur = error
    raise RuntimeError(
        f"Impossible de lancer un navigateur ({derniere_erreur}). "
        f"Edge ou le Chromium de Playwright sont-ils installés, et le "
        f"profil `{profil}` n'est-il pas déjà ouvert ailleurs ?"
    )


class Defi:
    """L'interstitiel Cloudflare d'une page : le reconnaître, le lever.

    Trois stratégies, selon la machine. **Automatique** (tablette : X et
    `xdotool`) : on coche la case par XTEST. **Visible** (bureau, `--visible`) :
    l'utilisateur la coche, on guette que la page change. **Invisible** :
    Cloudflare sert parfois son défi à la première navigation puis le résout
    seul ; deux reprises espacées suffisent le plus souvent.
    """

    def __init__(self, page: Page, trace: Callable[[str], None], auto: bool, visible: bool):
        self._page = page
        self._trace = trace
        self._auto = auto
        self._visible = visible
        self.leves = 0
        # Un défi que trois clics n'ont pas levé ne tombera pas au quatrième :
        # les pages suivantes n'ont droit qu'à un essai, pour ne pas étirer
        # le passage à cinq minutes de clics dans le vide.
        self._tenace = False

    def present(self) -> bool:
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

    def franchir(self, url: str) -> bool:
        """Charge `url` et franchit le défi s'il y en a un. Rend `True` si on
        tombe sur la vraie page, `False` si le défi persiste."""
        self._page.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        self._page.wait_for_timeout(SETTLE_MS)
        if not self.present():
            return True

        if self._auto:
            return self._lever()

        if self._visible:
            deadline = time.time() + VISIBLE_WAIT_S
            while time.time() < deadline:
                self._page.wait_for_timeout(2000)
                if not self.present():
                    return self._page_chargee()
            return False

        for _ in range(2):
            self._page.wait_for_timeout(4000)
            self._page.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            self._page.wait_for_timeout(SETTLE_MS)
            if not self.present():
                return True
        return not self.present()

    def _page_chargee(self) -> bool:
        """Une fois le défi levé, Cloudflare recharge la vraie page : on la
        laisse arriver avant de la lire, sinon on lit dans le vide."""
        try:
            self._page.wait_for_load_state("domcontentloaded", timeout=TIMEOUT_MS)
        except Exception:  # noqa: BLE001
            pass
        self._page.wait_for_timeout(SETTLE_MS)
        return not self.present()

    # ------------------------------------------------ clic automatique (X11)

    def _lever(self) -> bool:
        """Coche la case Cloudflare avec `xdotool`, jusqu'à `AUTO_ESSAIS` fois.

        Rend `True` si la vraie page a suivi. On attend le cadre Turnstile,
        on laisse la case remplacer le spinner, on clique, on laisse
        Cloudflare recharger ; un essai raté (case pas encore là, cadre
        rechargé entre-temps) est simplement refait.
        """
        essais = 1 if self._tenace else AUTO_ESSAIS
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
                if not self.present():
                    if self._page_chargee():
                        self.leves += 1
                        self._tenace = False
                        return True
                    break
        self._tenace = True
        return not self.present()

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
