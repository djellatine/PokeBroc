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
| Nom sans homonyme, quand le numéro manque (Gold Star) | +4 |
| Lot / classeur / display | −2 |
| Annonce sponsorisée | −1 |
| Reproduction (`custom`, `proxy`, `orica`…) | −8 |
| Ni une carte, ni une vente (voir plus bas) | −8 |

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

### Ce qui trônait quand même en tête

La même pénalité manquait à deux familles d'annonces, et le relevé du 29 août 2026 est sans appel :
sur la page d'accueil, tri « Meilleures affaires », filtres par défaut, **les quinze premières
annonces étaient toutes fausses**. Une peluche, une vitrine de présentation vide, deux
protège-cartes, quatre autocollants Merlin ou Dunkin, deux vignettes Topps, une carte d'une autre
extension, et trois annonces d'achat à 1 €.

Ce n'est pas une marge d'erreur, et c'est ce qui rend le problème structurel plutôt qu'anecdotique :

> Un objet à 3 € rapporté à la cote d'une carte à 1 000 € affiche **−100 %**, un écart qu'aucune
> vraie occasion ne peut battre. Le bruit ne se répartit donc pas dans la liste — il se concentre
> exactement là où le regard se pose en premier.

Rapporté à l'ensemble, ces annonces sont rares : 23 sur 871. Mais elles occupaient tout le haut du
classement, et enterraient de vraies affaires — un `Ectoplasma Prime 94/102` à 105 € sur une cote de
1 028 €, invisible sous quatre autocollants.

D'où deux vocabulaires éliminatoires, sur le modèle des reproductions :

- **Ce n'est pas une carte** — `peluche`, `figurine`, `protege carte`, `protection illustree`,
  `vitrine`, `toploader`, `sleeve`, `sticker`, `autocollant`, `vignette`, et les marques des
  vignettes des années 1990 (`merlin`, `panini`, `amada`, `topps`, `dunkin`, `boomer`), qui portent
  le nom du Pokémon et un numéro de série — d'où la confusion.
- **Ce n'est pas une vente** — `recherche`, `echange`, `achete`, `achat`. Le vocabulaire est étroit à
  dessein : `recherche` et `recherchee` restent deux mots distincts après `normalize`, sans quoi
  « carte très recherchée » tomberait avec.

### Une autre impression du même Pokémon

`Salamèche 98/165` n'est pas `Salamèche 98/97` — le dénominateur le dit explicitement. Sept annonces
de ce genre affichaient jusqu'à −85 % de la cote d'une carte qu'elles ne vendaient pas. La règle du
numéro acceptait le numéro **nu** et ne regardait jamais ce qui le suivait.

Elles **perdent leur numéro, donc leur rang de forte** : visibles en élargissant, sans écart à la
cote — qui serait celui d'une autre carte — et jamais annoncées. La première version les gardait
fortes et ne leur retirait que l'écart, au motif qu'une autre impression de son Pokémon vaut d'être
vue. La Carapuce McDonald's de 2002 a tranché le 3 septembre 2026 : sur « Squirtle 007 », vingt-sept
annonces fortes sur trente-deux étaient des 007/165 du 151, à deux euros, et chacune aurait déclenché
une alerte. Le dénominateur dit la carte aussi sûrement que le nom.

Sur une carte japonaise, le **numéro nu ne suffit pas non plus** : chaque extension a sa 007, et
« 1998 Pokemon 007 Squirtle Vending » n'est pas la McDo. Le numéro n'y compte qu'avec son total
(« 007/018 ») ou le code de l'extension (« SV-P 001 »). Les françaises gardent « n°4 » et « #4 »,
mesurés utiles dès l'origine.

Les **deux** décomptes de TCGdex sont acceptés — `official` et `total`, soit « 102 » et « 103 » pour
une extension à cartes secrètes. Les vendeurs emploient l'un ou l'autre, et n'en retenir qu'un aurait
fait passer la moitié des annonces légitimes pour une autre impression.

Effet mesuré sur les 871 annonces alors visibles : 23 écartées, 13 privées de leur écart, et un haut
de classement qui ne contient plus que de vraies cartes.

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

### Les cartes japonaises

Certaines cartes n'existent qu'au Japon — les promos McDonald's, les campagnes Pokémon Center, des
extensions entières jamais traduites — et se vendent pourtant en France, sur les mêmes places de
marché. TCGdex les connaît, dans une base séparée : 184 extensions et la cote Cardmarket, qui vend
aussi du japonais. Ce qu'il n'a pas, c'est le nom français — la base japonaise ne parle que
katakanas, sans numéro de Pokédex — ni, le plus souvent, le visuel : 3 882 cartes sur 12 781 en
ont un (mesuré le 3 septembre 2026), et aucune promo SV-P ou M-P, précisément celles qu'on suit.
Ni, surtout, la moitié des cartes : 18 Salamèche quand la base française en compte 46, rien avant
1999, rien des promos d'enseigne — la Salamèche McDonald's de 2002, celle qu'on cherchait, n'y
est pas.

D'où un **second catalogue, Bulbapedia** (`lib/bulbapedia.ts`), qui tient pour chaque espèce la
liste de toutes ses impressions dans un gabarit régulier (`{{card list/release|jpset=…|jpnum=…}}`)
et, pour chaque carte, une page avec le nom japonais, le visuel et ses sorties. La recherche « JP »
interroge les deux et fusionne : TCGdex d'abord, pour sa cote, Bulbapedia pour tout ce qui manque,
une carte n'étant ajoutée que si son numéro imprimé n'est pas déjà là (`printedKey` rapproche
« 004/018 » de « 004 » sur 18). Mesuré sur Salamèche : 62 cartes au lieu de 18. Une carte venue
de là porte l'identifiant `jb:{page}|{numéro}` (`jb:Charmander (McDonald Pack 4)|004/018`), n'a
pas de cote — le fil montre ses annonces sans écart — et son visuel vient des archives
Bulbagarden, que le cache local relaie aussi, en se présentant : le wiki refuse les clients
anonymes, et on ne lui demande jamais plus de quatre pages à la fois.

Deux traits des cartes japonaises anciennes que la notation apprend au passage : le total
s'imprime sur autant de chiffres que le numéro (« 004/018 », que « 004/18 » ne trouverait pas), et
les cartes d'avant 2008 n'ont pas de numéro de collection du tout — elles se cherchent par le nom
et « carte pokemon japonaise », la notation trie. Les extensions nommées en anglais se cherchent
par leurs mots, comme les françaises, et « McDonald's » vaut aussi « McDo » et « MacDo », que les
vendeurs écrivent bien plus volontiers.

Enfin, **les japonaises se cherchent aussi sous leur nom anglais**. Mesuré le 3 septembre 2026 sur
la Carapuce McDonald's de 2002 (007/018) :

| Requête | Vinted | eBay |
| --- | --- | --- |
| `Carapuce 007/018` | 0 annonce de la carte | 0 de la carte, 27 « fortes » qui sont des 007/165 |
| `Squirtle 007/018` | 1, la vraie, à 2 199 € | 32 fortes, la vraie en tête |

La seule annonce Vinted réelle est titrée en anglais, et eBay en aligne une centaine sous
« squirtle mc donald 2002 ». La notation reconnaissait déjà le nom anglais ; c'est la requête qui
restait française. `englishQuery` compose donc la même requête sous le nom anglais, pour les
japonaises dont il diffère du français — pas pour Pikachu, pas pour une Dresseur, jamais pour une
française. Vinted, sans quota, reçoit les deux noms, deux passes chacun ; eBay, compté à 5 000
appels par jour, reçoit l'anglais **à la place** du français, qui n'y trouvait rien de plus.
Pour le visuel, deux replis, dans cet ordre. TCGdex donne l'identifiant TCGplayer de chaque
tirage, et TCGplayer sert l'image par cet identifiant seul : `getCard` le range dans `image` sous
la forme `tcgplayer:587758`, que seule `cardImage` sait lire. Mais TCGplayer n'a ni les anciennes
séries ni les promos toutes neuves — sur dix Carapuce, cinq restaient sans visuel. Cardmarket, lui,
vend tout, et sert l'image par identifiant produit sous le code de l'extension
(`cardmarket:sm9b/558126`), à deux conditions mesurées le 3 septembre 2026 : un `Referer` de chez
lui, sans quoi 403, et la bonne casse du code — « SV-P » et « M-P » tels quels, « sm9b » ou
« sm12a » en minuscules. `cardmarketImage` sonde les trois graphies en `HEAD` une fois par
extension et par processus. Le cache local relaie ces trois CDN comme il relaie TCGdex.

Une carte japonaise porte donc un identifiant préfixé, `ja:SV-P-001`, qui suit la carte partout —
favoris, instantanés, adresses de page — et dit à `getCard` quelle base lire. Le préfixe évite au
passage une collision réelle : `SV8a` et `sv8a` ne diffèrent que par la casse, que Windows ignore
dans les noms de fichiers. Le bouton **JP** de la barre de recherche bascule vers cette base, et se
cherche avec le même nom français : `lib/japanese.ts` traduit la saisie en katakanas depuis la
table des espèces (`pokedex-names.ts`, tirée de PokéAPI), puis retraduit les résultats. Les cartes
Dresseur, hors table, gardent leur nom japonais et se cherchent en le tapant tel quel.

La notation part de ce que les vendeurs écrivent, relevé le 3 septembre 2026 sur `Pikachu 001/SV-P` :

| Titre | Ce qu'on en lit |
| --- | --- |
| `Pikachu Promo 001/SV-P` | nom + numéro, avec le **code de l'extension** en dénominateur |
| `Pikachu Promo Japonais (SV-P 001)` | le même numéro, code devant, plus la langue |
| `Pikachu McDo 020/M-P` | une promo McDonald's japonaise : `M-P` |
| `Évoli / Eevee Reverse Pokéball SV8a 125/187` | numéro et total, comme une française, et le code |
| `Pikachu 001/SV-P Chinese Sealed` | **une autre carte** : même numérotation, autre langue, autre prix |

Sur la première page de cette requête, 31 annonces sur 48 sont fortes, et les 8 chinoises retombent
à 6 ou 7 — visibles en élargissant, sans écart à la cote, jamais annoncées. D'où trois différences
avec une carte française :

- **Le numéro se lit avec le code de l'extension** quand la promo n'a pas de total — `001/SV-P`,
  `SV-P 001`, `197|sv-p`, `SVP 001` — et le code compte comme signal d'extension, en mot entier
  (`m p` est aussi la fin de `film pokemon`). Le nom de l'extension japonaise, lui, n'apparaît
  dans aucun titre et n'est jamais cherché.
- **La langue déclarée compte** : `japonaise`, `jap`, `JP`, `JPN` valent +2. Assez peu pour que
  « Pikachu japonaise » reste une correspondance large — il y a cent Pikachu japonaises — mais
  assez pour qu'un numéro avec son code et la langue fassent une forte sans le nom (4 + 3 + 2), ce
  qui est le cas des cartes Dresseur. Une **autre** langue déclarée — `chinois`, `chinese`,
  `coréen` — retire 4 points et efface l'écart à la cote : les chinoises portent la numérotation
  japonaise à l'identique, seul le titre les distingue.
- **Le nom anglais est admis** : `Leafeon ex 003/187` vaut `Phyllali ex 003/187`.

Rien de tout cela ne touche une carte française : les signaux de langue n'existent que pour les
japonaises, et « Dracaufeu 4/102 japonaise » garde son score de 8.

Les alertes viennent sans rien ajouter : la veille note les annonces avec la même règle, et une
Pikachu `001/SV-P` à −40 % arrive sur Discord avec un drapeau devant son nom. Ce qui reste hors
champ : la surveillance Cardmarket, dont le collecteur résout ses pages depuis la base française et
impose la langue française — le bouton **CM** n'est pas proposé sur une japonaise.

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

### Quatre collectes de front, et pas quarante-huit

« Actualiser » émet une requête **par carte suivie**. À quarante-huit cartes, c'était quarante-huit
appels simultanés à `/api/feed` — et un navigateur n'ouvre que six connexions par origine. Les
quarante-deux autres attendaient, et **la navigation vers la page Lots attendait derrière elles** :
cliquer sur « Lots » pendant une actualisation ne faisait rien pendant une bonne minute.

Les brider ne coûte pourtant rien en durée, et c'est ce qui rend l'arbitrage facile : `lib/vinted.ts`
sérialise déjà tous ses appels à 350 ms d'intervalle, et `lib/ebay.ts` fait de même. Quatre-vingt-seize
recherches Vinted prennent une trentaine de secondes quoi qu'il arrive ; les envoyer d'un coup
n'accélérait rien, cela occupait seulement les connexions du navigateur pour attendre plus longtemps.
Quatre suffisent à garder la file du serveur pleine.

### Et une actualisation qui survit à la navigation

Brider ne suffisait pas : il fallait encore que passer aux Lots n'interrompe pas ce qui était en
cours. Les deux collectes s'annulaient au démontage du composant — le rattrapage automatique par un
nettoyage d'effet, et le bouton par un ajout de la même veine.

C'était le mauvais réflexe. Un nettoyage d'effet se déclenche aussi bien quand ses dépendances
changent que **lorsqu'on quitte la page**, et les deux ne méritent pas le même sort : une liste de
cartes qui change rend caduque la collecte en cours, une navigation non. L'annulation est donc posée
à l'entrée — on remplace le passage précédent — et plus jamais en nettoyage.

Rien n'est perdu en chemin : chaque collecte **écrit son instantané sur le disque avant de
répondre**. Les `setState` qui reviennent après le démontage ne servent plus à rien, mais le travail
est déjà rangé, et la page d'accueil — qui se rend depuis le disque — le retrouve au retour. La
bascule de l'en-tête étant un `Link`, la navigation est côté client : le contexte JavaScript survit,
et les requêtes en vol poursuivent leur route.

Le compromis, dit franchement : les quatre premières cartes attendent ensemble le passage leboncoin
(une quinzaine de secondes), là où elles se noyaient auparavant dans quarante-quatre collectes
parallèles. Une actualisation complète dure donc une dizaine de secondes de plus — en échange d'une
page qui reste navigable pendant tout ce temps, et d'une collecte qui continue sans nous.

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

## Une annonce qu'on ne veut plus voir

Le plafond de douze annonces par carte empêche un Dracaufeu très représenté d'occuper tout l'écran,
mais il ne fait rien contre l'annonce unique qui, elle, ne part pas : la contrefaçon manifeste, le
vendeur au prix fantaisiste, le lot reposté chaque semaine. Elle est bien celle de la carte suivie,
donc la notation la retient, et elle revient à chaque passage.

D'où la croix posée au coin de chaque annonce, dans les quatre affichages — fil et lots, ligne et
vignette. Un clic, elle disparaît et ne revient plus.

**Sur le serveur, pas dans `localStorage`.** Une annonce congédiée depuis le téléphone doit le rester
sur l'ordinateur ; et surtout, la veille tourne dans un autre processus — il lui faut lire cette
liste pour ne pas annoncer sur Discord ce qu'on vient tout juste d'écarter. Le cas n'est pas
théorique : elle passe au quart d'heure, et une annonce découverte puis refusée sur le site entre
deux passages serait sans cela notifiée juste après l'avoir été.

**Une seule liste pour les deux fils.** Les identifiants d'annonce partagent le même espace de noms
(`vinted:123`, `ebay:v1|456|0`, `lbc:789`) : un lot masqué sur la page Lots l'est aussi dans le fil
des cartes, où il pouvait remonter par la notation ordinaire. C'est la même annonce.

**Le masquage se voit et se défait.** Une croix cliquée par mégarde effacerait sinon une annonce sans
trace ni retour. Une ligne sous la barre d'outils dit combien d'annonces du fil courant sont
masquées, avec « Annuler la dernière » et « Tout réafficher » — la même forme que les avis du seuil
de pertinence et du drapeau français, qui disent déjà « voilà ce que vous ne voyez pas ».

Le filtre s'applique **avant** tous les autres, pour qu'une annonce écartée à la main ne pèse dans
aucun des autres compteurs : « 3 annonces au titre étranger sont masquées » promettrait sinon un
retour qui n'aurait pas lieu.

Un plafond de mille masquages par compte borne `users.json`, les plus anciens sautant en premier —
ce sont ceux dont l'annonce a le plus de chances d'être déjà vendue, donc de ne jamais revenir. Mille,
c'est vingt-cinq fois ce qu'un fil affiche d'un coup.

## Les alertes arrivent sans qu'on regarde

Le fil ne se collectait que sous les yeux d'un visiteur : `refreshCard()` n'était appelé que depuis
un rendu de page ou `/api/feed`. Personne sur le site, aucune collecte ; aucune collecte, rien à
annoncer. Une notification qui ne se déclenche que devant l'écran ne notifie rien.

`collect/veille.ts` est le second processus qui manquait. Sur minuterie — le même patron que le
collecteur leboncoin — il balaie l'union des cartes suivies, relève la boîte de réception du bot,
et envoie sur Discord ce qui vient d'apparaître. Deux effets, dont le second était déjà souhaitable
avant qu'il soit question d'alertes :

- les annonces neuves sont découvertes dans les minutes qui suivent leur mise en ligne ;
- le badge « nouveau » redevient honnête pour qui ne vient qu'une fois par jour — sans veille, il ne
  montrait que ce que la visite venait elle-même de déterrer.

### Pourquoi Discord, et par webhook

Le Web Push voudrait un service worker, des clés VAPID et surtout du HTTPS, que ce site n'a pas.
L'e-mail partirait d'une IP résidentielle, donc en indésirables, à moins de louer un relais —
c'est-à-dire d'ajouter le service tiers évité partout ailleurs. Un **webhook Discord** n'attend
qu'un POST sortant : ni certificat, ni port ouvert, ni dépendance ajoutée. Le site en compte
toujours trois (`next`, `react`, `react-dom`).

Webhook plutôt que bot : un bot demanderait une application, un jeton, des permissions et une
connexion à entretenir. Le webhook est une simple URL liée à un salon — on la crée en trente
secondes, on ne l'entretient pas. Sa contrepartie assumée : il écrit dans **un seul salon**, sans
destinataire par personne. Pour un usage perso, c'est exactement ce qu'on veut, et c'est ce qui
supprime tout l'appairage que le bot Telegram précédent imposait.

### Ce qui déclenche une alerte

Exactement ce que le fil montre par défaut : correspondance forte (le titre cite le nom **et** le
numéro ou l'extension), ni gradée, ni lot, et pas écartée à la main. Reprendre les réglages par
défaut du tableau de bord
plutôt qu'en inventer d'autres est la seule façon qu'une alerte ne mène pas à une page où l'annonce
annoncée est justement filtrée — et un lien qui ne montre rien décrédibilise le suivant.

La règle vit dans `lib/alerts.ts`, pas dans le script : c'est une décision métier, elle se teste sans
réseau (`tests/alerts.test.ts`). La mise en forme et l'envoi vers Discord vivent à part, dans
`lib/discord.ts`.

Deux alertes qui passaient à la trappe, relevées le 3 septembre 2026 :

- **Une rafale.** Un seul message partait, plafonné à dix cartes et vingt-cinq annonces ; le reste
  n'était que compté — « … et 14 autres, sur le site » — puis marqué comme annoncé, donc jamais
  cité. Or une rafale est précisément le moment où l'on veut tout voir : après une panne de Vinted,
  ou une soirée où vingt vendeurs postent. `buildMessages` poste désormais autant de messages qu'il
  faut, numérotés, à 1,2 s d'intervalle ; le renvoi au site ne vaut plus que passé huit messages,
  soit deux cents annonces.
- **Un nom sans homonyme.** « Métalosse gold star espèce Delta » à 1 899 € restait à 7 — nom et
  extension, pas de numéro — donc jamais annoncée, alors qu'il n'existe qu'une Gold Star par espèce.
  Sur ces cartes, le nom vaut le numéro (`unique` dans `MatchSignals`). Les autres raretés à nom —
  ex, GX, V — existent en dix versions par espèce et ne bénéficient pas de la règle.

Et la troisième trappe, la plus large, lue dans le journal de la tablette le soir même : « 47 cartes
balayées, 0 alerte envoyée — 48 erreurs : Carte introuvable dans la base TCGdex », à presque
chaque passage depuis la veille au soir, alors que TCGdex répondait en 350 ms dès qu'on
l'interrogeait à la main. Un hoquet intermittent du catalogue rendait *chaque* carte introuvable,
donc rien n'était collecté ni annoncé, parce que rien ne retenait la fiche lue au passage
précédent — et que, hors de Next, `fetch` n'a aucun cache. D'où `lib/card-cache.ts` : une copie de
chaque fiche dans `.data/cards/`, servie tant qu'elle a moins de six heures, et reprise même
périmée quand le catalogue ne répond pas (le fil le signale alors). Le catalogue reçoit une
requête par carte et par six heures au lieu de deux par quart d'heure. Dans le même mouvement,
`fetchCardDetail` distingue enfin une carte inconnue (404) d'un catalogue muet, et toutes les
requêtes sortantes — TCGdex, Vinted, eBay, Bulbapedia — ont un délai maximal : un passage qui
traînait était tué à trois minutes par le lanceur, sans rien écrire, ni instantané ni journal.

Reste le cas qui n'est pas une trappe mais une confusion : le site découvre des annonces à chaque
visite — elles portent la pastille « nouveau » — mais seule la veille alerte. Un serveur de
développement sur un autre poste montre donc des nouveautés sans jamais rien envoyer, et ce n'est
pas la tablette qui a oublié.

### Deux processus, un seul écrivain par fichier

`store.ts` sérialise ses écritures **en mémoire**, ce qui ne protège de rien entre deux processus :
le site et la veille liraient la même version de `users.json`, et la seconde écriture effacerait la
première — avec la carte que l'utilisateur venait d'épingler.

D'où le partage, calqué sur celui de `collect/lbc.py` : le site possède `users.json`, la veille
possède `.data/veille/state.json`, et chacun se contente de lire celui de l'autre. Le webhook Discord
n'ayant pas d'appairage, l'état de la veille se réduit à un repère global — la date après laquelle
une annonce reste à annoncer — plus le compteur d'alertes envoyées.

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

`SESSION_HTTP=1` retire le drapeau `secure` du cookie de session, pour un site
servi en HTTP assumé — réseau local ou Tailscale, déjà chiffrés. Sans cette
échappatoire, le navigateur refuserait silencieusement le cookie et toute
connexion serait impossible, sans un mot d'erreur. Ne jamais le poser derrière
un domaine public.

> Le stockage fichier suppose **un seul processus Node** — la limitation de débit aussi, son compteur
> vivant en mémoire. Pour un déploiement multi-instance, remplacez `lib/store.ts` : sa surface est
> déjà asynchrone et ignore le support.

## Les visuels de cartes passent par un cache local

`assets.tcgdex.net` génère ses images à la demande. Mesuré pendant le développement : **15 à 25 s
pour un fichier de 18 Ko**, des `502` par salves, et des requêtes qui n'aboutissent jamais.

1. **Cache disque** (`lib/image-cache.ts` + `/api/carte-image`) — le visuel est téléchargé une fois
   puis servi depuis `.data/img-cache`. Mesuré : 20 s à froid pour 18 images, **122 ms à chaud**.
   Le proxy n'accepte que `assets.tcgdex.net`, les deux CDN de TCGplayer, celui de Cardmarket et
   les archives Bulbagarden (visuels des cartes japonaises absentes de TCGdex), sinon il servirait
   de relais vers n'importe quelle adresse.
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
- **Lots leboncoin** : collectés par `collect/lbc.py`, hors du site. Voir ci-dessous.
- **Offres Cardmarket** : collectées par `collect/cardmarket.py`, hors du site, pour les seules cartes
  cochées « précieuse » (bouton **CM** du bandeau de collection). Voir ci-dessous et la page d'aide
  `/cardmarket`.

### Pourquoi Cardmarket passe par un navigateur piloté

Cardmarket est derrière Cloudflare, qui sert un défi JavaScript à toute requête sans laissez-passer.
Mesuré le 31 août 2026 : le `fetch` de Node comme `curl_cffi` — l'arme qui suffit pour Datadome —
reçoivent le défi. En rejouant le cookie `cf_clearance` d'un vrai Edge, `curl_cffi` obtient 200
quelques requêtes puis 403 : le cookie est lié à l'empreinte TLS **d'Edge**, non à celle de Chrome
qu'il imite. Seul un vrai navigateur passe de façon stable. `collect/cardmarket.py` **lance donc son
propre Edge** (Playwright, profil persistant `.data/cardmarket/profil` qui garde le `cf_clearance`),
fenêtre **hors écran** par défaut — invisible, mais bien meilleur que *headless* face à Cloudflare —
et `--visible` quand un défi doit être levé à la main. Aucun script ne coche un CAPTCHA : au premier
usage ou après un durcissement, `python collect/cardmarket.py --visible --resolve` une fois.

Là où Edge n'existe pas — Linux ARM64, donc la tablette —, le collecteur se rabat sur le **Chromium
que Playwright embarque**, quitte à lever un défi à la main un peu plus souvent, et ajoute
`--no-sandbox` quand il se croit root : sous proot, le bac à sable de Chromium ne peut pas s'établir
et le navigateur refuserait même de démarrer. La fenêtre « hors écran » exige un serveur X, que
`deploy/tablette/lancer.sh` fournit avec Xvfb.

Lancer Edge par Playwright pose par défaut `--enable-automation`, donc
`navigator.webdriver = true` — que Cloudflare lit, et son défi tourne alors en boucle même quand on
coche la case à la main. On l'efface (`ignore_default_args=["--enable-automation"]` +
`--disable-blink-features=AutomationControlled`) : `webdriver` repasse à `false` et le défi se lève.
Le blocage résiduel est **fonction du volume**, pas de l'automatisation ; une cadence douce le tient
à distance, un marathon de requêtes le réveille. D'où la minuterie au quart d'heure et le champ
`status.json`, que le site lit pour afficher « collecte bloquée » plutôt qu'un vide sans explication
(`cardmarketWarning`).

Les offres ne remontent **pas dans le fil** — sans photo par offre, elles en cassaient la grille —
mais dans une **colonne dédiée** (`components/CardmarketColumn.tsx`), à droite. Elle plafonne à
quelques offres par carte (`CARDMARKET_PER_CARD`) pour qu'activer une carte ne noie pas les autres,
se trie (récentes / prix / écart), s'écarte offre par offre (une croix, même stockage que les
masquages du fil) et se rafraîchit seule via `GET /api/cardmarket`, sans recharger la page.

Cette collecte exige une **IP résidentielle** — jamais un serveur de datacenter, où
`CARDMARKET_PYTHON` reste absent et le balayage de la veille un no-op. Sous Windows, la tâche
planifiée `PokeBroc Cardmarket` la relance toutes les 15 min ; `collecte-cardmarket.bat` en est le
lanceur. Sur la tablette, c'est le repli Chromium ci-dessus qui la rend possible.

L'**API officielle** aurait été plus propre (30 000 requêtes/jour), mais elle est réservée aux
vendeurs professionnels et n'accepte plus de nouvelles demandes (vérifié le 31 août 2026) : le
scraping reste la seule voie, assumée fragile.

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

### Leboncoin cherche vos cartes, pas seulement des lots

Leboncoin n'a longtemps alimenté que la page Lots, avec quatre requêtes génériques. On a mesuré, le
29 août 2026, si ce vivier suffisait à alimenter aussi le fil des cartes : ces requêtes ramènent bien
des cartes à l'unité — leboncoin cherche large, « lot cartes pokemon » rend des « Brindibou ar
90/88 » — mais **109 annonces de cartes publiées dans les trois heures, confrontées aux 48 cartes
suivies, ont produit zéro correspondance forte**. Vingt et une correspondances larges, toutes
fausses : un « Raichu 14/62 » accroché à « Suicune 14/64 » par le seul numéro.

Ce n'est pas que leboncoin n'a pas ces cartes. Cherchées **nommément**, elles sortent :

| Requête | Trouvé |
| --- | --- |
| `Ectoplasma ex 108/112` | 3 annonces, de 385 à 600 € |
| `Suicune 14/64` | 6 annonces, dès 120 € |
| `Rayquaza gold star 107/107` | 1 annonce à 5 000 € — la carte n'a *rien* sur eBay |

Elles sont simplement rares. Le site publie ~78 annonces de cartes par heure ; la probabilité qu'une
carte précise soit dans le lot d'une heure donnée est infime, et un flux générique ne la croisera
jamais. D'où une requête par carte suivie.

**Et d'où la rotation.** Quarante-huit requêtes par quart d'heure quadrupleraient le trafic vers un
site qui en refuse déjà une sur trois. Chaque passage en prend douze, et le tour complet se boucle en
une heure — très en deçà du rythme auquel ces annonces apparaissent. Un passage coûte donc seize
requêtes au lieu de douze, mesuré à 44 s.

Le partage des rôles suit celui du reste du projet : **`lib/lbc.ts` compose les requêtes**, le
collecteur les joue. `bestQuery` s'appuie sur `searchName`, qui traduit `☆` en « gold star » et
retire `δ` — et la moitié des cartes suivies porte un de ces symboles. Redire ces règles en Python
serait les laisser diverger au premier ajustement. C'est la veille qui dépose la liste, tournant au
même quart d'heure et tenant déjà l'union des cartes suivies.

Relevé sur la première tranche réelle : **7 cartes sur 12 avec au moins une correspondance forte, 29
au total**, toutes justes.

### « Actualiser » relance aussi leboncoin

Le bouton promet « on regarde maintenant ». Il ne le tenait que pour deux sources sur trois :
leboncoin n'affichait que ce que la dernière minuterie avait déposé, donc jusqu'à un tour de rotation
plus tôt. Node ne peut pas interroger leboncoin lui-même — c'est tout le sujet de la section
précédente — il lance donc le script Python, désigné par `LBC_PYTHON`.

Ce qui rend la chose délicate est le fan-out du bouton : un clic n'émet pas *une* requête mais **une
par carte suivie**, quarante-huit appels parallèles à `/api/feed`. Lancer le collecteur dans chacun
ferait quarante-huit amorçages simultanés — précisément la requête que Datadome refuse déjà une fois
sur trois, et en rafale.

D'où deux garde-fous dans `refreshLbcLive` :

| | Valeur | Pourquoi |
| --- | --- | --- |
| Regroupement | 300 ms | le premier appel ouvre un lot, les autres le rejoignent : **un seul amorçage** pour tout le clic |
| Plafond | 8 cartes | quarante-huit recherches à 2 s feraient plus d'une minute et demie de bouton qui tourne |
| Délai entre deux lots | 60 s | le délai du bouton se compte *par carte* ; il en fallait un global |
| Abandon | 35 s | l'instantané précédent vaut mieux qu'une page qui ne répond plus |

Le plafond va aux cartes dont les annonces sont les plus vieilles — une carte jamais collectée passe
avant toutes les autres, une carte vue il y a dix minutes n'a presque rien à gagner. Les autres se
contentent de l'instantané, qui a de toute façon moins d'un tour.

La rotation ordinaire n'est pas touchée : `refresh_cards` relit et réécrit son `offset` tel quel,
pour qu'un clic ne fasse pas sauter son tour à une carte. Mesuré : six cartes rafraîchies en 12,9 s
pour un seul amorçage, offset inchangé.

Sans `LBC_PYTHON`, rien de tout cela ne se produit et le site se contente de l'instantané — comme il
tourne sans clés eBay. Sur le serveur, c'est l'interpréteur du `venv` que crée l'installateur :

```
LBC_PYTHON=/srv/pokebroc/.venv/bin/python
```

Un défaut est apparu à cette occasion, et il ne concernait pas leboncoin seul. `MAX_PER_CARD` tronque
le fil à 40 annonces après un tri par score, et `sort` étant stable, les égalités retombaient sur
l'ordre de collecte : Vinted, eBay, puis leboncoin. La source arrivée en dernier était donc
systématiquement la première sacrifiée — sur `hgss4-94`, six correspondances fortes leboncoin, dont
un « Ectoplasma Prime 94/102 » à 160 €, sortaient du fil derrière quarante annonces de même score.
Les égalités se départagent désormais **par date de mise en ligne**, ce qui est à la fois neutre et
conforme à ce que la page promet.

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

Sous Windows, `demarrer.bat` fait la même chose d'un double-clic : il installe les dépendances au
premier lancement, démarre `npm run dev` et ouvre le navigateur tout seul — de quoi lancer le site
sans passer par un terminal.

Aucune variable d'environnement n'est nécessaire en développement. `NEXT_PUBLIC_SITE_URL` sert au
plan de site, `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` ajoutent eBay au fil, et `DISCORD_WEBHOOK_URL`
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

### La veille et les alertes Discord

Facultative, comme les clés eBay : sans `DISCORD_WEBHOOK_URL`, la veille balaie quand même — ce qui
garde le badge « nouveau » à jour — et n'envoie simplement rien.

```bash
npm run veille                # balaie puis alerte sur Discord
npm run veille -- --dry-run   # n'envoie rien, n'avance aucun repère
npm run veille -- --no-sweep  # alertes seules, sans balayage
npm run veille -- --quiet     # pas de détail carte par carte
```

`--dry-run` retient les messages et l'état, pas les instantanés : le balayage écrit `.data/feed/`
comme d'habitude, puisque c'est justement ce qu'on veut observer. Le combiner avec `--no-sweep` pour
ne toucher à rien.

**Créer le webhook**, une fois : sur le serveur Discord, **Paramètres du salon → Intégrations →
Webhooks → Nouveau webhook**, puis **Copier l'URL**. La poser dans `.env.local` :

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123.../abc...
```

C'est tout — pas de compte à connecter, pas de code. La page **Alertes** du site montre le webhook
comme branché et propose un **message de test** pour vérifier qu'il pointe sur le bon salon. Les
alertes arrivent en **embeds** : un par carte, avec son visuel, ses annonces neuves en liens.

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
  connecter — pas même vous. La seule échappatoire est `SESSION_HTTP=1`, réservée aux réseaux déjà
  chiffrés ou de confiance (voir plus haut).

D'où un VPS — ou la tablette de la variante ci-dessous — et rien de plus exotique. `deploy/`
contient tout : sept unités systemd, un Caddyfile, un installateur, un script de déploiement, et le
lanceur de la tablette.

### Ce qui tourne sur le serveur

| Unité | Cadence | Rôle |
| --- | --- | --- |
| `pokebroc.service` | permanent | `next start` sur le port 3000, redémarré s'il tombe |
| `pokebroc-veille.timer` | `*:0/15` | balayage de fond + alertes Discord |
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

### La variante tablette

L'alternative au VPS, retenue le 1er septembre 2026 : une tablette Android (Blackview Tab 13) sur
la box, qui fait tourner **tout** — site, veille, leboncoin, Cardmarket. Son argument décisif est
son **IP résidentielle** : la question Datadome ci-dessous ne se pose plus, et le collecteur
Cardmarket — qui exige lui aussi une ligne de particulier — tourne sur la même machine que le site,
là où le VPS l'aurait laissé orphelin. Environ 5 W, branchée en permanence.

La pile : Termux (depuis **F-Droid** — la version Play Store est morte) + `proot-distro` qui loge
un vrai Debian ARM64, sans root. Dedans : Node 22, le dépôt dans `/root/PokeBroc`, un venv Python
dans `/root/venv` (`curl_cffi`, `playwright` + Chromium — Edge n'existant pas en Linux ARM64, voir
le repli plus haut). Vérifié sur la tablette le 1er septembre 2026 : Chromium se lance sous proot
avec `--no-sandbox`, et `lbc.py --dry-run` ramène ses annonces sans un 403.

proot n'a pas de systemd : `deploy/tablette/lancer.sh` rejoue les unités en un seul superviseur —
site relancé s'il tombe, veille puis leboncoin enchaînés à chaque quart d'heure (l'enchaînement
remplace le décalage de cinq minutes des minuteries), sauvegarde quotidienne vers 4 h dans
`/root/sauvegardes`, quatorze conservées, journaux dans `/root/journal`. Il exporte ce que le
`.env.local` copié du PC dit en chemins Windows (`LBC_PYTHON`, `CARDMARKET_PYTHON`), pose
`SESSION_HTTP=1` (voir plus haut : servi en HTTP local ou Tailscale, pas de HTTPS) et démarre un
Xvfb pour la fenêtre hors écran de Cardmarket. `deploy/tablette/boot.sh`, copié dans
`~/.termux/boot/`, relance le tout à chaque redémarrage d'Android via Termux:Boot — après avoir
pris le `termux-wake-lock`, sans lequel Android endort le processeur. Exempter Termux de
l'optimisation de batterie, sans quoi la surcouche tue le processus en silence.

L'accès distant passe par Tailscale (les applis Android sur la tablette et le téléphone) : pas de
port ouvert sur la box, pas de domaine, pas de certificat. Ouvrir le site à d'autres personnes
demanderait un domaine public et un tunnel — c'est documenté comme suite envisageable, pas en
place.

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

La variante tablette échappe entièrement à la question — mesuré le 1er septembre 2026 depuis l'IP
de la box, `lbc.py --dry-run` ramène ses annonces sans un refus. Le paragraphe qui suit ne
concerne que le VPS.

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
  actions/favorites.ts      ajout / retrait d'une carte de la collection
  actions/feed.ts           masquer / réafficher une annonce, « tout marquer comme vu »
  actions/discord.ts        message de test du webhook
  alertes/page.tsx          état de la veille, réglage du webhook Discord
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
  OfferTile.tsx             une annonce, en vignette (prix et écart sur la photo)
  HideButton.tsx            la croix qui écarte une annonce, commune aux quatre affichages
  HiddenNotice.tsx          ce qui a été masqué, « Annuler la dernière », « Tout réafficher »
  CardSearch.tsx            barre de recherche et aperçu clavier
  CollectionStrip.tsx       bandeau des cartes épinglées, qui filtre le fil
  VintedResults.tsx         recherche libre de la fiche carte
  PriceHistory.tsx          prix réellement observés sur Vinted
  CardThumb.tsx             visuel de carte, avec réessais et repli sur le nom
  usePersisted.ts           préférences d'affichage (useSyncExternalStore)
  useHidden.ts              annonces masquées : état optimiste, retour arrière si l'écriture échoue
  DiscordTest.tsx           bouton « message de test » du webhook
  CardmarketColumn.tsx      colonne des dernières offres Cardmarket
  AccountMenu.tsx, AuthForm.tsx, FavoriteButton.tsx, FocusSearchButton.tsx
lib/
  auth.ts                   mots de passe, jetons, session
  store.ts                  comptes, favoris, badge « nouveau », annonces masquées
  feed.ts                   instantanés du fil, collecte, fraîcheur
  lots.ts                   lots : flux récent partagé + lots par carte suivie
  sightings.ts              annonces déjà vues, statistiques de prix
  rate-limit.ts             seau à jetons en mémoire
  json-file.ts              lecture/écriture atomique, sérialisation par clé
  image-cache.ts            cache disque des visuels, préchauffage, purge
  tcgdex.ts                 cartes, extensions, images, cotes — bases française et japonaise
  card-cache.ts             copie locale des fiches, pour une veille qui survit à un catalogue muet
  japanese.ts               noms japonais ↔ français, pour chercher et noter les cartes japonaises
  bulbapedia.ts             second catalogue japonais : pages d'espèce et de carte de Bulbapedia
  pokedex-names.ts          table des espèces (ja, fr, en), générée depuis PokéAPI
  vinted.ts                 session, throttle, cache, normalisation
  lbc.ts                    lots et cartes leboncoin (aucune requête : voir collect/)
  match.ts                  notation des annonces, état, requêtes, vocabulaires éliminatoires
  format.ts                 euros, pourcentages, ancienneté
  alerts.ts                 ce qu'une alerte retient, et comment elle se lit
  discord.ts                alertes Discord : webhook, embeds, envoi
  veille.ts                 état de la veille (repère des alertes)
collect/
  lbc.py                    collecteur leboncoin — lots, puis une tranche des cartes suivies
  test_lbc.py               ses tests, sans réseau
  cardmarket.py             collecteur Cardmarket — navigateur piloté, Edge ou Chromium
  veille.ts                 balayage de fond + alertes — hors du site, sur minuterie
deploy/
  installer.sh              provisionnement d'un VPS neuf, une seule fois
  deployer.sh               ce que la CI lance sur le serveur, avec retour arrière
  sauvegarde.sh             archive .data/ chaque nuit, 14 jours glissants
  Caddyfile                 reverse proxy et HTTPS automatique
  pokebroc*.service/.timer  le site et ses trois minuteries
  tablette/
    lancer.sh               les unités rejouées sans systemd — site, collecte, mise à jour, sauvegarde
    boot.sh                 démarrage automatique via Termux:Boot
    LISEZMOI.md             dossier de bord du serveur tablette — chemins, pannes, remèdes
tests/                      node:test — match, japanese, bulbapedia, tcgdex, ebay, rate-limit, sightings,
                            format, alertes, store
                            collect/test_lbc.py — normalisation et rotation, sans réseau
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
- Les alertes Discord partent dans un seul salon (webhook), sans destinataire par personne. C'est le
  prix de la simplicité — voir plus haut pourquoi le webhook plutôt qu'un bot.
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
