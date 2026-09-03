"""Yeux et doigt sur l'écran virtuel de la tablette, depuis le PC, par VNC.

Sert à lever le défi Cloudflare de Cardmarket à distance : le collecteur
tourne sur la tablette dans un Chromium fenêtré, sur un écran virtuel (Xvfb :9)
que personne ne regarde. Un serveur VNC branché sur cet écran, et ce script
côté PC, permettent de voir la page et de cocher la case — voir LISEZMOI.md,
« Lever le défi Cloudflare à distance ».

    pip install vncdotool
    python deploy/tablette/ecran.py capture ecran.png     # ce que montre l'écran
    python deploy/tablette/ecran.py click 213 480         # un clic à ces coordonnées

L'adresse est celle de la tablette dans Tailscale ; le serveur VNC n'a pas de
mot de passe, il n'écoute que le temps de l'amorçage et n'est joignable que
par le réseau Tailscale.
"""

import sys

from vncdotool import api

HOST = "100.80.154.77::5900"


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    action = sys.argv[1]
    client = api.connect(HOST, password=None, timeout=30)
    try:
        if action == "capture":
            client.captureScreen(sys.argv[2])
            print("capture :", sys.argv[2])
        elif action == "click":
            x, y = int(sys.argv[2]), int(sys.argv[3])
            client.mouseMove(x, y)
            client.pause(0.3)
            # `mousePress` enfonce et relâche : un clic complet, tel que le
            # serveur X le reçoit d'une vraie souris.
            client.mousePress(1)
            print("clic en", x, y)
        else:
            raise SystemExit(f"action inconnue : {action}")
    finally:
        client.disconnect()
        api.shutdown()


if __name__ == "__main__":
    main()
