#!/usr/bin/env bash
#
# Déploiement d'une version sur le serveur.
#
# Lancé par GitHub Actions à travers SSH, une fois les tests passés — et pas
# avant : voir `.github/workflows/deploiement.yml`. Ce script arrive par le tuyau
# SSH (`ssh … 'bash -s' < deploy/deployer.sh`), donc c'est toujours la version
# du dépôt qu'on déploie qui s'exécute, jamais une copie oubliée sur le serveur.
#
# Ce qu'il garantit
# -----------------
# Le site répond après le déploiement, ou revient à la version d'avant. Sans ce
# filet, « pousser sur git met en prod » signifie aussi « pousser une régression
# met le site par terre jusqu'à ce qu'on s'en aperçoive ». La CI a beau tout
# vérifier en amont, elle ne construit pas avec le `.env.local` du serveur, et
# ne peut donc pas voir une variable d'environnement manquante.
#
# Ce qu'il ne touche jamais
# -------------------------
# `.data/` et `.env.local`. Le premier porte les comptes, les favoris et la clé
# de session ; le second les secrets. Tous deux sont ignorés par git, donc
# `git reset --hard` les laisse en place — c'est voulu, et c'est la raison pour
# laquelle le déploiement peut se permettre d'être brutal sur le reste.

set -euo pipefail

RACINE=/srv/pokebroc
# Le temps que `next start` se lève. Mesuré à ~1 s sur un VPS modeste ; trente
# secondes couvrent un démarrage à froid après un `npm ci` qui a tout retéléchargé.
DELAI_SANTE=30

cd "$RACINE"

precedent=$(git rev-parse HEAD)
echo "→ version en place : ${precedent:0:8}"

# --------------------------------------------------------------- construction

construire() {
  # `npm ci` complet, dev-dépendances comprises : `next build` a besoin de
  # TypeScript et de Tailwind, qui sont en devDependencies. `--omit=dev` ferait
  # échouer la construction, pas l'exécution — donc à l'endroit le plus coûteux.
  npm ci --no-audit --no-fund
  npm run build
}

# ------------------------------------------------------------------- santé

repond() {
  # `--fail` pour qu'un 500 compte comme un échec : sans lui, curl rend 0 sur
  # une page d'erreur, et le déploiement se déclarerait réussi sur un site mort.
  curl --silent --show-error --fail --max-time 5 -o /dev/null http://127.0.0.1:3000/
}

attendre_sante() {
  for _ in $(seq 1 "$DELAI_SANTE"); do
    if repond; then return 0; fi
    sleep 1
  done
  return 1
}

# ---------------------------------------------------------------- déploiement

echo "→ récupération de origin/main"
git fetch --quiet origin main
git reset --hard --quiet origin/main
nouveau=$(git rev-parse HEAD)
echo "→ version visée : ${nouveau:0:8}"

if [ "$precedent" = "$nouveau" ]; then
  echo "→ déjà à jour, reconstruction quand même (les dépendances ont pu changer)"
fi

# Les dépendances Python vivent hors de npm : sans cela, un ajout à
# `collect/requirements.txt` ne serait jamais installé et le collecteur
# tomberait au passage suivant de sa minuterie, loin d'ici.
echo "→ dépendances Python"
"$RACINE/.venv/bin/pip" install --quiet --upgrade -r collect/requirements.txt

echo "→ construction"
construire

echo "→ redémarrage"
sudo systemctl restart pokebroc

if attendre_sante; then
  echo "✅ ${nouveau:0:8} en ligne"
  # Les minuteries relisent le code à chaque passage : rien à redémarrer pour
  # elles. Leurs *unités*, en revanche, peuvent avoir changé dans le dépôt — et
  # personne ne s'en apercevrait, puisque la version installée continue de
  # tourner sans rien dire. Le déploiement ne les reprend pas de lui-même : cela
  # demanderait d'élargir la règle sudo à la copie de fichiers dans
  # /etc/systemd/system, pour une chose qui change une fois par an.
  for unite in deploy/pokebroc*.service deploy/pokebroc*.timer; do
    installee="/etc/systemd/system/$(basename "$unite")"
    if ! cmp --silent "$unite" "$installee" 2>/dev/null; then
      echo "ℹ  $(basename "$unite") diffère de la version installée."
      echo "   Reprendre avec : sudo /srv/pokebroc/deploy/installer.sh --unites"
    fi
  done
  exit 0
fi

# ------------------------------------------------------------- retour arrière

echo "❌ le site ne répond pas — retour à ${precedent:0:8}" >&2
git reset --hard --quiet "$precedent"
construire
sudo systemctl restart pokebroc

if attendre_sante; then
  echo "↩️  revenu à ${precedent:0:8}, le site répond." >&2
else
  # Le pire cas : la version d'avant ne se relève pas non plus. Le problème
  # n'est alors pas dans le code, et le dire évite de chercher au mauvais
  # endroit — regarder `journalctl -u pokebroc` avant toute chose.
  echo "🔥 la version précédente ne répond pas davantage : la panne n'est pas" >&2
  echo "   dans ce déploiement. journalctl -u pokebroc -n 50" >&2
fi

exit 1
