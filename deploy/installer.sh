#!/usr/bin/env bash
#
# Provisionnement d'un VPS neuf, à passer une seule fois.
#
#     sudo ./installer.sh pokebroc.fr https://github.com/djellatine/PokeBroc.git
#     sudo /srv/pokebroc/deploy/installer.sh --unites   # reprendre les unités seules
#
# Cible : Debian 12 ou Ubuntu 24.04, fraîchement installé, en root.
#
# Ce qu'il met en place
# ---------------------
# Un utilisateur `pokebroc` sans droits, le dépôt dans /srv/pokebroc, Node 24,
# un environnement virtuel Python pour `curl_cffi`, sept unités systemd — le
# site, puis trois minuteries avec leur service : la veille (15 min), le
# collecteur leboncoin (3 h) et la sauvegarde (quotidienne) — et Caddy devant,
# qui obtient seul son certificat.
#
# Ce qu'il ne fait pas
# --------------------
# Renseigner les secrets. Il écrit un `.env.local` avec une `SESSION_SECRET`
# tirée au sort — la seule qu'on puisse générer sans rien demander — et laisse
# les clés eBay et le jeton Telegram à remplir à la main. Le site tourne sans
# elles : eBay disparaît du fil, les alertes ne partent pas, rien ne casse.
#
# Idempotent : le relancer sur une installation existante reprend la
# configuration sans toucher à `.data/` ni à `.env.local`.

set -euo pipefail

RACINE=/srv/pokebroc
UTILISATEUR=pokebroc
UNITES=(pokebroc.service
        pokebroc-veille.service pokebroc-veille.timer
        pokebroc-lbc.service pokebroc-lbc.timer
        pokebroc-sauvegarde.service pokebroc-sauvegarde.timer)

if [ "$(id -u)" -ne 0 ]; then
  echo "À lancer en root : sudo $0 …" >&2
  exit 1
fi

# --------------------------------------------------------- unités seulement

installer_unites() {
  local source=$1
  for unite in "${UNITES[@]}"; do
    install -m 0644 "$source/deploy/$unite" "/etc/systemd/system/$unite"
  done
  systemctl daemon-reload
  echo "✅ unités reprises et rechargées"
}

if [ "${1:-}" = "--unites" ]; then
  installer_unites "$RACINE"
  systemctl restart pokebroc
  exit 0
fi

# ------------------------------------------------------------------ arguments

DOMAINE=${1:-}
DEPOT=${2:-https://github.com/djellatine/PokeBroc.git}

if [ -z "$DOMAINE" ]; then
  echo "Usage : sudo $0 <domaine> [url-du-depot]" >&2
  echo "        sudo $0 --unites" >&2
  exit 1
fi

echo "→ domaine : $DOMAINE"
echo "→ dépôt   : $DEPOT"

# ---------------------------------------------------------------- paquets

echo "→ paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg python3 python3-venv \
                       debian-keyring debian-archive-keyring apt-transport-https

# Node 24 : ni Debian 12 ni Ubuntu 24.04 ne le fournissent, et le projet
# l'exige — il exécute le TypeScript nativement, ce dont dépendent la veille et
# la suite de tests (voir `tests/resolve-ts.mjs`).
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v24" ]; then
  echo "→ Node 24 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "→ Caddy"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

# ---------------------------------------------------------------- utilisateur

if ! id -u "$UTILISATEUR" >/dev/null 2>&1; then
  echo "→ utilisateur $UTILISATEUR"
  # `--system` : ce compte ne sert qu'à faire tourner le site. Pas de shell de
  # connexion serait plus strict encore, mais le déploiement passe par SSH sous
  # cette identité — il lui faut donc bash.
  useradd --system --create-home --home-dir "/home/$UTILISATEUR" \
          --shell /bin/bash "$UTILISATEUR"
fi

# ------------------------------------------------------------------- dépôt

if [ ! -d "$RACINE/.git" ]; then
  echo "→ clone dans $RACINE"
  mkdir -p "$RACINE"
  chown "$UTILISATEUR:$UTILISATEUR" "$RACINE"
  sudo -u "$UTILISATEUR" git clone --quiet "$DEPOT" "$RACINE"
else
  echo "→ dépôt déjà présent, mise à jour"
  sudo -u "$UTILISATEUR" git -C "$RACINE" fetch --quiet origin main
  sudo -u "$UTILISATEUR" git -C "$RACINE" reset --hard --quiet origin/main
fi

# ------------------------------------------------------------------ secrets

ENV="$RACINE/.env.local"
if [ ! -f "$ENV" ]; then
  echo "→ .env.local (secrets à compléter)"
  # `SESSION_SECRET` explicite plutôt que la clé de repli de `lib/auth.ts` :
  # celle-ci vit dans `.data/session-secret`, et une restauration de sauvegarde
  # qui l'oublierait déconnecterait tout le monde sans que rien ne l'explique.
  cat > "$ENV" <<ENVEOF
# Écrit par deploy/installer.sh. Jamais dans git — voir .gitignore.

SESSION_SECRET=$(openssl rand -hex 32)

# Sert au plan de site, et **inliné à la construction** : changer cette valeur
# impose un \`npm run build\`, un redémarrage ne suffit pas.
NEXT_PUBLIC_SITE_URL=https://$DOMAINE

# Facultatif — sans elles, eBay disparaît simplement du fil.
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_MARKETPLACE=EBAY_FR

# Facultatif — sans lui, la veille balaie mais n'envoie aucune alerte.
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_NAME=
ENVEOF
  chmod 600 "$ENV"
  chown "$UTILISATEUR:$UTILISATEUR" "$ENV"
else
  echo "→ .env.local déjà là, laissé intact"
fi

# --------------------------------------------------------------- Python

if [ ! -d "$RACINE/.venv" ]; then
  echo "→ environnement virtuel Python"
  sudo -u "$UTILISATEUR" python3 -m venv "$RACINE/.venv"
fi
echo "→ curl_cffi"
sudo -u "$UTILISATEUR" "$RACINE/.venv/bin/pip" install --quiet --upgrade pip
sudo -u "$UTILISATEUR" "$RACINE/.venv/bin/pip" install --quiet -r "$RACINE/collect/requirements.txt"

# ------------------------------------------------------------- construction

echo "→ npm ci et construction (quelques minutes)"
sudo -u "$UTILISATEUR" bash -c "cd '$RACINE' && npm ci --no-audit --no-fund && npm run build"

# ------------------------------------------------------------------- sudo

# Le déploiement tourne sous `pokebroc` et doit redémarrer le service. Une seule
# commande autorisée, nommément : donner `systemctl` en entier reviendrait à
# donner la machine.
echo "→ règle sudo pour le redémarrage"
cat > /etc/sudoers.d/pokebroc <<SUDOEOF
pokebroc ALL=(root) NOPASSWD: /usr/bin/systemctl restart pokebroc
pokebroc ALL=(root) NOPASSWD: /srv/pokebroc/deploy/installer.sh --unites
SUDOEOF
chmod 0440 /etc/sudoers.d/pokebroc
visudo -c -q -f /etc/sudoers.d/pokebroc

# ---------------------------------------------------------------- systemd

mkdir -p /var/backups/pokebroc
chmod 700 /var/backups/pokebroc

echo "→ unités systemd"
installer_unites "$RACINE"
systemctl enable --now pokebroc.service
systemctl enable --now pokebroc-veille.timer
systemctl enable --now pokebroc-lbc.timer
systemctl enable --now pokebroc-sauvegarde.timer

# ------------------------------------------------------------------ Caddy

echo "→ Caddy sur $DOMAINE"
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy
sed "s/^DOMAINE {/${DOMAINE} {/" "$RACINE/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy || systemctl restart caddy

# ------------------------------------------------------------------- bilan

echo
echo "──────────────────────────────────────────────────────────────"
echo " Installé. Il reste trois choses à faire :"
echo
echo " 1. Faire pointer un enregistrement A de $DOMAINE vers cette machine."
echo "    Caddy obtiendra son certificat tout seul, dans la minute qui suit."
echo
echo " 2. Compléter $ENV (clés eBay, jeton Telegram), puis :"
echo "      sudo -u $UTILISATEUR bash -c 'cd $RACINE && npm run build'"
echo "      sudo systemctl restart pokebroc"
echo "    La reconstruction est nécessaire pour NEXT_PUBLIC_SITE_URL, qui est"
echo "    inliné ; les autres variables se contentent du redémarrage."
echo
echo " 3. Déposer la clé publique de déploiement dans"
echo "    /home/$UTILISATEUR/.ssh/authorized_keys — voir le README."
echo
echo " État : systemctl status pokebroc"
echo "        systemctl list-timers 'pokebroc*'"
echo "──────────────────────────────────────────────────────────────"
