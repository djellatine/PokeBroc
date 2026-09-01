# Le serveur tablette — dossier de bord

Tout ce qu'il faut savoir pour dépanner l'hébergement de PokeBroc sur la
tablette, tel qu'il a été monté le 1er septembre 2026. Le *pourquoi* des choix
est dans le README (section « La variante tablette ») ; ici, c'est le *comment*
et le *où*, pour retrouver ses petits un jour de panne.

## La machine

- **Blackview Tab 13** — Android + surcouche DokeOS, MediaTek Helio G85, 6 Go.
- Branchée au secteur en permanence, sur le Wi-Fi de la box (IP résidentielle —
  c'est elle qui fait passer Datadome et Cloudflare).
- L'IP locale peut changer après un redémarrage de la box : si le téléphone ne
  joint plus le site, revérifier l'IP (Paramètres → Wi-Fi), ou réserver une IP
  fixe dans l'interface de la box (jamais fait à ce jour).
- L'écran peut s'éteindre : le `termux-wake-lock` maintient le processeur.

## La pile, couche par couche

| Couche | Quoi | D'où |
| --- | --- | --- |
| Termux | le terminal Android | **F-Droid** — jamais le Play Store (version morte) |
| Termux:Boot, Termux:Widget | démarrage auto (bloqué), bouton de relance | F-Droid aussi — même source obligatoire (signatures) |
| proot-distro | un vrai Debian ARM64 sans root | `pkg install proot-distro` puis `proot-distro install debian` |
| Debian | tout le reste vit dedans | `proot-distro login debian` pour y entrer |

Dans le Debian :

- **Node 22** (NodeSource) — le site et la veille.
- **`/root/PokeBroc`** — le dépôt, cloné depuis GitHub (public).
- **`/root/venv`** — le venv Python : `playwright` + Chromium (`playwright
  install --with-deps chromium`), `curl_cffi`. C'est lui que le lanceur exporte
  en `LBC_PYTHON` et `CARDMARKET_PYTHON`.
- **`/root/PokeBroc/.data`** — **la copie vivante des données** depuis le
  1er septembre 2026 (209 Mo transférés du PC par zip + serveur HTTP local).
  Celle du PC est figée à cette date ; ne plus collecter depuis le PC.
- `.env.local` — copié du PC ; ses chemins Python Windows sont **écrasés par
  les exports du lanceur**, inutile de le corriger.

## Comment ça tourne

Un seul script fait tout : `deploy/tablette/lancer.sh`, à lire pour le détail.
En résumé : le site (relancé s'il tombe), veille puis leboncoin à chaque quart
d'heure, sauvegarde vers 4 h du matin, un Xvfb pour Cardmarket, et un verrou
(`/root/.pokebroc-lanceur.verrou`) qui rend tout double lancement inoffensif.

- Journaux : `/root/journal` — `site.log`, `lanceur.log`, `collecte-AAAA-MM-JJ.log`
  (un par jour, purgés après 14 jours).
- Sauvegardes : `/root/sauvegardes`, quatorze `data-*.tar.gz` glissants.
- `SESSION_HTTP=1` (posé par le lanceur) : cookie de session sans `secure`,
  sinon impossible de se connecter en HTTP depuis le téléphone.

### Le lancer, l'arrêter

- **Lancer** : le bouton **PokeBroc** du widget Termux sur l'écran d'accueil —
  ou à la main, dans Termux :
  `proot-distro login debian -- bash /root/PokeBroc/deploy/tablette/lancer.sh`
- **Arrêter** : Ctrl+C dans la session où il tourne (la barre de touches de
  Termux a le bouton CTRL).
- **Après un redémarrage de la tablette, rien ne repart tout seul** : voir
  ci-dessous. **Un appui sur le bouton PokeBroc suffit** — c'est le seul geste
  à retenir. Le verrou rend un double appui inoffensif, le site met une à deux
  minutes à répondre, et Tailscale se reconnecte de lui-même.

### Accéder au site

- **Sur la tablette** : `http://localhost:3000`.
- **Depuis le téléphone, à la maison** (même Wi-Fi) : `http://192.168.1.XX:3000`
  — l'IP est dans Paramètres → Wi-Fi → le réseau connecté → « Adresse IP »,
  ou dans le journal du site, qui l'affiche en démarrant :
  `proot-distro login debian -- grep -i network /root/journal/site.log`
- **Depuis n'importe où (4G compris)** : Tailscale. L'appli (Play Store) sur la
  tablette **et** le téléphone, connectée au **même compte** sur les deux ;
  l'appli du téléphone liste alors la tablette avec son adresse `100.x.y.z` →
  ouvrir `http://100.x.y.z:3000` (ou `http://<nom-de-la-tablette>:3000` via
  MagicDNS). Aucun port ouvert sur la box, personne d'autre ne peut joindre le
  site. L'adresse `192.168...`, elle, ne marche **que** sur le Wi-Fi de la box.
- La connexion au compte en HTTP ne tient que grâce à `SESSION_HTTP=1` — déjà
  posé par le lanceur, rien à faire.

### Le démarrage automatique, et pourquoi il ne marche pas

`~/.termux/boot/pokebroc.sh` (copie de `deploy/tablette/boot.sh`) est en place,
exécutable, shebang correct, tout vient de F-Droid, batterie « sans
restriction » — et pourtant la surcouche Blackview **empêche Termux:Boot de se
lancer au boot**. Aucun réglage « auto-start » ni DuraSpeed trouvé dans les
paramètres. Un témoin est resté en place pour le jour où ça changerait :
`~/.termux/boot/0-temoin.sh` écrit la date dans `~/boot-temoin.txt` à chaque
boot réussi — si `cat ~/boot-temoin.txt` affiche une date récente après un
redémarrage, l'automatique est revenu.

## Diagnostiquer une panne

Depuis Termux, dans l'ordre :

```sh
# Le superviseur a-t-il tourné, et quand ?
proot-distro login debian -- ls -la /root/journal

# Pourquoi le site est tombé ?
proot-distro login debian -- tail -n 40 /root/journal/site.log

# La collecte du jour s'est-elle bien passée ?
proot-distro login debian -- tail -n 30 "/root/journal/collecte-$(date +%F).log"

# Quelque chose tourne-t-il seulement ?
ps -ef | grep -i node
```

Le remède universel : relancer le bouton PokeBroc (le verrou absorbe les
doublons). Le site met une à deux minutes à répondre sur ce processeur.

## Les pièges déjà rencontrés (ne pas les repayer)

- **« none of the mirrors are accessible »** dans Termux → `termux-change-repo`,
  choisir les miroirs Europe. (Et vérifier que Termux vient de F-Droid.)
- **`no module named venv`** → `apt install -y python3-venv python3-full` dans
  le Debian.
- **`tzdata` introuvable au pip** → normal : le paquet PyPI ne sert que sous
  Windows. Sur Debian c'est `apt install tzdata`.
- **`/root/venv/bin/python` sans argument** ouvre l'interpréteur (`>>>`) —
  `exit()` pour sortir.
- **`ls root/journal`** sans le `/` initial cherche un chemin relatif et échoue.
- **Après un `git pull` qui touche `lib/` ou `app/`** : `npm run build`
  obligatoire avant de relancer, sinon le site sert l'ancien code (15-30 min
  sur la tablette).
- **Chromium sous proot** exige `--no-sandbox` — le collecteur Cardmarket le
  fait tout seul quand il se croit root.

## Ce qui reste à faire, et le contexte côté PC

- **Cardmarket, premier passage** : Chromium (pas d'Edge en ARM64) devra
  probablement lever un défi Cloudflare une fois — prévoir Termux:X11 pour
  afficher `--visible` sur l'écran de la tablette. Si le navigateur part en
  vrille, supprimer `.data/cardmarket/profil` (profil hérité du Edge Windows)
  et recommencer.
- **Tailscale** : installation lancée le 1er septembre 2026 (voir « Accéder au
  site » ci-dessus pour la marche à suivre complète).
- **Côté PC** : les deux tâches planifiées Windows « PokeBroc Cardmarket » et
  « PokeBroc-LBC » ont été **désactivées** le 1er septembre 2026
  (`schtasks /change /tn "PokeBroc-LBC" /enable` pour les réveiller). Le
  `.data` du PC est un instantané figé de ce jour-là.
- **Ouvrir le site à d'autres personnes** : envisagé — domaine public + tunnel
  Cloudflare. Rien en place.
