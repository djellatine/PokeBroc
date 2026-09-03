# Journal de bord

Ce qui a été fait, séance par séance, avec le *où* et le *comment* — le
*pourquoi* détaillé est dans le README. À lire en premier pour reprendre le fil
après une pause ; le dossier de bord de la tablette, lui, est dans
`deploy/tablette/LISEZMOI.md`.

## 3 septembre 2026 — cartes japonaises, alertes perdues, tablette autonome

En une phrase : le site suit désormais les cartes japonaises (promos McDo
comprises), trois trappes qui perdaient des alertes sont bouchées, et la
tablette se met à jour toute seule dès qu'on pousse sur `main`.

### Cartes japonaises

- **Bouton « JP »** à droite du champ de recherche. On tape le nom français (ou
  anglais) ; le serveur traduit en katakanas et interroge deux catalogues :
  - **TCGdex, base `ja`** — identifiants `ja:SV-P-001`. A la cote Cardmarket,
    mais 30 % des visuels et un tiers des cartes seulement (18 Salamèche sur
    46), rien avant 1999, aucune promo d'enseigne.
  - **Bulbapedia** — identifiants `jb:Charmander (McDonald Pack 4)|004/018`.
    Complet (57 Salamèche), visuels, pas de cote. Lu depuis les pages
    « {Espèce} (TCG) » et les pages de carte, via l'API MediaWiki, quatre
    requêtes à la fois au plus.
  - Fusion dans `searchJapanese` (`lib/tcgdex.ts`) : TCGdex d'abord, Bulbapedia
    pour ce qui manque, dédoublonnage par numéro imprimé (`printedKey`).
- **Traduction des noms** : `lib/japanese.ts` + table `lib/pokedex-names.ts`
  (1025 espèces, ja/fr/en, tirée de PokéAPI). Les Dresseurs restent en
  japonais et se cherchent en tapant leur nom japonais.
- **Notation** (`lib/match.ts`) : le numéro se lit avec le code de l'extension
  (« 001/SV-P », « SV-P 001 », « 020/M-P » pour les McDo), le total sur autant
  de chiffres que le numéro (« 004/018 »), la langue déclarée vaut +2, une autre
  langue déclarée (chinois…) retire 4 points et efface l'écart à la cote. Les
  cartes d'avant 2008 n'ont pas de numéro : requête par le nom + « carte
  pokemon japonaise ». « McDonald's » vaut aussi « McDo », « MacDo ».
- **Visuels, quatre sources en cascade** (`cardImage`, `lib/tcgdex.ts`) :
  TCGdex → TCGplayer (par identifiant produit) → Cardmarket (identifiant
  produit + code d'extension, casse sondée en `HEAD`, `Referer` obligatoire)
  → archives Bulbagarden (`Special:FilePath`, `User-Agent` obligatoire). Le
  proxy `/api/carte-image` relaie ces hôtes et met en cache sur disque.
- **Ce qui ne marche pas encore** : pas de cote pour les cartes Bulbapedia ;
  pas de surveillance Cardmarket sur une japonaise (bouton CM masqué) ; les
  miniatures Cardmarket n'apparaissent pas dans les embeds Discord (pas de
  Referer côté Discord).

### Alertes perdues — trois trappes, et une confusion

1. **Rafale** : un seul message Discord partait, plafonné à 25 annonces ; le
   reste était compté puis marqué comme annoncé. `buildMessages`
   (`lib/discord.ts`) poste désormais autant de messages qu'il faut, jusqu'à
   huit.
2. **Nom sans homonyme** : une Gold Star nommée sans numéro restait à 7,
   jamais annoncée. Le nom vaut le numéro sur ces cartes (`unique` dans
   `MatchSignals`).
3. **Catalogue muet** — la plus large. Journal de la tablette du 2 au 3
   septembre : « 47 cartes balayées, 0 alerte envoyée — 48 erreurs : Carte
   introuvable dans la base TCGdex » à presque chaque passage, alors que TCGdex
   répondait à la main. Rien ne gardait les fiches ; hors de Next, `fetch` n'a
   pas de cache ; et sans délai sur les requêtes, des passages étaient tués à
   3 min sans rien écrire. Corrigé par `lib/card-cache.ts` (copie des fiches
   dans `.data/cards/`, six heures, reprise même périmée en cas de panne),
   `fetchCardDetail` (404 ≠ panne), et des `AbortSignal.timeout` partout.
   Premier passage après correction : **47 cartes balayées, 40 alertes
   envoyées (227 s)** — le retard de la journée.
4. **La confusion** : le serveur de développement sur le PC découvre des
   annonces (pastille « nouveau ») mais seule la veille alerte, et elle ne
   tourne que sur la tablette. Regarder `localhost:3000` sur le PC ne dit rien
   des alertes.

### Tablette — accès et mise à jour automatique

- **SSH par Tailscale** : `ssh -p 8022 -i ~/.ssh/id_ed25519_tablette
  u0_a165@100.80.154.77`. Serveur côté Termux, clé seulement, relancé par
  `boot.sh` et le bouton PokeBroc. Détails et pièges dans le LISEZMOI (dont :
  l'horloge de la tablette est en UTC ; un processus lancé par SSH dans le
  Debian meurt avec la session, passer par `setsid nohup` côté Termux).
- **Mise à jour automatique** (`mettre_a_jour` dans `lancer.sh`) : à la fin de
  chaque quart d'heure, `git fetch` ; si `origin/main` a bougé, avance rapide,
  puis selon les fichiers : `next build` dans `.next-nouveau` (via `distDir`,
  `next.config.ts`) pendant que l'ancien site sert, bascule par deux
  renommages, retour arrière si le site ne répond pas ; `npm ci` si le lock a
  changé ; `pip install` si `requirements.txt` a changé ; relance du lanceur
  s'il a lui-même changé (il s'exécute depuis une copie, `git pull` ne lui
  réécrit pas le script sous les pieds). `tsconfig.json` et
  `package-lock.json` sont remis d'équerre avant de tirer.
- **Mesuré** : première mise à jour automatique à 19:32 UTC, `98efc80 →
  05328e1`, construction en 80 s, site en ligne. Le build sur la tablette prend
  une à deux minutes, pas trente.
- **Circuit désormais** : modifier sur le PC → `livrer` (tests, tsc, lint,
  build, commit, push) → la tablette suit dans le quart d'heure.

### Commits de la journée

| Commit | Quoi |
| --- | --- |
| `66a05af` | cartes japonaises : recherche, notation, alertes |
| `d0cfdf7` | visuels japonais depuis TCGplayer |
| `6f7ad3d` | visuels japonais depuis Cardmarket en second repli |
| `3437fbb` | Bulbapedia comme second catalogue japonais |
| `7d45f2a` | rafales citées en entier, Gold Star sans numéro annoncées |
| `3ba61d0` | veille robuste à un catalogue muet, mise à jour automatique de la tablette, SSH |
| `98efc80` | tsconfig.json remis d'équerre après un build dans `.next-nouveau` |
| `05328e1` | identifiant Bulbapedia plus coupé sur sa barre (recherche, tableau de bord) |

### Tablette — Cardmarket, enfin

- Le collecteur Cardmarket n'avait **jamais** réussi un passage sur la tablette
  (« 5 ennuis » à chaque quart d'heure depuis le 1er septembre) : le défi
  Cloudflare, à lever dans une fenêtre que personne ne voyait.
- En chemin, **Android 12 tuait les processus** de Termux au-delà de 32 :
  `sshd` et le Chromium y sont passés. Réglé par ADB, en USB (voir LISEZMOI).
- Le défi a été levé **depuis le PC**, par VNC sur l'écran virtuel de la
  tablette : `deploy/tablette/ecran.py` capture l'écran et clique. La fenêtre du
  navigateur s'ouvrait hors écran (position retenue des passages invisibles) :
  corrigé dans `cardmarket.py`. Une fois la case cochée, les pages Cardmarket
  se chargent sans défi et le collecteur relève les offres.
- **Mesuré** : passage visible d'amorçage, 4 cartes sur 5 et 69 offres ; passage
  automatique invisible suivant (23:01), **5 cartes, 100 offres, aucun défi** en
  115 s. Le bandeau « IP surchauffée » est tombé avec lui.

### Ce qu'il reste à faire au quotidien : rien

Tant que la tablette est allumée, tout tourne seul et le PC y a accès par SSH.
Après un redémarrage : Tailscale connecté, puis bouton PokeBroc (il relance
aussi `sshd`). Les cartes s'épinglent sur le site de la tablette, pas sur un
serveur local du PC — trois cartes japonaises épinglées sur le PC ce soir ont
été recopiées à la main dans le compte de la tablette.

### Reste à faire, ou à surveiller

- **Collecteur Cardmarket sur la tablette** : amorcé le 3 septembre au soir ;
  surveiller `collect.log` — si les « ennuis » reviennent, le laissez-passer a
  expiré, refaire la procédure VNC du LISEZMOI (dix minutes).
- **Cote des cartes Bulbapedia** : Cardmarket vend tout, mais derrière
  Cloudflare — passerait par le navigateur piloté, comme les offres.
- **Veille en 227 s** au premier passage : à observer, le garde-fou est à
  600 s. Si les passages restent longs, réduire les délais par requête.
- **Serveur de développement sur le PC** : à arrêter quand on ne teste pas, il
  écrit dans le `.data/` local (copie figée depuis le 1er septembre) et
  interroge Vinted depuis la box en plus de la tablette.
- Aucun test sur `lib/card-cache.ts` (écrit dans `.data/`) ; vérifié en
  conditions réelles sur la tablette seulement.
