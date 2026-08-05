# PokeBroc

Épinglez vos cartes Pokémon dans un compte, et retrouvez sur la page d'accueil toutes les annonces
Vinted qui les concernent — fusionnées en un seul fil, triées par écart à la cote Cardmarket, les
nouveautés signalées.

## Parcours

1. **Compte** (`/inscription`, `/connexion`) — e-mail et mot de passe. La collection est attachée au
   compte, donc identique d'un appareil à l'autre.
2. **Ajout d'une carte** — la barre de recherche vit dans l'en-tête et suit sur toutes les pages. On
   tape `dracaufeu`, un aperçu s'ouvre au fil de la frappe ; un clic sur la bonne carte l'ajoute, un
   second la retire. L'aperçu est un `listbox` : flèches pour parcourir, Entrée pour épingler.
3. **Accueil** — quatre compteurs, le bandeau de collection, puis **un fil unique** en lignes
   rassemblant les annonces de toutes les cartes. Chaque ligne porte le nom de la carte, son écart à
   la cote, l'état déclaré, l'ancienneté, et une pastille si l'annonce est nouvelle.
4. **Fiche carte** (`/carte/[id]`) — visuel haute résolution, cote Cardmarket, **prix réellement
   observés sur Vinted**, et la recherche libre avec ses filtres.

Le bandeau de collection n'est pas décoratif : cliquer sur une carte filtre le fil sur ses annonces
et lève le plafond de douze lignes par carte. C'est le geste qu'on faisait en survolant les
vignettes, sans avoir à changer de page.

## Ce que le site apporte par rapport à une recherche Vinted classique

La recherche Vinted est floue : `Dracaufeu 4/102` renvoie les ~960 mêmes annonces que `dracaufeu`.
Chaque annonce est donc re-notée côté serveur à partir du titre :

| Signal | Effet |
| --- | --- |
| Nom de la carte présent | +4 |
| Numéro imprimé (`4/102`, `n°4`, `#4`) | +4 |
| Nom de l'extension | +3 |
| Lot / classeur / display | −2 |
| Annonce sponsorisée | −1 |
| Reproduction (`custom`, `proxy`, `orica`…) | −8 |

Le fil ne retient par défaut que les annonces à score ≥ 8, c'est-à-dire celles qui citent le nom
**et** le numéro ou l'extension. C'est la condition pour que la comparaison à la cote ait un sens :
la cote de `Dracaufeu 4/102` ne dit rien du prix d'un `Dracaufeu VMAX`. La case **Élargir** redescend
le seuil à 4 (nom seul), et le nombre d'annonces ainsi masquées est toujours affiché.

Les mots-clés sont cherchés comme des **mots entiers**, pas comme des sous-chaînes : la version
précédente ne voyait pas le « lot » d'un titre finissant par `… vendu en lot`, et prenait `psaume`
pour une carte gradée PSA.

La pénalité sur les reproductions est calibrée pour faire passer sous le seuil strict une annonce
dont le titre est par ailleurs parfait. Sans elle, un proxy à 3 € affichait −97 % et trônait en tête
des « meilleures affaires ».

### Les lots ont leur propre recherche, et leur notation inverse

Le `−2` ci-dessus est ce qu'il faut pour un fil de cartes à l'unité, et exactement ce qu'il ne faut
pas pour qui cherche un lot. Pire, il les rend **invisibles** : un titre comme `Lot de 200 cartes
Pokémon dont Dracaufeu` vaut 4 − 2 = 2, sous le seuil large, et n'atteint donc jamais le disque.
Les gros lots — ceux qui ne citent ni numéro ni extension — étaient structurellement absents.

La page **Mes lots** (`/lots`, `lib/lots.ts`) les collecte donc à part, en deux onglets qui
répondent à deux questions opposées : **Récents**, le flux de ce qui vient d'être mis en ligne, et
**Ma collection**, les lots dont le titre cite une carte suivie.

Deux routes, et non deux vues d'un même fil : la bascule `Mes cartes` / `Mes lots` de l'en-tête
(`components/ModeSwitch.tsx`) change de page. Les lots ont d'abord vécu en section sous le fil, et
l'endroit les condamnait — sur une collection de douze cartes, il fallait descendre **cinq écrans et
demi** pour les atteindre. Pire, la section était repliable, et repliée elle ne rendait pas même ses
onglets : une préférence `open: false` enregistrée du temps où elle l'était par défaut survivait au
changement de défaut, `usePersisted` fusionnant la valeur stockée par-dessus. Les seuls à avoir déjà
ouvert le site étaient donc précisément ceux à qui la section restait invisible.

Le partage par route n'est pas qu'un rangement : la page des cartes ne lit plus un seul instantané
de lot, et `/lots` ne rend pas les cent trente-cinq annonces du fil.

#### Onglet « Récents » — arriver tôt

C'est l'onglet par défaut, et l'inverse exact de tout le reste du site : **on ne part d'aucune
carte**. Un lot ne dit pas ce qu'il contient, et le vendeur qui liquide un classeur au poids ne le
sait pas toujours lui-même — c'est précisément ce qui en fait une affaire. La seule chose qui compte
est donc d'arriver avant les autres, d'où un tri par date de mise en ligne et non par pertinence, et
les tris `newest_first` / `newly_listed` côté catalogues.

Sans carte de référence, la notation ne s'applique plus : il faut trancher sur le titre nu
(`isPokemonLot`). Trois conditions, dont la première n'a rien de théorique — interrogé avec
`lot cartes pokemon`, le catalogue Vinted rend un maillot de football et un pantalon dans ses cinq
premiers résultats :

1. le mot `pokemon` en toutes lettres, sans quoi le flux serait à moitié composé de vêtements ;
2. un mot de lot (`lot`, `vrac`, `classeur`, `collection complète`…) ;
3. ni reproduction, ni **carte-code**.

Les cartes-code sont les jetons de recharge du jeu en ligne, sans valeur pour un collectionneur.
Elles se vendent par centaines pour quelques euros et coiffent donc mécaniquement tout classement au
prix par carte — mesuré sur le flux réel : `Lot 270 Cartes Code Pokémon` à **0,03 €/carte**, premier
devant `Gros lot 451 cartes Pokémon Rivalités Destinées` à 0,06 €.

Un seul instantané, partagé par tout le site, valable un quart d'heure : les requêtes ne dépendent
d'aucune collection. **Huit recherches** par quart d'heure pour l'ensemble des visiteurs, là où
l'onglet « Ma collection » en coûte quatre *par carte suivie*. La fraîcheur y est le produit, d'où une
validité plus courte que partout ailleurs.

Relevé sur une collecte réelle : 120 lots retenus (43 Vinted, 77 eBay), tous datés, les plus récents
mis en ligne **une minute plus tôt**, et 74 annonçant une quantité.

#### Onglet « Ma collection » — savoir ce qu'on cherche

Plus ciblé, forcément plus étroit : un lot de trois cents cartes ne nomme personne. Il ne s'appelle
pas « Vos cartes » : `Mes cartes`, dans l'en-tête, désigne l'autre fil du site, et deux libellés
voisins pour deux choses différentes à trente pixels l'un de l'autre ne pouvaient que se confondre.
Trois différences avec le fil :

| | Fil des cartes | Page Lots |
| --- | --- | --- |
| Requête | `Dracaufeu 4/102` | `lot Dracaufeu`, `lot cartes Set de Base` |
| Mot « lot » | −2 | +3, et **éliminatoire** en son absence |
| Reproduction | −8 | éliminatoire |
| Validité de l'instantané | 10 min | 30 min |
| Écart à la cote | affiché | jamais |

Le seuil de rétention (6) se lit « c'est bien un lot, **et** quelque chose le rattache à la carte
suivie » : sans cette seconde condition, l'onglet afficherait le même vrac générique pour toutes les
cartes de la collection.

L'écart à la cote est tu, et c'est le point qui a dicté le reste : un lot ne contient pas deux cents
fois la même carte. Comparer 60 € à la cote d'un seul Dracaufeu afficherait `−85 %` et raflerait tout
classement. À la place, le titre est lu pour y trouver une quantité (`lot de 200`, `200 cartes`,
`x150`), d'où un **prix par carte** — la seule grandeur qui rende deux lots comparables. Les numéros
imprimés sont retirés avant cette lecture, faute de quoi `Dracaufeu 4/102` livrerait un lot de
102 cartes et un prix par carte inventé. Quand le titre ne dit rien, le prix par carte reste vide
plutôt que deviné, et ces lots-là se classent en queue.

Les enchères en cours n'en ont pas non plus : leur prix n'est pas un prix demandé, et il baisserait
mécaniquement le classement de tous les lots à prix fixe.

La collecte ne part qu'une fois l'onglet ouvert. Elle vaut deux requêtes par place de marché et par
carte, soit quatre-vingts recherches pour vingt cartes suivies — les lancer au chargement de la page
d'accueil, que l'on regarde à chaque visite, serait indéfendable vis-à-vis des catalogues. C'est ce
qui rend la route séparée pertinente au-delà de l'ergonomie : on n'arrive sur `/lots` qu'en le
demandant, et la dépense devient volontaire. Ce qui est déjà sur le disque s'affiche immédiatement.

### Le texte de la requête compte, même si Vinted l'ignore

Vinted renvoie le même volume quelle que soit la formulation, mais son *classement* change — et
seule la première page (48 annonces) est lue. Mesuré sur `base1-4` :

| Requête | Correspondances fortes en page 1 |
| --- | --- |
| `Dracaufeu carte pokemon` | 0 |
| `Dracaufeu Set de Base` | 7 |
| `Dracaufeu 4/102` | 31 |

Le serveur compose donc lui-même la requête la plus discriminante (`lib/match.ts` → `bestQuery`), à
partir du numéro imprimé que seul il connaît.

### Les noms à symboles, que personne n'écrit

TCGdex publie le nom officiel de `ex15-100` : **`Dracaufeu ☆ δ`** — étoile blanche (U+2606) et
delta (U+03B4). Aucune annonce n'est rédigée ainsi ; les vendeurs écrivent `Dracaufeu Gold star
100/101`. Le symbole cassait donc les **deux bouts** de la chaîne à la fois : la requête envoyée aux
catalogues, et la reconnaissance du nom dans les titres qui en revenaient. Une carte trouvée par son
numéro était recalée faute de nom reconnu — 4 + 3 = 7, sous le seuil strict.

`searchName` traduit désormais ces symboles, et sert aux deux extrémités : composer la requête, et
comparer les titres reçus. Chaque règle est **mesurée** sur le catalogue Vinted :

| Requête | Nom reconnu | Fortes |
| --- | --- | --- |
| `Dracaufeu ☆ δ 100/101` *(avant)* | 0 | 0 |
| `Dracaufeu gold star 100/101` | 5 | 4 |
| `Dracaufeu gold star delta 100/101` | 0 | 0 |
| `Eoko 1/17` | 4 | 3 |
| `Eoko delta 1/17` | 0 | 0 |

D'où deux traitements opposés :

- **`★` `☆` → `gold star`**, **`◇` → `prism star`** : ce sont les noms sous lesquels ces cartes se
  vendent réellement. `Mew ☆ δ` passe de 0 à 9 correspondances fortes.
- **`δ` → retiré**, pas traduit. Les vendeurs ne le mentionnent pas, et l'ajouter fait dériver la
  requête vers des objets qui n'ont de la carte que le nom — jusqu'à une gravure sur bois. Le numéro
  imprimé suffit à désigner la carte.

L'apostrophe typographique `’` devient l'apostrophe droite du clavier, et les tirets longs une
espace : `Latias-ex` se cherche `Latias ex`, parce que ni `Latias-ex` ni `latiasex` ne se retrouvent
dans un titre d'annonce. La recherche libre de la fiche carte suit la même règle, `suggestedQueries`
partageant `searchName`.

### Deux passes, systématiquement

Vinted propose un tri par date, mais l'appliquer à une recherche floue revient à demander les
annonces les plus récentes du millier de résultats approximatifs — la carte cherchée disparaît :

| Carte | Fortes en `relevance` | Fortes en `newest_first` |
| --- | --- | --- |
| Dracaufeu 4/102 | 29 | 2 |
| Mewtwo 10/102 | 39 | 7 |
| Pikachu 5/25 | 7 | 0 |

Chaque collecte lance donc les deux passes et les fusionne. `newest_first` ne sert pas qu'au tri
« derniers ajouts » : c'est le seul classement qui fasse remonter une annonce fraîche encore mal
positionnée en pertinence, donc la condition d'un badge « nouveau » fiable.

La date vient de `photo.high_resolution.timestamp` : le catalogue Vinted n'expose pas de date de
création, et l'horodatage de la photo en est le meilleur équivalent.

## Le fil est un cache, pas une recherche

Chaque chargement de page relançait une recherche Vinted par carte, sérialisées à 350 ms : vingt
cartes suivies, c'était sept secondes d'attente **refaites à chaque visite, par chaque visiteur**.

Les collectes sont désormais rangées sur le disque, un fichier par carte (`lib/feed.ts`,
`.data/feed/`), valables dix minutes :

- la page d'accueil se rend depuis ces instantanés — aucune requête sortante, le fil est complet dès
  le premier octet ;
- le navigateur ne rattrape que les cartes périmées, une par une, via `/api/feed?cardId=…` ;
- deux visiteurs qui suivent la même carte partagent la même collecte, sérialisée par carte ;
- ajouter une carte déclenche sa collecte sans l'attendre, pendant qu'on en cherche d'autres.

## Ce qui est nouveau l'est vraiment

Sans mémoire du passé, un utilisateur qui revient trois fois par jour rescanne à l'œil les mêmes deux
cents lignes. `lib/sightings.ts` consigne chaque annonce croisée, avec sa date de première apparition
et son prix.

Le repère du badge n'avance pas à chaque rechargement — sinon un simple F5 effacerait les pastilles
qu'on vient d'afficher. Il ne bouge qu'au retour après une vraie interruption (30 min), et vaut alors
la fin de la session précédente. Un bouton **Tout marquer comme vu** le remet à zéro à la demande.

Le même journal donne gratuitement les **prix réellement demandés sur Vinted**, affichés sur la fiche
carte : médiane, fourchette, nombre d'annonces sur 30 jours. C'est la seule donnée du site
qu'aucune autre source ne fournit — Cardmarket publie une cote, pas ce que les vendeurs demandent.
La médiane plutôt que la moyenne : une gradée à 900 € déplacerait une moyenne de 20 € à plus de 200 €.

Seules les correspondances fortes entrent dans ces statistiques. Les annonces de plus de 120 jours
sont oubliées, et un plafond de 1500 entrées par carte borne la taille des fichiers.

## Comptes, sessions et plafonds

Aucune base de données, aucune dépendance ajoutée :

- **Mots de passe** : `scrypt` (`node:crypto`), sel aléatoire de 16 octets par compte, comparaison en
  temps constant. Une connexion sur une adresse inconnue dérive quand même une clé, pour que le
  temps de réponse ne révèle pas les comptes existants.
- **Sessions** : cookie `httpOnly` contenant `userId.expiration.signature`, signé en HMAC-SHA256.
  Rien à relire côté serveur, et un jeton modifié est rejeté.
- **Stockage** : `.data/users.json`, écrit de façon atomique et avec les écritures sérialisées. Le
  fichier n'est reparsé que lorsqu'il a changé sur le disque (`mtime` + taille) — auparavant, chaque
  requête relisait l'intégralité des comptes pour n'en retrouver qu'un.
- **Limitation de débit** (`lib/rate-limit.ts`, seau à jetons) : 20 connexions par IP et 8 par
  adresse e-mail par quart d'heure, 5 inscriptions par IP et par heure. Une connexion réussie rend
  ses jetons, pour qu'on ne se verrouille pas son propre compte. `proxy.ts` protège les routes d'API,
  qui sont ouvertes et non authentifiées : sans garde-fou, un script suffit à faire bloquer la
  session Vinted anonyme, partagée par tout le site.

Le seau à jetons plutôt qu'un compteur par fenêtre : ce dernier autorise `2 × limite` requêtes à
cheval sur deux fenêtres.

Définissez `SESSION_SECRET` en production. Sans elle, une clé est générée dans
`.data/session-secret` afin que les sessions survivent à un redémarrage.

> Le stockage fichier suppose **un seul processus Node** — la limitation de débit aussi, son compteur
> vivant en mémoire. Pour un déploiement multi-instance, remplacez `lib/store.ts` : sa surface est
> déjà asynchrone et ignore le support.

## Les visuels de cartes passent par un cache local

`assets.tcgdex.net` génère ses images à la demande. Mesuré pendant le développement : **15 à 25 s
pour un fichier de 18 Ko**, des `502` par salves, et des requêtes qui n'aboutissent jamais.

1. **Cache disque** (`lib/image-cache.ts` + `/api/carte-image`) — le visuel est téléchargé une fois
   puis servi depuis `.data/img-cache`. Mesuré : 20 s à froid pour 18 images, **122 ms à chaud**.
   Le proxy n'accepte que `assets.tcgdex.net`, sinon il servirait de relais vers n'importe quelle
   adresse.
2. **Réponse à budget** — le navigateur n'attend jamais plus de 3 s. Au-delà il reçoit un échec, mais
   le téléchargement continue en arrière-plan et remplit le cache ; la vignette réessaie et l'image
   finit par apparaître. Sans ce garde-fou, dix-huit requêtes bloquées épuisent les connexions du
   navigateur et figent tout le site. Un `404` de TCGdex est retenu dix minutes, pour ne pas
   réessayer une image qui n'existe pas.
3. **Préchauffage** — `/api/cards` lance le téléchargement des 18 premiers visuels sans les attendre,
   dès la frappe.
4. **Repli sur la base anglaise** — environ 13 % des cartes n'ont pas d'illustration côté français,
   et les deux tiers d'entre elles en ont une côté anglais. C'est la même illustration ; seul le
   texte imprimé change, illisible à la taille d'une vignette.
5. **Purge** — au-delà de 300 Mo, les fichiers les plus anciens sont supprimés jusqu'à redescendre à
   80 % du plafond. L'éviction se fait sur la date d'écriture : les visuels sont servis avec un
   `Cache-Control` immuable, donc une date de dernier accès ne voudrait pas dire grand-chose.

## Sources de données

- **Cartes** : [TCGdex](https://tcgdex.dev) en français, sans clé d'API. Fournit aussi les cotes
  Cardmarket.
- **Annonces** : API catalogue de Vinted. Elle n'est pas publiquement documentée et exige des
  cookies de session anonyme : `lib/vinted.ts` en ouvre une en visitant la page d'accueil, la garde
  ~9 minutes en mémoire et la renouvelle automatiquement sur un `401`. Les appels sortants sont
  sérialisés (350 ms minimum entre deux) et les résultats mis en cache 90 secondes.

## Développement

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # suite node:test, sans dépendance
npm run build
npm run lint
```

Aucune variable d'environnement n'est nécessaire en développement. `NEXT_PUBLIC_SITE_URL` sert au
plan de site.

### Tests

`lib/match.ts` décide qu'une annonce parle bien de *cette* carte : c'est là que se joue la valeur du
site, et c'est de la logique pure. La suite couvre la notation, les requêtes construites, la
limitation de débit et les statistiques de prix — aucune dépendance.

`tests/lots.test.ts` mérite une mention, parce que `match.ts` y porte désormais deux règles
inverses : ce que la notation des cartes pénalise, celle des lots exige. Deux jeux de poids dans le
même fichier se contredisent vite, et c'est bien arrivé — la pénalité de −8 sur les reproductions,
suffisante à l'unité, laissait passer `lot de 10 cartes custom Dracaufeu 4/102 Set de Base` à
exactement le seuil, un lot cumulant un signal de plus qu'une carte seule. D'où l'élimination pure
et simple, et le test qui la fige.

Node 24 exécute le TypeScript nativement mais applique la résolution ESM stricte, qui refuse les
imports sans extension. `tests/resolve-ts.mjs` ajoute ce chaînon manquant avec `module.registerHooks`,
plutôt que de réécrire tout `lib/` pour satisfaire le lanceur de tests.

## Structure

```
app/
  page.tsx                  accueil : présentation, ou fil des cartes suivies
  lots/page.tsx             l'autre fil : les lots, en deux onglets
  layout.tsx                en-tête avec recherche permanente
  robots.ts, sitemap.ts     référencement des fiches cartes
  connexion/, inscription/  formulaires de compte
  carte/[id]/page.tsx       fiche carte + cote + prix observés + recherche libre
  actions/auth.ts           inscription, connexion, déconnexion, plafonds
  actions/favorites.ts      ajout / retrait, « tout marquer comme vu »
  api/cards/route.ts        proxy TCGdex + préchauffage des visuels
  api/carte-image/route.ts  visuels servis depuis le cache disque
  api/feed/route.ts         rafraîchissement d'une carte du fil
  api/lots/route.ts         rafraîchissement des lots d'une carte
  api/lots/recents/route.ts flux des lots Pokémon récemment mis en ligne
  api/vinted/route.ts       recherche Vinted + notation (fiche carte)
proxy.ts                    limitation de débit devant /api/*
components/
  Dashboard.tsx             collection, filtres et fil — l'état partagé de l'accueil
  Lots.tsx                  page des lots : onglets Récents / Ma collection
  ModeSwitch.tsx            bascule Mes cartes / Mes lots, dans l'en-tête
  OfferRow.tsx              une annonce, en ligne
  CardSearch.tsx            barre de recherche et aperçu clavier
  CollectionStrip.tsx       bandeau des cartes épinglées, qui filtre le fil
  VintedResults.tsx         recherche libre de la fiche carte
  PriceHistory.tsx          prix réellement observés sur Vinted
  CardThumb.tsx             visuel de carte, avec réessais et repli sur le nom
  usePersisted.ts           préférences d'affichage (useSyncExternalStore)
  AccountMenu.tsx, AuthForm.tsx, FavoriteButton.tsx, FocusSearchButton.tsx
lib/
  auth.ts                   mots de passe, jetons, session
  store.ts                  comptes, favoris, repère du badge « nouveau »
  feed.ts                   instantanés du fil, collecte, fraîcheur
  lots.ts                   lots : flux récent partagé + lots par carte suivie
  sightings.ts              annonces déjà vues, statistiques de prix
  rate-limit.ts             seau à jetons en mémoire
  json-file.ts              lecture/écriture atomique, sérialisation par clé
  image-cache.ts            cache disque des visuels, préchauffage, purge
  tcgdex.ts                 cartes, extensions, images, cotes
  vinted.ts                 session, throttle, cache, normalisation
  match.ts                  notation des annonces, état, requêtes
  format.ts                 euros, pourcentages, ancienneté
tests/                      node:test — match, rate-limit, sightings, format
```

## Limites connues

- La cote Cardmarket correspond à la version standard de la carte : une version gradée PSA 10 ou
  1st edition affichera un écart très positif. Les gradées sont donc masquées par défaut, d'un clic
  près.
- Le CDN de visuels de TCGdex reste le facteur limitant à froid : sur une carte jamais consultée, le
  visuel peut mettre 20 s à apparaître. Le cache local ne supprime pas ce premier passage, il évite
  seulement de le repayer.
- Une collecte lance deux requêtes Vinted par carte, sérialisées à 350 ms. La première visite après
  l'ajout de vingt cartes reste donc longue ; les suivantes lisent le disque.
- « Prix observés » est un prix **demandé**, pas un prix de vente : le catalogue Vinted ne dit pas à
  quel prix une annonce est partie, ni même si elle est partie.
- Vinted plafonne les résultats à ~20 pages ; les requêtes ciblées restent préférables.
- La page Lots retient aussi les produits scellés — `coffret`, `display`, `booster` font partie
  des mots qui signalent un lot. Un « Coffret Méga-Latias-ex (4 boosters) » y figure donc, sans
  quantité de cartes annoncée, donc sans prix par carte. C'est adjacent à ce qu'on cherche plutôt
  que faux, mais ce n'est pas un lot de cartes.
- Un lot est rattaché à une carte parce que son titre la cite, elle ou son extension. Rien ne
  garantit qu'elle soit réellement dedans : `lot cartes Set de Base` en dit autant sur son contenu
  que le vendeur a bien voulu en dire.
- La traduction des symboles vaut pour la recherche d'**annonces**, pas pour la recherche de
  **cartes** de l'en-tête : celle-ci interroge TCGdex, qui ne connaît que le nom officiel. Taper
  `dracaufeu gold star` n'y trouve rien ; `dracaufeu` remonte la carte, symbole compris.

## Suite possible

Alertes par e-mail sous un prix cible, autres jeux (Yu-Gi-Oh!, One Piece), autres places de marché
(Leboncoin, eBay), et un rafraîchisseur en tâche de fond qui balaierait l'union des cartes suivies
sans attendre qu'un visiteur passe.
