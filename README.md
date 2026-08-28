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

La page **Lots** (`/lots`, `lib/lots.ts`) les collecte donc à part : **tous** les lots Pokémon des
trois places de marché, les derniers mis en ligne en tête. On recharge la page, les derniers
arrivent.

Deux routes, et non deux vues d'un même fil : la bascule `Mes cartes` / `Lots` de l'en-tête
(`components/ModeSwitch.tsx`) change de page. L'asymétrie des libellés est le message — l'une part
de votre collection, l'autre non. Les lots ont d'abord vécu en section sous le fil, et l'endroit les
condamnait : sur une collection de douze cartes, il fallait descendre **cinq écrans et demi** pour
les atteindre. Pire, la section était repliable, et repliée elle ne rendait pas même ses onglets —
une préférence `open: false` enregistrée du temps où elle l'était par défaut survivait au changement
de défaut, `usePersisted` fusionnant la valeur stockée par-dessus. Les seuls à avoir déjà ouvert le
site étaient donc précisément ceux à qui la section restait invisible.

#### Arriver tôt

C'est l'inverse exact de tout le reste du site : **on ne part d'aucune carte**. Un lot ne dit pas ce
qu'il contient, et le vendeur qui liquide un classeur au poids ne le sait pas toujours lui-même —
c'est précisément ce qui en fait une affaire. La seule chose qui compte est donc d'arriver avant les
autres, d'où un tri par date de mise en ligne et non par pertinence, et les tris `newest_first` /
`newly_listed` côté catalogues.

Un onglet « Ma collection » a vécu ici, qui rassemblait les lots dont le titre citait une carte
suivie. Il a été retiré, parce qu'il répondait à une question à laquelle le fil de la page d'accueil
répond déjà : un lot qui nomme une carte suivie y remonte par la notation ordinaire, et le bouton
**Sans lots** sert à les masquer. Deux chemins pour une même chose, dont l'un coûtait quatre
recherches *par carte suivie* — et émettait `lot cartes Set de Base` autant de fois qu'il y avait de
cartes de cette extension dans la collection.

`scoreLot`, `scoreLots`, `LOT_SCORE` et `lotQueries` restent dans `match.ts`, sans appelant : ils
servaient cet onglet, et resserviront à un filtre « ne montrer que les lots contenant telle carte »
posé sur la liste unique.

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
d'aucune collection. **Douze recherches** par quart d'heure pour l'ensemble des visiteurs, quel que
soit le nombre de comptes et de cartes épinglées. La fraîcheur y est le produit, d'où une validité
plus courte que partout ailleurs.

Trois différences avec le fil des cartes :

| | Fil des cartes | Page Lots |
| --- | --- | --- |
| Requête | `Dracaufeu 4/102` | `lot cartes pokemon`, `vrac cartes pokemon`… |
| Point de départ | votre collection | aucun |
| Validité de l'instantané | 10 min | 15 min |
| Écart à la cote | affiché | jamais |

Relevé sur une collecte réelle du 29 août 2026 : le plafond de 200 lots atteint, 61 Vinted, 87 eBay
et 52 leboncoin, tous datés, les plus récents mis en ligne **une minute plus tôt**.

La page se lit en liste ou en **grille**, sous la même préférence que le fil des cartes
(`components/ViewSwitch.tsx`) : c'est un réglage sur la forme des annonces, pas sur leur contenu, et
deux réglages homonymes à régler séparément se seraient surtout fait oublier l'un des deux. La photo
compte davantage ici que partout ailleurs — le titre d'un lot ment par omission, `Lot de 300 cartes
Pokémon` ne dit rien de ce qu'il y a dedans, et c'est le tas photographié qui laisse deviner
l'époque et l'état. En vignette, l'étiquette posée sur la photo est le **prix par carte**, là où le
fil y met l'écart à la cote : un lot n'a pas de cote.

L'écart à la cote est tu, et c'est le point qui a dicté le reste : un lot ne contient pas deux cents
fois la même carte. Comparer 60 € à la cote d'un seul Dracaufeu afficherait `−85 %` et raflerait tout
classement. À la place, le titre est lu pour y trouver une quantité (`lot de 200`, `200 cartes`,
`x150`), d'où un **prix par carte** — la seule grandeur qui rende deux lots comparables. Les numéros
imprimés sont retirés avant cette lecture, faute de quoi `Dracaufeu 4/102` livrerait un lot de
102 cartes et un prix par carte inventé. Quand le titre ne dit rien, le prix par carte reste vide
plutôt que deviné, et ces lots-là se classent en queue.

Les enchères en cours n'en ont pas non plus : leur prix n'est pas un prix demandé, et il baisserait
mécaniquement le classement de tous les lots à prix fixe.

La collecte ne part qu'une fois la page ouverte, et seulement si l'instantané a plus d'un quart
d'heure. La lancer au chargement de la page d'accueil, que l'on regarde à chaque visite, serait
indéfendable vis-à-vis des catalogues. C'est ce qui rend la route séparée pertinente au-delà de
l'ergonomie : on n'arrive sur `/lots` qu'en le demandant, et la dépense devient volontaire. Ce qui
est déjà sur le disque s'affiche immédiatement.

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

### eBay, lui, la lit au pied de la lettre

La même requête envoyée aux deux catalogues n'y est pas comprise de la même façon. `q` est un **ET
strict** chez eBay : `Dracolosse 2/146` exige que le titre porte `2/146` tel quel, et rend zéro
sinon. Vinted se contente d'une correspondance partielle — d'où une requête taillée pour lui qui ne
ramenait rien de l'autre côté, sans que rien ne le signale : l'instantané restait valide, le fil
restait servi par Vinted, la source manquante ne laissait aucune trace.

Mesuré le 29 août 2026 sur les soixante requêtes réellement utilisées par le fil :

| Requête | eBay avec le dénominateur | sans |
| --- | --- | --- |
| `Dracolosse 2/146` | 16 | **545** |
| `Pikachu 15/17` | 6 | **355** |
| `Rayquaza 9/106` | 19 | **283** |
| `Malosse 5/75` | **0** | 165 |
| `Zoroark 143/86` | **0** | 6 |

Huit requêtes sur soixante ne rendaient **rien** chez eBay quand Vinted en rendait quarante-huit, et
trente-deux gagnaient à perdre le dénominateur. Le gain n'est pas du bruit : après `scoreAll`, qui
écarte les annonces hors sujet, un échantillon de douze cartes passe de 167 à 579 annonces gardées,
dont 164 à 302 correspondances **fortes**.

`looseQuery` (`lib/ebay.ts`) n'ampute donc que le dénominateur — `4/102` devient `4`, `SL6/95`
devient `SL6`. Le numéro imprimé reste, et c'est lui qui porte le signal. Une requête sans barre
oblique, celles des lots, ressort intacte. La transformation vit dans `ebay.ts` et non chez
l'appelant : c'est une propriété du moteur d'eBay, pas du fil, et un futur appelant qui l'ignorerait
retomberait silencieusement sur des recherches vides.

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

## Les alertes arrivent sans qu'on regarde

Le fil ne se collectait que sous les yeux d'un visiteur : `refreshCard()` n'était appelé que depuis
un rendu de page ou `/api/feed`. Personne sur le site, aucune collecte ; aucune collecte, rien à
annoncer. Une notification qui ne se déclenche que devant l'écran ne notifie rien.

`collect/veille.ts` est le second processus qui manquait. Sur minuterie — le même patron que le
collecteur leboncoin — il balaie l'union des cartes suivies, relève la boîte de réception du bot,
et envoie sur Telegram ce qui vient d'apparaître. Deux effets, dont le second était déjà souhaitable
avant qu'il soit question d'alertes :

- les annonces neuves sont découvertes dans les minutes qui suivent leur mise en ligne ;
- le badge « nouveau » redevient honnête pour qui ne vient qu'une fois par jour — sans veille, il ne
  montrait que ce que la visite venait elle-même de déterrer.

### Pourquoi Telegram

Le Web Push voudrait un service worker, des clés VAPID et surtout du HTTPS, que ce site n'a pas.
L'e-mail partirait d'une IP résidentielle, donc en indésirables, à moins de louer un relais —
c'est-à-dire d'ajouter le service tiers évité partout ailleurs. Telegram n'attend qu'un POST
sortant : ni certificat, ni port ouvert, ni dépendance ajoutée. Le site en compte toujours trois
(`next`, `react`, `react-dom`).

Aucun webhook non plus : c'est la veille qui va chercher les messages (`getUpdates`), au rythme de
son balayage. Un webhook exigerait une adresse publique, ce qui ferait rentrer le problème du HTTPS
par la fenêtre.

### Ce qui déclenche une alerte

Exactement ce que le fil montre par défaut : correspondance forte (le titre cite le nom **et** le
numéro ou l'extension), ni gradée, ni lot. Reprendre les réglages par défaut du tableau de bord
plutôt qu'en inventer d'autres est la seule façon qu'une alerte ne mène pas à une page où l'annonce
annoncée est justement filtrée — et un lien qui ne montre rien décrédibilise le suivant.

La règle vit dans `lib/alerts.ts`, pas dans le script : c'est une décision métier, elle se teste sans
réseau ni Telegram (`tests/alerts.test.ts`).

### Deux processus, un seul écrivain par fichier

`store.ts` sérialise ses écritures **en mémoire**, ce qui ne protège de rien entre deux processus :
le site et la veille liraient la même version de `users.json`, et la seconde écriture effacerait la
première — avec la carte que l'utilisateur venait d'épingler.

D'où le partage, calqué sur celui de `collect/lbc.py` : le site possède `users.json`, la veille
possède `.data/veille/state.json`, et chacun se contente de lire celui de l'autre. C'est ce qui
explique une bizarrerie apparente de l'interface — **on connecte Telegram depuis le site, mais on
s'en déconnecte en envoyant `/stop` au bot**. Un bouton « déconnecter » sur la page Alertes devrait
écrire dans le fichier de l'autre processus, et rouvrirait exactement la course que ce découpage
évite.

Le repère des alertes est distinct de celui du badge : `feedNewSince` suit les *visites* et recule
au bouton « Tout marquer comme vu », là où `notifiedAt` n'avance que lorsqu'un message est
effectivement parti. Les confondre ferait qu'ouvrir la page éteint des alertes jamais envoyées, et
qu'un retour après trente minutes renvoie celles qui l'avaient déjà été.

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
- **Lots leboncoin** : collectés par `collect/lbc.py`, hors du site. Voir ci-dessous — c'est la seule
  source que le serveur ne peut pas interroger lui-même.

### Pourquoi leboncoin passe par un script Python

Leboncoin est derrière Datadome, qui n'inspecte pas l'en-tête `User-Agent` mais l'empreinte du
handshake TLS et de la négociation HTTP/2. Le `fetch` de Node en produit une immédiatement
reconnaissable : mesuré, `403` sur la page d'accueil elle-même. Aucune session à entretenir comme
chez Vinted, aucun jeton comme chez eBay — le problème n'est pas l'authentification, c'est la pile
TLS, et il ne se règle pas en TypeScript. `collect/lbc.py` utilise `curl_cffi`, qui rejoue
l'empreinte exacte de Chrome.

Le script est donc le seul morceau du projet qui ne soit pas en TypeScript, et il fait *uniquement*
ce que le reste ne peut pas faire : récupérer, normaliser, écrire. `isPokemonLot`, `scoreLots` et
`lotSize` restent dans `lib/match.ts`, appliqués aux trois places de marché par le même chemin.

Le site, lui, ne lit que le disque et ne contacte jamais leboncoin.

#### Ce que coûte une IP de centre de données, mesuré

Ce paragraphe affirmait qu'un hébergeur « se ferait bloquer dès la première requête ». C'était une
intuition, et elle est fausse. Sondage du 5 août 2026 depuis un runner GitHub — AS8075 Microsoft,
Virginie — via `.github/workflows/sondage-datacenter.yml` :

| | IP résidentielle | Runner GitHub (US) |
| --- | --- | --- |
| leboncoin | 4 requêtes, ~10 pages, 147 lots en 18,7 s | **6 pages**, 210 résultats, puis 403 |
| Vinted | 48 annonces sur 960 | 48 annonces sur 960 |

Deux enseignements. **Vinted ne dépend pas de l'IP** — c'est la source principale, et elle est
tranquille. **Le blocage de Datadome est graduel** : il existe un budget de requêtes toléré, et
l'escalade porte ensuite sur `new_session()`, si bien que la page d'accueil elle-même finit par
rendre 403.

Ce que le sondage ne dit *pas*, et qu'il ne faut pas conclure trop vite : le runner était américain,
pour un site franco-français. Le pays et le centre de données ont changé ensemble, et rien n'indique
lequel des deux pèse. Un hébergeur français reste donc à évaluer, tout comme le levier « ralentir » —
`THROTTLE_S` vaut 2 s, ce qui est rapide pour une cible sous Datadome.

En attendant, la minuterie tourne sur une machine à IP résidentielle : non parce que c'est prouvé
nécessaire, mais parce que c'est la configuration dont on sait qu'elle marche.

Deux conséquences à connaître :

- **L'API mobile n'est pas utilisée.** `api.leboncoin.fr/finder/search` rendrait le même JSON sans
  les 400 Ko de HTML autour, mais exige un `User-Agent` d'application (`LBC;iOS;…`) qui ne s'accorde
  avec aucune empreinte TLS de navigateur : refusé dès la première requête. La route web porte les
  mêmes champs dans `__NEXT_DATA__`.
- **Le tri par date de leboncoin porte sur la dernière remontée, pas sur la mise en ligne.** Une
  annonce de deux mois republiée arrive en tête ; mesuré, ~13 % des résultats sont dans ce cas, dont
  une de 64 jours en première position. Le collecteur filtre donc sur `first_publication_date`, et
  c'est cette date que le site affiche.

## Développement

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # suite node:test, sans dépendance
npm run build
npm run lint
```

Aucune variable d'environnement n'est nécessaire en développement. `NEXT_PUBLIC_SITE_URL` sert au
plan de site, `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` ajoutent eBay au fil, et `TELEGRAM_BOT_TOKEN`
les alertes. Chacune est facultative : sans elle, la fonction disparaît sans rien casser.

### Le collecteur leboncoin

Facultatif : sans lui, la source disparaît simplement du flux des lots récents, comme eBay sans clé
d'API. Il demande Python 3.10 ou plus.

```bash
pip install curl_cffi tzdata

python collect/lbc.py              # fenêtre de 3 h, écrit .data/lbc/recents.json
python collect/lbc.py --dry-run    # n'écrit rien, résume sur la sortie
python collect/lbc.py --window 6   # remonter plus loin
python collect/test_lbc.py         # 18 tests, sans réseau
```

Il tourne sur minuterie, jamais à la demande du site, **au quart d'heure**. La fenêtre reste de trois
heures — mesuré, une requête produit ~30 mises en ligne par heure et trois pages en couvrent trois
heures — mais la cadence, elle, est dictée par la péremption : une collecte trihoraire laissait la
source disparaître de la page Lots deux heures sur trois. Un seuil de péremption et une minuterie
sont un seul réglage en deux fichiers. Sous Windows :

```powershell
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$action  = New-ScheduledTaskAction -Execute $py `
             -Argument "`"$PWD\collect\lbc.py`" --quiet" -WorkingDirectory "$PWD"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
             -RepetitionInterval (New-TimeSpan -Minutes 15)
# StartWhenAvailable rattrape le passage manqué pendant une mise en veille.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName PokeBroc-LBC -Action $action -Trigger $trigger `
                       -Settings $settings -Force
```

Pour la retirer : `Unregister-ScheduledTask -TaskName PokeBroc-LBC -Confirm:$false`.

`lib/lbc.ts` refuse un instantané de plus d'une heure et demie — six passages manqués — plutôt que
d'afficher comme « récent » un fichier oublié. Le facteur six n'est pas prudentiel mais **mesuré**,
sur le taux d'échec de la collecte elle-même : voir la section suivante. Un instantané *vide* reste valide : trois heures sans
un lot mis en ligne est un résultat, pas une panne, et cela arrive la nuit.

### Savoir ce qu'a fait un passage

Le script tient un journal dans `.data/lbc/collect.log` (200 dernières lignes, soit ~2 jours au
quart d'heure) :

```powershell
Get-Content .data\lbc\collect.log -Encoding UTF8 -Tail 20
```

L'option `-Encoding UTF8` n'est pas décorative : PowerShell 5.1 lit en ANSI par défaut et affiche
`publiÃ©s` là où le fichier contient bien `publiés`.

Ce journal a servi à poser `LBC_MAX_AGE_MS`. Relevé sur ses deux cents passages, du 25 au 29 août
2026, **depuis une ligne de particulier** :

| | Passages |
| --- | --- |
| Réussis | 134 |
| Refusés par Datadome (403 à l'amorçage) | 66 |
| **Taux d'échec** | **33 %** |
| Plus longue série de refus consécutifs | 5 |

Un refus n'est donc pas un incident : c'est le régime normal, et le passage suivant repart. Ce qui
compte est la **série**, parce qu'elle seule éloigne l'instantané du présent. Cinq refus d'affilée
font 1 h 15 sans collecte — au-delà du seuil d'une heure qui a d'abord été posé, d'où sa remontée à
1 h 30. Sans cela, leboncoin disparaissait de la page Lots alors que rien n'était en panne, et le
journal était le seul endroit où on pouvait le voir — le planificateur Windows, lui, ne montre qu'un
`LastTaskResult: 2` indistinguable d'un chemin erroné. C'est la raison d'être de ce journal, et les
codes de sortie sont détaillés plus bas.

Le journal existe parce que le code de sortie seul est indéchiffrable — Windows publie `2` pour
« fichier introuvable », valeur que le script emploie aussi pour « bloqué à l'amorçage ». Les codes :

| Code | Sens |
| --- | --- |
| `0` | passage réussi, instantané écrit |
| `1` | rien collecté et toutes les requêtes en erreur |
| `2` | bloqué à l'amorçage : Datadome a refusé la page d'accueil |
| `3` | exception inattendue, détaillée dans le journal |

Le collecteur reste poli : 2 s entre deux requêtes, empreinte de navigateur tirée au sort à chaque
exécution, et arrêt anticipé dès qu'une page sort de la fenêtre — en pratique 9 requêtes par
passage, soit ~72 par jour.

### La veille et les alertes Telegram

Facultative, comme les clés eBay : sans `TELEGRAM_BOT_TOKEN`, la veille balaie quand même — ce qui
garde le badge « nouveau » à jour — et n'envoie simplement rien.

```bash
npm run veille                # balaie, appaire, alerte
npm run veille -- --dry-run   # n'envoie rien, n'avance aucun repère
npm run veille -- --no-sweep  # appairage et alertes seuls, sans balayage
npm run veille -- --quiet     # pas de détail carte par carte
```

`--dry-run` retient les messages et l'état, pas les instantanés : le balayage écrit `.data/feed/`
comme d'habitude, puisque c'est justement ce qu'on veut observer. Le combiner avec `--no-sweep` pour
ne toucher à rien.

**Créer le bot**, une fois : écrire à [@BotFather](https://t.me/BotFather), `/newbot`, choisir un nom
et un identifiant. Il rend un jeton, à poser dans `.env.local` :

```
TELEGRAM_BOT_TOKEN=123456789:AAE...
# Facultatif, cosmétique : fabrique le lien « Ouvrir Telegram » de la page Alertes,
# qui lance la conversation avec le code déjà saisi.
TELEGRAM_BOT_NAME=MonPokeBrocBot
```

**Connecter un compte** : page **Alertes** du site → « Obtenir un code » → envoyer ce code au bot.
La liaison s'établit au passage suivant de la veille (le code vaut 15 minutes). `/stop` dans la
conversation délie — voir plus haut pourquoi la déconnexion ne se fait pas depuis le site.

**La minuterie**, un quart d'heure convenant bien : c'est assez court pour qu'une annonce fraîche
arrive tant qu'elle est disponible, et assez long pour qu'un balayage de vingt cartes (≈ 50 s,
mesuré) soit terminé avant le suivant.

```powershell
$node = (Get-Command node).Source
$action  = New-ScheduledTaskAction -Execute $node `
             -Argument "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local --import ./tests/resolve-ts.mjs collect/veille.ts --quiet" `
             -WorkingDirectory "$PWD"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
             -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName PokeBroc-Veille -Action $action -Trigger $trigger `
                       -Settings $settings -Force
```

Pour la retirer : `Unregister-ScheduledTask -TaskName PokeBroc-Veille -Confirm:$false`.

Le script tient son journal dans `.data/veille/collect.log`, pour la même raison que le collecteur
leboncoin : sous une minuterie, un code de sortie seul ne dit pas *ce qui* a échoué.

```powershell
Get-Content .data\veille\collect.log -Encoding UTF8 -Tail 20
```

### Tests

`lib/match.ts` décide qu'une annonce parle bien de *cette* carte : c'est là que se joue la valeur du
site, et c'est de la logique pure. La suite couvre la notation, les requêtes construites, la
limitation de débit et les statistiques de prix — aucune dépendance.

`tests/ebay.test.ts` ne couvre qu'une fonction, `looseQuery`, et c'est voulu : le reste de
`ebay.ts` parle au réseau, mais cette transformation-là décide si la moitié du fil existe. Elle
n'avait aucun test le jour où la requête a cessé de ramener quoi que ce soit.

`tests/lots.test.ts` mérite une mention, parce que `match.ts` y porte désormais deux règles
inverses : ce que la notation des cartes pénalise, celle des lots exige. Deux jeux de poids dans le
même fichier se contredisent vite, et c'est bien arrivé — la pénalité de −8 sur les reproductions,
suffisante à l'unité, laissait passer `lot de 10 cartes custom Dracaufeu 4/102 Set de Base` à
exactement le seuil, un lot cumulant un signal de plus qu'une carte seule. D'où l'élimination pure
et simple, et le test qui la fige.

Node 24 exécute le TypeScript nativement mais applique la résolution ESM stricte, qui refuse les
imports sans extension. `tests/resolve-ts.mjs` ajoute ce chaînon manquant avec `module.registerHooks`,
plutôt que de réécrire tout `lib/` pour satisfaire le lanceur de tests.

## Mise en ligne

Trois contraintes décident de la forme, et elles sont toutes mesurées plus haut :

- `.data/` vit sur le disque, et deux mécanismes supposent **un seul processus** — le verrou
  `serialize` de `lib/json-file.ts` et le seau à jetons de `lib/rate-limit.ts`. Vercel, Netlify et
  Cloudflare Pages sont donc exclus, non par préférence mais par incompatibilité.
- Deux minuteries doivent tourner à côté du site, toutes deux au quart d'heure : la veille et le
  collecteur leboncoin. Il faut une machine, pas une fonction.
- Le HTTPS n'est pas facultatif : `lib/auth.ts` pose le cookie de session avec `secure` en
  production, et aucun navigateur ne le renverrait en clair. Sans certificat, personne ne peut se
  connecter — pas même vous.

D'où un VPS et rien de plus exotique. `deploy/` contient tout : sept unités systemd, un Caddyfile,
un installateur et un script de déploiement.

### Ce qui tourne sur le serveur

| Unité | Cadence | Rôle |
| --- | --- | --- |
| `pokebroc.service` | permanent | `next start` sur le port 3000, redémarré s'il tombe |
| `pokebroc-veille.timer` | `*:0/15` | balayage de fond + alertes Telegram |
| `pokebroc-lbc.timer` | `*:5/15` | collecteur leboncoin |
| `pokebroc-sauvegarde.timer` | 4 h du matin | archive `.data/`, 14 jours glissants |
| `caddy` | permanent | HTTPS Let's Encrypt, reverse proxy vers 3000 |

Les minuteries emploient `OnCalendar` et non `OnUnitActiveSec` : `Persistent=true` ne s'applique
qu'aux minuteries de calendrier, et c'est lui qui rattrape un passage manqué pendant un
redémarrage. C'est l'équivalent exact de `StartWhenAvailable` sous le planificateur Windows.

Le collecteur leboncoin est décalé de cinq minutes sur les quarts, là où la veille tombe pile
dessus : sans cela les deux se déclencheraient ensemble à chaque passage et se disputeraient le
processeur pour rien.

### Installer, une fois

Un VPS Debian 12 ou Ubuntu 24.04, 2 vCPU et 4 Go — la construction Next est le seul moment
gourmand. Le disque n'est pas un sujet : `.data/` pèse 24 Mo, dont 23 de cache d'images plafonné à
300 Mo et reconstructible.

```bash
ssh root@votre-vps
git clone https://github.com/djellatine/PokeBroc.git /tmp/pokebroc
bash /tmp/pokebroc/deploy/installer.sh votre-domaine.fr
```

L'installateur est idempotent : le relancer ne touche ni `.data/` ni `.env.local`. Il termine en
rappelant les trois choses qu'il ne peut pas faire à votre place — l'enregistrement DNS, les
secrets, et la clé publique de déploiement.

### Le domaine

Un enregistrement `A` vers l'IP du serveur suffit. Caddy demande son certificat dans la minute qui
suit, puis le renouvelle seul — c'est la raison de le préférer à Nginx ici, où l'on ne veut ni
certbot ni minuterie de renouvellement à surveiller.

### Pousser met en production

`.github/workflows/deploiement.yml` enchaîne deux tâches, et l'ordre est tout l'intérêt du fichier :

1. **Vérifier** — `npm test`, `tsc --noEmit`, `npm run lint`, `npm run build`, puis
   `python collect/test_lbc.py`. La même suite que la skill `livrer` impose avant un commit.
2. **Mettre en ligne** — seulement si la première est verte. Le dépôt travaille directement sur
   `main`, sans branche ni relecture : cette barrière est la seule qui reste entre une faute de
   frappe et le site en ligne.

Le déploiement lui-même (`deploy/deployer.sh`) part par le tuyau SSH plutôt que d'être lu sur le
serveur : c'est donc toujours la version du commit déployé qui s'exécute. Il récupère `origin/main`,
réinstalle les dépendances npm **et** Python, reconstruit, redémarre — puis **vérifie que le site
répond**. S'il ne répond pas dans les trente secondes, il revient à la version précédente,
reconstruit et redémarre à nouveau. Sans ce filet, « pousser met en prod » voudrait aussi dire
« pousser une régression met le site par terre » : la CI a beau tout vérifier, elle ne construit pas
avec le `.env.local` du serveur et ne peut donc pas voir une variable manquante.

`.data/` et `.env.local` ne sont jamais touchés — ils sont ignorés par git, donc `git reset --hard`
les laisse en place. C'est ce qui autorise le déploiement à être brutal sur tout le reste.

Trois secrets à déposer dans **Settings → Secrets and variables → Actions** :

| Secret | Contenu |
| --- | --- |
| `SSH_HOTE` | adresse du VPS |
| `SSH_CLE_PRIVEE` | clé de déploiement, sans phrase de passe |
| `SSH_HOTE_CLE` | sortie de `ssh-keyscan -t ed25519 <hôte>` |

La clé d'hôte est épinglée plutôt que scannée à chaque passage : scanner, c'est faire confiance à
qui répond ce jour-là, et cette clé pilote un serveur.

```bash
# Sur votre poste, une fois :
ssh-keygen -t ed25519 -f deploiement -N "" -C "github-actions"
ssh-copy-id -i deploiement.pub pokebroc@votre-vps   # ou coller dans authorized_keys
ssh-keyscan -t ed25519 votre-vps                    # → SSH_HOTE_CLE
cat deploiement                                     # → SSH_CLE_PRIVEE
```

### Surveiller

```bash
systemctl status pokebroc
systemctl list-timers 'pokebroc*'
journalctl -u pokebroc -n 50 --no-pager
journalctl -u pokebroc-veille.service --since today
tail -n 20 /srv/pokebroc/.data/veille/collect.log
tail -n 20 /srv/pokebroc/.data/lbc/collect.log
```

Les deux collecteurs tiennent leur propre journal en plus de celui de systemd, et pour la même
raison : un code de sortie ne dit pas *ce qui* a échoué.

### Ce que leboncoin va donner, et ce qu'on n'en sait pas

Le sondage du 5 août 2026 a mesuré, depuis un runner GitHub américain : six pages abouties, 210
résultats, puis escalade de Datadome. Vinted, lui, rendait ses 48 annonces sur 960 exactement comme
depuis une ligne de particulier — la veille tournera donc sans histoire.

Ce qui reste inconnu, et que cette mise en ligne va justement trancher : le runner était
**américain** pour un site franco-français. Le pays et le centre de données avaient changé ensemble,
et rien ne disait lequel des deux pesait. Un VPS français peut très bien passer.

En cas d'échec, il n'y a rien à réparer dans l'urgence : `lib/lbc.ts` refuse un instantané de plus
d'une heure et demie, la source disparaît du flux des lots, et le reste du site continue. Les recours, dans
l'ordre de ce qu'ils coûtent : ramener `DEFAULT_WINDOW_H` de 3 h à 1 h, ce qui fait s'arrêter la
pagination au bout d'une page ou deux au lieu de trois — au prix d'une présence de leboncoin trois
fois moindre sur la page Lots ; allonger `THROTTLE_S` — personne n'a mesuré si ralentir suffit à
tenir dans le budget d'une IP d'hébergeur — puis, seulement si cela ne suffit pas, déporter le seul
collecteur sur une machine à IP résidentielle qui pousserait son instantané vers le serveur.

Le passage au quart d'heure pèse ici : douze requêtes par passage, soit ~48 par heure contre ~4 du
temps de la cadence trihoraire. Le budget toléré par Datadome est graduel, et personne ne l'a mesuré
sur ce régime-là.

### Sauvegardes

`deploy/sauvegarde.sh` archive `.data/` chaque nuit dans `/var/backups/pokebroc`, quatorze jours
glissants, `img-cache/` exclu — c'est 23 des 24 Mo, et chaque fichier se retélécharge depuis TCGdex.

Cette sauvegarde protège d'une bêtise, pas de la perte du serveur : elle vit sur le même disque.
Pour cela, activez les instantanés de votre hébergeur — c'est une case à cocher chez les trois.

Restaurer :

```bash
systemctl stop pokebroc
tar -xzf /var/backups/pokebroc/data-AAAA-MM-JJ_HHMM.tar.gz -C /srv/pokebroc
chown -R pokebroc:pokebroc /srv/pokebroc/.data
systemctl start pokebroc
```

## Structure

```
app/
  page.tsx                  accueil : présentation, ou fil des cartes suivies
  lots/page.tsx             l'autre fil : tous les lots des trois places de marché
  layout.tsx                en-tête avec recherche permanente
  robots.ts, sitemap.ts     référencement des fiches cartes
  connexion/, inscription/  formulaires de compte
  carte/[id]/page.tsx       fiche carte + cote + prix observés + recherche libre
  actions/auth.ts           inscription, connexion, déconnexion, plafonds
  actions/favorites.ts      ajout / retrait, « tout marquer comme vu »
  actions/telegram.ts       émission et annulation du code d'appairage
  alertes/page.tsx          état de la veille, appairage Telegram
  api/cards/route.ts        proxy TCGdex + préchauffage des visuels
  api/carte-image/route.ts  visuels servis depuis le cache disque
  api/feed/route.ts         rafraîchissement d'une carte du fil
  api/lots/recents/route.ts rafraîchissement du flux des lots
  api/vinted/route.ts       recherche Vinted + notation (fiche carte)
proxy.ts                    limitation de débit devant /api/*
components/
  Dashboard.tsx             collection, filtres et fil — l'état partagé de l'accueil
  Lots.tsx                  page des lots : liste unique, tri et filtres
  LotTile.tsx               un lot, en vignette (prix par carte sur la photo)
  ModeSwitch.tsx            bascule Mes cartes / Lots, dans l'en-tête
  ViewSwitch.tsx            liste ou grille, préférence partagée par les deux fils
  OfferRow.tsx              une annonce, en ligne
  CardSearch.tsx            barre de recherche et aperçu clavier
  CollectionStrip.tsx       bandeau des cartes épinglées, qui filtre le fil
  VintedResults.tsx         recherche libre de la fiche carte
  PriceHistory.tsx          prix réellement observés sur Vinted
  CardThumb.tsx             visuel de carte, avec réessais et repli sur le nom
  usePersisted.ts           préférences d'affichage (useSyncExternalStore)
  TelegramLink.tsx          code d'appairage : émission, copie, lien profond
  AccountMenu.tsx, AuthForm.tsx, FavoriteButton.tsx, FocusSearchButton.tsx
lib/
  auth.ts                   mots de passe, jetons, session
  store.ts                  comptes, favoris, badge « nouveau », code Telegram
  feed.ts                   instantanés du fil, collecte, fraîcheur
  lots.ts                   lots : flux récent partagé + lots par carte suivie
  sightings.ts              annonces déjà vues, statistiques de prix
  rate-limit.ts             seau à jetons en mémoire
  json-file.ts              lecture/écriture atomique, sérialisation par clé
  image-cache.ts            cache disque des visuels, préchauffage, purge
  tcgdex.ts                 cartes, extensions, images, cotes
  vinted.ts                 session, throttle, cache, normalisation
  lbc.ts                    lecture des lots leboncoin (aucune requête : voir collect/)
  match.ts                  notation des annonces, état, requêtes
  format.ts                 euros, pourcentages, ancienneté
  alerts.ts                 ce qu'une alerte retient, et comment elle se lit
  telegram.ts               bot Telegram : envoi, réception, échappement
  veille.ts                 état de la veille (appairages, repère des alertes)
collect/
  lbc.py                    collecteur leboncoin — hors du site, sur minuterie
  test_lbc.py               ses tests, sans réseau
  veille.ts                 balayage de fond + alertes — hors du site, sur minuterie
deploy/
  installer.sh              provisionnement d'un VPS neuf, une seule fois
  deployer.sh               ce que la CI lance sur le serveur, avec retour arrière
  sauvegarde.sh             archive .data/ chaque nuit, 14 jours glissants
  Caddyfile                 reverse proxy et HTTPS automatique
  pokebroc*.service/.timer  le site et ses trois minuteries
tests/                      node:test — match, ebay, rate-limit, sightings, format, alertes
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
- La page Lots ne dit rien du contenu réel d'un lot. `Lot de 300 cartes Pokémon` en dit autant que
  le vendeur a bien voulu en dire — c'est même la raison d'être de la page, mais cela vaut d'être
  su avant d'acheter.
- La traduction des symboles vaut pour la recherche d'**annonces**, pas pour la recherche de
  **cartes** de l'en-tête : celle-ci interroge TCGdex, qui ne connaît que le nom officiel. Taper
  `dracaufeu gold star` n'y trouve rien ; `dracaufeu` remonte la carte, symbole compris.
- Les lots leboncoin ne se rafraîchissent pas à la demande : le site affiche ce que la dernière
  minuterie a déposé, et un visiteur ne peut pas rattraper une collecte en retard. Depuis un
  hébergeur, le budget de requêtes toléré est nettement plus court — voir la mesure plus haut.
- `collect/lbc.py` ne recherche pas « lot pokemon » sans le mot « cartes », là où le flux Vinted le
  fait : sur leboncoin cette requête rend surtout des peluches, des jouets et des vêtements. Le
  catalogue de Vinted, déjà celui d'une brocante de mode, restait exploitable ; celui de leboncoin
  ne l'est pas.
- Le filtre « annonces en français » ne s'applique pas aux alertes : c'est une préférence de
  navigateur (`localStorage`), que la veille — qui tourne sans navigateur — ne peut pas lire. Une
  alerte peut donc porter sur une annonce eBay étrangère que le fil vous masquerait.
- La veille et le site écrivent tous deux `.data/feed/` et `.data/sightings/`. La concurrence y est
  bénigne — les écritures sont atomiques, donc jamais tronquées — mais deux passages simultanés sur
  la même carte peuvent faire perdre le second instantané. Au pire, une annonce est redécouverte au
  tour suivant.
- Une alerte part au plus tôt au passage suivant de la veille : à un quart d'heure de minuterie,
  c'est le délai entre la mise en ligne et la notification.
- Telegram suppose un compte Telegram. C'est le prix du canal — voir plus haut ce que coûtaient les
  deux autres.
- Leboncoin ne publie ni compteur de favoris ni prix total en recherche : le nombre de favoris vaut
  toujours zéro, et les frais de port n'apparaissent pas — le mode de remise se choisit à l'achat.

## Suite possible

Un seuil par carte au-dessus des alertes — « Dracaufeu sous 40 € » — plutôt que la règle unique
d'aujourd'hui, qui signale toute annonce neuve dès lors qu'elle est bien celle de la carte. La
notation et le repère existent ; il n'y manque qu'un champ dans `FavoriteCard` et un test de plus
dans `selectFresh`. Puis d'autres jeux (Yu-Gi-Oh!, One Piece).

Côté lots, le filtre « ne montrer que les lots contenant telle carte » est la suite naturelle : la
notation existe déjà (`scoreLot`, `lotQueries`), il ne lui manque qu'un sélecteur au-dessus de la
liste. Posé là plutôt que dans la collecte, il ne coûte aucune requête supplémentaire.
