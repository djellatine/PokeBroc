#!/data/data/com.termux/files/usr/bin/sh
#
# Démarrage automatique de PokeBroc quand la tablette redémarre.
#
# À installer une fois, côté Termux (pas dans le Debian) :
#
#     mkdir -p ~/.termux/boot
#     cp ~/PokeBroc-boot.sh ~/.termux/boot/pokebroc.sh   # ou copie du dépôt
#     chmod +x ~/.termux/boot/pokebroc.sh
#
# Termux:Boot exécute tout ce qui vit dans ~/.termux/boot/ à chaque démarrage
# d'Android — à condition d'avoir ouvert l'application Termux:Boot au moins une
# fois, et exempté Termux de l'optimisation de batterie.

# Le réveil permanent d'abord : sans lui, Android endort le processeur et les
# quarts d'heure de collecte s'étirent en heures.
termux-wake-lock

# Puis le lanceur, dans le Debian. Le verrou du lanceur rend la chose
# idempotente : si un exemplaire tourne déjà, celui-ci se retire sans bruit.
proot-distro login debian -- bash /root/PokeBroc/deploy/tablette/lancer.sh &
