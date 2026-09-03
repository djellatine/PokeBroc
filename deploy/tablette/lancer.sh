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
#   - la mise à jour depuis GitHub, à chaque quart d'heure aussi — l'équivalent
#     de deploy/deployer.sh, que la CI lançait sur le VPS ; ici la tablette
#     tire elle-même, aucun port n'étant ouvert vers elle ;
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
COPIE=/root/.pokebroc-lanceur.sh

# Bash lit un script au fil de l'exécution : si `git pull` réécrit ce fichier
# pendant qu'il tourne, la suite se lit de travers. On s'exécute donc depuis
# une copie, que la mise à jour ne touche pas ; un lanceur modifié se relance
# lui-même (voir `redemarrer_lanceur`).
if [ "$0" != "$COPIE" ]; then
  cp -f "$0" "$COPIE"
  exec bash "$COPIE" "$@"
fi

# Un seul lanceur à la fois : Termux:Boot et un lancement à la main ne doivent
# pas empiler deux sites et deux boucles de collecte. Le verrou est tenu sur le
# descripteur 9, que `exec bash` conserve : un lanceur qui se relance ne se
# trouve pas lui-même déjà actif.
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

echo "$(date '+%F %T') lanceur démarré ($(cd "$RACINE" && git rev-parse --short HEAD))" >>"$JOURNAL/lanceur.log"

# ------------------------------------------------------------------- le site

(
  cd "$RACINE" || exit 1
  while true; do
    npm run start >>"$JOURNAL/site.log" 2>&1
    echo "$(date '+%F %T') site arrêté (code $?), relance dans 5 s" >>"$JOURNAL/site.log"
    sleep 5
  done
) &
SITE_PID=$!

# Tuer `next-server` suffit à relancer le site : la boucle ci-dessus le
# redémarre cinq secondes plus tard, avec ce que `.next` contient alors.
redemarrer_site() {
  pkill -f next-server
}

# Le site met une à deux minutes à se lever sur ce processeur ; `--fail` pour
# qu'une page d'erreur compte comme un échec, comme dans deploy/deployer.sh.
attendre_site() {
  for _ in $(seq 1 180); do
    if curl --silent --fail --max-time 5 -o /dev/null http://127.0.0.1:3000/; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# ------------------------------------------------------------- mise à jour

# Ce qui, s'il change, exige une reconstruction : le site sert ce que
# `npm run build` a construit, pas les sources. Le reste — collecteurs, doc,
# scripts — est relu à chaque passage.
FICHIERS_SITE='^(app/|lib/|components/|public/|proxy\.ts|next\.config\.ts|tsconfig\.json|package\.json|package-lock\.json)'

# Construit la nouvelle version à côté de l'ancienne, puis échange.
#
# `next build` dure quinze à trente minutes ici, pendant lesquelles le site
# doit continuer de servir : il construit donc dans `.next-nouveau` (voir
# `distDir` dans next.config.ts), et la bascule tient en deux renommages. Si le
# site ne se relève pas sur la nouvelle version, on revient à l'ancienne — même
# retour arrière que deploy/deployer.sh, en moins cher : rien à reconstruire.
reconstruire_site() {
  local cible=$1
  echo "construction de ${cible:0:8} dans .next-nouveau ($(date '+%T'))"
  rm -rf .next-nouveau
  if ! NEXT_DIST_DIR=.next-nouveau npm run build >>"$JOURNAL/build.log" 2>&1; then
    echo "construction en échec — site inchangé, voir build.log"
    rm -rf .next-nouveau
    return 1
  fi
  echo "construction terminée ($(date '+%T')), bascule"
  rm -rf .next-ancien
  mv .next .next-ancien && mv .next-nouveau .next
  redemarrer_site
  if attendre_site; then
    echo "site en ligne sur ${cible:0:8}"
    rm -rf .next-ancien
    return 0
  fi
  echo "le site ne répond pas sur ${cible:0:8} : retour à la construction précédente"
  rm -rf .next-echec
  mv .next .next-echec && mv .next-ancien .next
  redemarrer_site
  if attendre_site; then
    echo "revenu à la construction précédente — le dépôt, lui, est sur ${cible:0:8} : à corriger, puis reconstruire à la main"
  else
    echo "le site ne se relève pas non plus : voir site.log"
  fi
  return 1
}

# Le lanceur lui-même a changé : on relance le site et ce script, qui repart
# de sa nouvelle copie. Le verrou suit (descripteur 9 conservé par `exec`).
redemarrer_lanceur() {
  echo "le lanceur a changé : redémarrage"
  kill "$SITE_PID" 2>/dev/null
  pkill -f next-server
  exec bash "$RACINE/deploy/tablette/lancer.sh"
}

mettre_a_jour() {
  cd "$RACINE" || return 1
  if ! git fetch --quiet origin main; then
    echo "mise à jour : GitHub injoignable, on réessaie au prochain quart d'heure"
    return 1
  fi
  local courant cible
  courant=$(git rev-parse HEAD)
  cible=$(git rev-parse origin/main)
  [ "$courant" = "$cible" ] && return 0

  # `npm` réécrit package-lock.json à sa façon sur cette plateforme, et
  # `next build` ajoute à tsconfig.json le dossier de types de `.next-nouveau` :
  # deux modifications qu'on ne veut pas garder. Toute autre, si : on ne tire
  # pas par-dessus, on le dit.
  git checkout --quiet -- package-lock.json tsconfig.json 2>/dev/null
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "mise à jour : le dépôt porte des modifications locales, on n'y touche pas"
    git status --short --untracked-files=no
    return 1
  fi
  if ! git merge --ff-only --quiet origin/main; then
    echo "mise à jour : avance rapide impossible vers ${cible:0:8}"
    return 1
  fi
  echo "mise à jour : ${courant:0:8} → ${cible:0:8}"

  local modifies
  modifies=$(git diff --name-only "$courant" "$cible")
  if echo "$modifies" | grep -q '^collect/requirements\.txt$'; then
    "$VENV/bin/pip" install --quiet --upgrade -r collect/requirements.txt
  fi
  if echo "$modifies" | grep -q '^package-lock\.json$'; then
    npm ci --no-audit --no-fund >>"$JOURNAL/build.log" 2>&1 || echo "npm ci en échec, voir build.log"
    git checkout --quiet -- package-lock.json 2>/dev/null
  fi
  if echo "$modifies" | grep -qE "$FICHIERS_SITE"; then
    reconstruire_site "$cible"
  fi
  if echo "$modifies" | grep -q '^deploy/tablette/lancer\.sh$'; then
    redemarrer_lanceur
  fi
}

# ------------------------------------------------- collecte et sauvegarde

derniere_sauvegarde=""

while true; do
  jour=$(date +%F)
  log="$JOURNAL/collecte-$jour.log"

  echo "── $(date '+%F %T') veille" >>"$log"
  # Garde-fou de durée, pour couper net un passage qui ne finirait pas. Dix
  # minutes et non trois : chaque requête a désormais son propre délai (quinze
  # à vingt secondes), et une soirée où Vinted traîne sur chaque carte dépassait
  # les trois minutes — le passage était tué sans rien écrire, ni instantané ni
  # journal, et ces trous-là passaient pour des alertes perdues.
  (cd "$RACINE" && timeout 600 npm run veille -- --quiet) >>"$log" 2>&1 \
    || echo "veille en échec (code $?)" >>"$log"

  echo "── $(date '+%F %T') leboncoin" >>"$log"
  (cd "$RACINE" && timeout 300 "$VENV/bin/python" collect/lbc.py --quiet) >>"$log" 2>&1 \
    || echo "leboncoin en échec (code $?)" >>"$log"

  # Après la collecte et non avant : une construction de vingt minutes ne doit
  # pas retarder le passage de la veille.
  echo "── $(date '+%F %T') mise à jour" >>"$log"
  mettre_a_jour >>"$log" 2>&1

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
