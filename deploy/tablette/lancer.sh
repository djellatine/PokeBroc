#!/usr/bin/env bash
#
# Lanceur pour la tablette (Termux + proot-distro, Debian ARM64) — l'équivalent
# des unités systemd du VPS, réunies en un seul processus : proot n'a pas de
# systemd, et un superviseur de trois boucles suffit à ce que faisaient les
# minuteries.
#
#     bash /root/PokeBroc/deploy/tablette/lancer.sh
#
# Ce qu'il fait, calqué sur deploy/*.timer :
#   - le site (`npm start`), relancé s'il tombe — l'équivalent de Restart=always ;
#   - la veille puis le collecteur leboncoin, à chaque quart d'heure — les deux
#     minuteries étaient décalées de cinq minutes pour ne pas se disputer le
#     processeur ; ici elles s'enchaînent, ce qui règle la question ;
#   - la sauvegarde de `.data/` une fois par jour vers ~4 h, quatorze conservées
#     (même logique que deploy/sauvegarde.sh, cache d'images exclu).
#
# Il exporte aussi ce que `.env.local` — copié du PC — dit en chemins Windows :
# les interpréteurs Python des collecteurs, et `SESSION_HTTP=1` puisque la
# tablette sert en HTTP (réseau local ou Tailscale, déjà chiffré).
#
# Journaux dans /root/journal, un fichier de collecte par jour, purgés après
# quatorze jours. Sauvegardes dans /root/sauvegardes.

set -u

RACINE=${RACINE:-/root/PokeBroc}
VENV=${VENV:-/root/venv}
JOURNAL=${JOURNAL:-/root/journal}
SAUVEGARDES=${SAUVEGARDES:-/root/sauvegardes}
GARDER=14

# Un seul lanceur à la fois : Termux:Boot et un lancement à la main ne doivent
# pas empiler deux sites et deux boucles de collecte.
exec 9>/root/.pokebroc-lanceur.verrou
if ! flock -n 9; then
  echo "lanceur déjà actif, rien à faire"
  exit 0
fi

mkdir -p "$JOURNAL" "$SAUVEGARDES"

export NODE_ENV=production
# Les variables d'environnement réelles priment sur `.env.local` : ces exports
# corrigent les chemins Windows hérités du PC sans toucher au fichier.
export SESSION_HTTP=1
export LBC_PYTHON="$VENV/bin/python"
export CARDMARKET_PYTHON="$VENV/bin/python"

# Écran virtuel : le collecteur Cardmarket lance un navigateur *fenêtré* (plus
# crédible qu'un headless face à Cloudflare), et une fenêtre exige un serveur
# X. Xvfb en fournit un en mémoire, sans écran. S'il manque, Cardmarket à la
# demande échouera mais rien d'autre ne bouge : `apt install xvfb` le règle.
if command -v Xvfb >/dev/null; then
  if ! pgrep -x Xvfb >/dev/null; then
    Xvfb :9 -screen 0 1280x900x24 >>"$JOURNAL/xvfb.log" 2>&1 &
  fi
  export DISPLAY=:9
fi

echo "$(date '+%F %T') lanceur démarré" >>"$JOURNAL/lanceur.log"

# ------------------------------------------------------------------- le site

(
  cd "$RACINE" || exit 1
  while true; do
    npm run start >>"$JOURNAL/site.log" 2>&1
    echo "$(date '+%F %T') site arrêté (code $?), relance dans 5 s" >>"$JOURNAL/site.log"
    sleep 5
  done
) &

# ------------------------------------------------- collecte et sauvegarde

derniere_sauvegarde=""

while true; do
  jour=$(date +%F)
  log="$JOURNAL/collecte-$jour.log"

  echo "── $(date '+%F %T') veille" >>"$log"
  # Mêmes garde-fous de durée que les unités du VPS : 3 min pour la veille,
  # 5 min pour leboncoin — de quoi couper net un passage qui ne finirait pas.
  (cd "$RACINE" && timeout 180 npm run veille -- --quiet) >>"$log" 2>&1 \
    || echo "veille en échec (code $?)" >>"$log"

  echo "── $(date '+%F %T') leboncoin" >>"$log"
  (cd "$RACINE" && timeout 300 "$VENV/bin/python" collect/lbc.py --quiet) >>"$log" 2>&1 \
    || echo "leboncoin en échec (code $?)" >>"$log"

  if [ "$(date +%H)" = "04" ] && [ "$derniere_sauvegarde" != "$jour" ]; then
    horodatage=$(date +%Y-%m-%d_%H%M)
    archive="$SAUVEGARDES/data-$horodatage.tar.gz"
    # Nom temporaire puis renommage, comme deploy/sauvegarde.sh : une archive à
    # moitié écrite ne doit jamais passer pour une sauvegarde valide. Le profil
    # du navigateur Cardmarket est exclu comme le cache d'images : lourd, et
    # tout s'y reconstruit (au pire un défi Cloudflare à relever).
    if tar --create --gzip --file "$archive.partiel" \
           --directory "$RACINE" \
           --exclude='.data/img-cache' \
           --exclude='.data/cardmarket/profil' \
           .data >>"$log" 2>&1; then
      mv "$archive.partiel" "$archive"
      echo "sauvegarde : $archive" >>"$log"
    else
      rm -f "$archive.partiel"
      echo "sauvegarde en échec" >>"$log"
    fi
    ls -1t "$SAUVEGARDES"/data-*.tar.gz 2>/dev/null | tail -n "+$((GARDER + 1))" \
      | while read -r vieille; do rm -f "$vieille"; done
    derniere_sauvegarde=$jour
  fi

  # Ménage : journaux de collecte de plus de deux semaines, et un site.log qui
  # dépasserait 5 Mo (il ne dit presque rien en régime de croisière).
  find "$JOURNAL" -name 'collecte-*.log' -mtime +14 -delete 2>/dev/null
  if [ -f "$JOURNAL/site.log" ] && [ "$(stat -c %s "$JOURNAL/site.log")" -gt 5242880 ]; then
    : >"$JOURNAL/site.log"
  fi

  # Dormir jusqu'au prochain quart d'heure pile — la cadence des minuteries.
  sleep $((900 - $(date +%s) % 900))
done
