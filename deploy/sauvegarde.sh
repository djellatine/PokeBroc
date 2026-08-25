#!/usr/bin/env bash
#
# Sauvegarde de `.data/`, une fois par jour.
#
# Ce dossier est le seul état irremplaçable du site : comptes, empreintes de
# mots de passe, favoris, clé de session, historique des annonces croisées. Le
# reste — instantanés du fil, lots, cache d'images — se reconstruit tout seul au
# passage suivant des minuteries.
#
# `img-cache/` est donc exclu. C'est 23 des 24 Mo actuels, plafonnés à 300, et
# pas un octet ne mérite d'être conservé : chaque fichier se retélécharge depuis
# TCGdex. L'inclure ferait des archives cent fois plus lourdes pour rien.
#
# Ce que cette sauvegarde protège, et ce qu'elle ne protège pas
# -------------------------------------------------------------
# Elle protège d'une bêtise : un `rm` malheureux, un fichier corrompu par un
# arrêt brutal, une migration ratée. Elle ne protège **pas** de la perte du
# serveur, puisqu'elle vit sur le même disque. Pour cela, activez les instantanés
# de votre hébergeur — c'est une case à cocher chez tous les trois.

set -euo pipefail

SOURCE=/srv/pokebroc/.data
DESTINATION=/var/backups/pokebroc
# Deux semaines : assez pour s'apercevoir d'une corruption silencieuse, et
# ~1 Mo par archive une fois le cache d'images écarté.
GARDER=14

if [ ! -d "$SOURCE" ]; then
  echo "sauvegarde : $SOURCE absent" >&2
  exit 1
fi

mkdir -p "$DESTINATION"
horodatage=$(date +%Y-%m-%d_%H%M)
archive="$DESTINATION/data-$horodatage.tar.gz"

# Écriture sous nom temporaire puis renommage, pour la même raison que
# `writeJson` côté site : une archive à moitié écrite ne doit jamais porter un
# nom qui la ferait prendre pour une sauvegarde valide.
tar --create --gzip --file "$archive.partiel" \
    --directory /srv/pokebroc \
    --exclude='.data/img-cache' \
    .data
mv "$archive.partiel" "$archive"

chmod 600 "$archive"

# Rotation : on ne garde que les plus récentes.
mapfile -t anciennes < <(ls -1t "$DESTINATION"/data-*.tar.gz 2>/dev/null | tail -n "+$((GARDER + 1))")
for vieille in "${anciennes[@]:-}"; do
  [ -n "$vieille" ] && rm -f "$vieille"
done

taille=$(du -h "$archive" | cut -f1)
echo "sauvegarde : $archive ($taille), ${#anciennes[@]} archive(s) purgée(s)"
