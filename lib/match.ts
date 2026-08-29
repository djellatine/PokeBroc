/**
 * Évaluation de la pertinence d'une annonce vis-à-vis d'une carte précise.
 * Les vendeurs écrivent les titres à leur façon : on cherche des signaux
 * (nom, numéro imprimé, nom du set, gradation) plutôt qu'une correspondance stricte.
 *
 * La notation ne lit que le titre et le prix : elle vaut donc pour Vinted comme
 * pour eBay, d'où le type d'entrée structurel plutôt qu'un `VintedItem`.
 */

import type { CardDetail } from "./tcgdex";
import { cardNumber } from "./tcgdex";
import type { VintedItem } from "./vinted";

/**
 * Une annonce ne vaut d'être comparée à la cote que si elle porte bien la carte
 * visée : le nom seul (+4) ne suffit pas à distinguer deux Pikachu d'extensions
 * différentes. Le seuil élevé exige le nom **et** le numéro ou l'extension.
 */
export const STRONG_SCORE = 8;
/** Seuil bas, activé par « Élargir » : le nom, et rien de plus. */
export const WIDE_SCORE = 4;

export interface MatchSignals {
  name: boolean;
  number: boolean;
  set: boolean;
  graded: boolean;
  bulk: boolean;
  /** Reproduction annoncée comme telle (custom, proxy, orica…). */
  fake: boolean;
  /**
   * Ni une carte (peluche, protège-carte, vignette Merlin ou Topps), ni une
   * vente (annonce d'achat au prix symbolique d'un euro). Éliminatoire.
   */
  junk: boolean;
  /**
   * Le bon numéro, mais un autre dénominateur : « Salamèche 98/165 » quand on
   * cherche la 98/97. L'annonce reste visible — c'est une vraie carte, et du
   * bon Pokémon — mais elle perd son écart à la cote, qui serait celui d'une
   * autre carte.
   */
  otherPrint: boolean;
  score: number;
}

/**
 * Le minimum dont la notation a besoin. Vinted et eBay renvoient des objets très
 * différents ; seuls ces champs-là entrent dans le calcul.
 */
export interface Scorable {
  title: string;
  promoted: boolean;
  price: number | null;
  totalPrice: number | null;
  /**
   * Gradation déclarée par la source elle-même. eBay la tient de la catégorie
   * de l'annonce, ce qui vaut mieux que de chercher « psa » dans le titre :
   * une gradée dont le titre ne le dit pas passerait sinon pour une carte
   * brute, et son prix fausserait la comparaison à la cote. Absent sur Vinted,
   * qui ne renseigne rien de tel — on retombe alors sur le titre.
   */
  graded?: boolean;
}

export type Scored<T> = T & {
  match: MatchSignals;
  /** Cote Cardmarket retenue pour la comparaison, en euros. */
  trend: number | null;
  /** Écart en % avec la cote Cardmarket, négatif = moins cher. */
  vsMarket: number | null;
};

export type ScoredItem = Scored<VintedItem>;

/** Lots et contenants : le prix ne se rapporte pas à une carte unique. */
const BULK_WORDS = [
  "lot",
  "lots",
  "bundle",
  "classeur",
  "coffret",
  "display",
  "booster",
  "boosters",
  "pochette",
  "vrac",
  "collection complete",
];

const GRADED_WORDS = ["psa", "pca", "beckett", "bgs", "cgc", "gradee", "gradees", "slab", "ccc"];

/**
 * Reproductions. Elles sont nombreuses sur Vinted, souvent honnêtement
 * étiquetées, et leur prix n'a évidemment aucun rapport avec la cote — les
 * laisser passer produirait les « meilleures affaires » les plus spectaculaires
 * et les plus fausses du fil.
 */
const FAKE_WORDS = ["custom", "proxy", "orica", "fanmade", "fan made", "replique", "contrefacon"];

/**
 * Ce n'est pas une carte à jouer.
 *
 * Mesuré le 29 août 2026 sur le tri « Meilleures affaires » de la page
 * d'accueil : les quinze premières annonces étaient une peluche, une vitrine de
 * présentation vide, deux protège-cartes, quatre autocollants Merlin ou Dunkin,
 * deux vignettes Topps, et des annonces d'achat. Aucune n'était la carte
 * cherchée, et aucune ne pouvait l'être.
 *
 * Elles arrivent en tête par construction, et c'est ce qui rend le problème
 * sérieux plutôt qu'anecdotique : un objet à 3 € rapporté à la cote d'une carte
 * à 1 000 € affiche −100 %, un écart qu'aucune vraie occasion ne peut battre.
 * Le bruit ne se répartit donc pas dans la liste, il se concentre exactement là
 * où l'on regarde en premier.
 *
 * Les marques citées sont celles des vignettes et autocollants des années 1990
 * — Merlin, Panini, Amada, Topps, Dunkin — qui portent le nom du Pokémon et son
 * numéro de série, d'où la confusion avec une carte à jouer.
 */
const NOT_A_CARD = [
  "peluche",
  "figurine",
  "porte cle",
  "porte cles",
  "mug",
  "sticker",
  "stickers",
  "autocollant",
  "autocollants",
  "vignette",
  "vignettes",
  "merlin",
  "panini",
  "amada",
  "topps",
  "dunkin",
  "boomer",
  "protege carte",
  "protege cartes",
  "protection illustree",
  "toploader",
  "sleeve",
  "sleeves",
  "vitrine",
];

/**
 * Ce n'est pas une vente.
 *
 * Quelqu'un qui *cherche* la carte publie une annonce au prix symbolique d'un
 * euro : rapportée à une cote de 2 479 €, elle s'affiche −100 % et coiffe tout
 * le classement. Le vocabulaire est étroit à dessein — `recherche` et non
 * `recherchee`, que `normalize` laisse distincts, sans quoi « carte très
 * recherchée » tomberait avec.
 */
const WANT_AD = ["recherche", "recherches", "echange", "echanges", "achete", "achat"];

/**
 * Le trait d'union devient une espace, il n'est pas effac\u00e9.
 *
 * Depuis \u00c9carlate & Violet, la carte fran\u00e7aise s'imprime \u00ab Latias-ex \u00bb \u2014 c'est
 * le nom officiel, celui que publie TCGdex. Aucun vendeur ne l'\u00e9crit ainsi :
 * les annonces, et jusqu'aux revendeurs sp\u00e9cialis\u00e9s, disent \u00ab Latias ex \u00bb. Le
 * signal \u00ab nom \u00bb \u00e9chouait donc sur ce seul caract\u00e8re, faisant tomber la note de
 * 11 \u00e0 7 \u2014 sous le seuil strict, donc un fil vide par d\u00e9faut sur environ 15 %
 * des cartes des extensions r\u00e9centes, et pr\u00e9cis\u00e9ment les plus ch\u00e8res.
 *
 * L'effacer ne suffirait pas : \u00ab latiasex \u00bb ne se retrouve pas davantage dans
 * \u00ab latias ex \u00bb. Il faut que les deux graphies convergent, donc une espace. Les
 * tirets longs sont inclus parce que les titres d'annonces en sont friands.
 */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-\u2010\u2011\u2012\u2013\u2014]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Symboles que TCGdex imprime dans le nom, et qu'aucune annonce n'emploie.
 *
 * Le nom officiel de la carte `ex15-100` est « Dracaufeu ☆ δ ». Personne
 * n'écrit cela : les vendeurs disent « Dracaufeu Gold star 100/101 ». Le
 * symbole cassait donc les deux bouts de la chaîne à la fois — la requête
 * envoyée aux catalogues, et la reconnaissance du nom dans les titres reçus.
 *
 * Chaque règle est mesurée sur le catalogue Vinted, pas supposée :
 *
 * | Requête | Nom reconnu | Fortes |
 * | --- | --- | --- |
 * | `Dracaufeu ☆ δ 100/101` | 0 | 0 |
 * | `Dracaufeu gold star 100/101` | 5 | 3 |
 * | `Dracaufeu gold star delta 100/101` | 0 | 0 |
 * | `Eoko 1/17` | 4 | 3 |
 * | `Eoko delta 1/17` | 0 | 0 |
 *
 * D'où le sort réservé au delta : il est **retiré**, pas traduit. Les vendeurs
 * ne le mentionnent pas, et l'ajouter à la requête la fait dériver vers des
 * objets qui n'ont de la carte que le nom — jusqu'à des gravures sur bois. Le
 * numéro imprimé, lui, suffit à désigner la carte sans ambiguïté.
 *
 * L'étoile et le losange sont au contraire traduits : « gold star » et « prism
 * star » sont les noms sous lesquels ces cartes se vendent réellement.
 */
const NAME_SYMBOLS: { pattern: RegExp; replacement: string }[] = [
  // ★ U+2605, ☆ U+2606
  { pattern: /[★☆]/g, replacement: " gold star " },
  // ◇ U+25C7
  { pattern: /◇/g, replacement: " prism star " },
  // δ U+03B4 — voir ci-dessus.
  { pattern: /δ/g, replacement: " " },
  // ’ U+2019 : les vendeurs tapent l'apostrophe droite de leur clavier.
  { pattern: /’/g, replacement: "'" },
  // Traits d'union et tirets longs. Depuis Écarlate & Violet, la carte
  // s'imprime « Latias-ex » — le nom officiel, celui que publie TCGdex. Aucun
  // vendeur ne l'écrit ainsi. L'effacer ne suffirait pas : « latiasex » ne se
  // retrouve pas davantage dans « latias ex ». Il faut une espace.
  { pattern: /[-‐‑‒–—]+/g, replacement: " " },
];

/**
 * Nom tel qu'on le cherche, par opposition au nom tel qu'il est imprimé.
 *
 * Sert aux deux extrémités : composer la requête envoyée aux catalogues, et
 * reconnaître le nom dans les titres qui en reviennent. Les deux doivent parler
 * la même langue, faute de quoi on chercherait une graphie pour en attendre une
 * autre — c'est exactement ce qui se passait sur les cartes à étoile, trouvées
 * par leur numéro puis recalées faute de nom reconnu.
 */
export function searchName(card: CardDetail): string {
  let name = card.name;
  for (const { pattern, replacement } of NAME_SYMBOLS) {
    name = name.replace(pattern, replacement);
  }
  return name.replace(/\s+/g, " ").trim();
}

/**
 * Présence d'un mot entier.
 *
 * La recherche par sous-chaîne se trompait dans les deux sens : « lot » ne
 * trouvait pas un titre finissant par « … en lot », et « psa » se déclenchait
 * sur « psaume ». Les bornes sont posées à la main plutôt qu'avec `\b`, qui
 * traite le chiffre et la lettre de la même façon.
 */
function hasWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(haystack);
}

function hasAny(haystack: string, words: string[]): boolean {
  return words.some((word) => hasWord(haystack, word));
}

/** Le nom d'un set contient souvent des mots trop génériques pour servir de signal. */
function setKeywords(setName: string): string[] {
  const stop = new Set([
    "et",
    "de",
    "du",
    "des",
    "la",
    "le",
    "les",
    "&",
    "ex",
    "gx",
    "set",
    "collection",
    "pokemon",
  ]);
  return normalize(setName)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !stop.has(word));
}

export function scoreItem<T extends Scorable>(item: T, card: CardDetail): Scored<T> {
  const title = normalize(item.title);
  // `searchName` et non `card.name` : c'est la graphie des annonces qu'on
  // cherche dans un titre d'annonce. Comparer le nom officiel reviendrait à
  // chercher « dracaufeu ☆ δ » dans « Dracaufeu Gold star 100/101 ».
  const cardName = normalize(searchName(card));
  const total = card.set?.cardCount?.official;

  const name = cardName.length > 2 && title.includes(cardName);

  // "4/102", "4 / 102", "#4", ou le numéro isolé entre séparateurs.
  const local = card.localId?.replace(/[^a-z0-9]/gi, "");
  let number = false;
  if (local) {
    const patterns = [
      // L'espace est admise comme séparateur : `normalize` vient d'y ramener les
      // traits d'union, et « 4-102 » doit continuer de valoir « 4/102 ».
      total ? new RegExp(`\\b${local}\\s*[/\\s-]\\s*${total}\\b`, "i") : null,
      new RegExp(`(?:^|[\\s(\\[#])n?[°o]?\\s*${local}(?:$|[\\s)\\]/,.-])`, "i"),
    ].filter(Boolean) as RegExp[];
    number = patterns.some((re) => re.test(title));
  }

  const keywords = card.set?.name ? setKeywords(card.set.name) : [];
  const set = keywords.length > 0 && keywords.some((word) => title.includes(word));

  // La source prime sur le titre quand elle sait : `?? ` et non `||`, pour
  // qu'un `false` déclaré par eBay ne soit pas réécrit par un « psa » du titre.
  const graded = item.graded ?? hasAny(title, GRADED_WORDS);
  const bulk = hasAny(title, BULK_WORDS);
  const fake = hasAny(title, FAKE_WORDS);

  // Ni une carte, ni une vente : rien à comparer, et rien à découvrir non plus.
  const junk = hasAny(title, NOT_A_CARD) || hasAny(title, WANT_AD);

  /**
   * Le titre porte le bon numéro, mais suivi d'un *autre* dénominateur :
   * « Ectoplasma 94/165 » quand on cherche la 94/102. C'est une vraie carte, du
   * bon Pokémon, mais pas celle-ci — le `165` le dit explicitement.
   *
   * On ne l'écarte pas : tomber sur une autre impression de son Pokémon est un
   * hasard qui vaut d'être vu, et c'est à quoi sert un fil. On lui retire en
   * revanche son écart à la cote, qui serait celui d'une autre carte. Même
   * traitement que l'enchère eBay en cours, et pour la même raison : mieux vaut
   * un écart vide qu'un écart faux, et le lecteur juge.
   */
  // Les deux décomptes que publie TCGdex : « 102 » pour les cartes numérotées de
  // la série, « 103 » en comptant les secrètes. Les vendeurs emploient l'un ou
  // l'autre, et n'en retenir qu'un ferait passer la moitié des annonces
  // légitimes pour une autre impression.
  const counts = [total, card.set?.cardCount?.total].filter(
    (value): value is number => typeof value === "number",
  );

  let otherPrint = false;
  if (local && counts.length > 0) {
    // `String.raw` plutôt que des antislashs doublés : dans un littéral gabarit
    // ordinaire, `\b` est le caractère retour arrière et `\d` un simple « d ».
    // Le motif compilait donc sans erreur et ne reconnaissait jamais rien.
    const printed = new RegExp(String.raw`\b${local}\s*[/\s-]\s*(\d+)\b`).exec(title);
    if (printed && !counts.includes(Number(printed[1]))) otherPrint = true;
  }

  let score = 0;
  if (name) score += 4;
  if (number) score += 4;
  if (set) score += 3;
  if (bulk) score -= 2;
  if (item.promoted) score -= 1;
  // Assez lourd pour faire passer une reproduction sous le seuil strict, même
  // quand son titre cite scrupuleusement le nom, le numéro et l'extension.
  if (fake) score -= 8;
  // Le maximum atteignable étant 11, la même pénalité passe sous `WIDE_SCORE` :
  // l'annonce ne survit pas à la collecte, elle n'est donc même pas archivée.
  if (junk) score -= 8;

  const trend = card.pricing?.cardmarket?.trend ?? card.pricing?.cardmarket?.avg30 ?? null;
  const price = item.totalPrice ?? item.price;
  const vsMarket =
    trend && trend > 0 && price !== null && !otherPrint
      ? Math.round(((price - trend) / trend) * 100)
      : null;

  return {
    ...item,
    match: { name, number, set, graded, bulk, fake, junk, otherPrint, score },
    trend,
    vsMarket,
  };
}

export function scoreAll<T extends Scorable>(items: T[], card: CardDetail): Scored<T>[] {
  return items.map((item) => scoreItem(item, card));
}

/* ------------------------------------------------------------------- lots */

/**
 * Notation d'un lot, à l'envers de celle d'une carte à l'unité.
 *
 * `scoreItem` retire deux points au mot « lot » : le prix ne se rapporte pas à
 * une carte, donc l'écart à la cote serait faux. Ici c'est l'inverse — un lot
 * est ce qu'on cherche, et une annonce à l'unité n'a rien à faire dans la
 * section. Le signal devient donc éliminatoire plutôt que pénalisant.
 */
const LOT_SIGNAL = 3;

/**
 * Seuil de rétention. Vaut `LOT_SIGNAL` plus le plus faible des signaux de
 * carte, ce qui se lit : « c'est bien un lot, **et** quelque chose le rattache
 * à la carte suivie ». Un lot qui ne cite ni le nom, ni le numéro, ni
 * l'extension tombe à 3 et sort — sans quoi la section afficherait le même
 * vrac générique pour toutes les cartes de la collection.
 */
export const LOT_SCORE = 6;

/**
 * Quantité annoncée dans le titre, quand il en donne une.
 *
 * C'est le seul chiffre qui rende deux lots comparables : « 45 € » ne dit rien,
 * « 45 € pour 300 cartes » dit tout. Rendue `null` plutôt que devinée quand le
 * titre reste muet — un prix par carte inventé serait pire que pas de prix.
 */
export function lotSize(title: string): number | null {
  // Les numéros imprimés partent d'abord : « Dracaufeu 4/102 » livrerait
  // sinon un lot de 102 cartes, et le prix par carte qui va avec.
  const cleaned = normalize(title).replace(/\d+\s*\/\s*\d+/g, " ");

  const patterns = [
    // « 200 cartes », « 200 cartes pokemon ». D'abord, car c'est la forme la
    // plus explicite : le nombre y est collé à ce qu'il compte.
    //
    // La borne de gauche n'est pas décorative. Sans elle, la référence interne
    // d'un vendeur suffit à tout fausser : « B1090 Carte Pokemon […] Vente en
    // vrac 100 cartes » livrait un lot de **1090** cartes, le moteur ayant
    // attrapé les chiffres de `B1090` suivis de « Carte » avant d'arriver au
    // vrai décompte. Le prix par carte affiché s'en trouvait divisé par dix.
    /(?:^|[^a-z0-9])(\d{1,4})\s*cartes?\b/,
    // « lot de 200 », sans que « cartes » suive.
    /\blots?\s+de\s+(\d{1,4})\b/,
    // « lot x200 », « x 200 ».
    /\bx\s*(\d{1,4})\b/,
  ];

  for (const pattern of patterns) {
    const found = cleaned.match(pattern);
    if (!found) continue;
    const size = Number.parseInt(found[1], 10);
    // Un lot d'une carte n'est pas un lot ; au-delà de quelques milliers, le
    // nombre lu est une année ou une référence, pas un contenu.
    if (size >= 2 && size <= 5000) return size;
  }

  return null;
}

/**
 * Note une annonce en tant que lot. Les signaux sont ceux de `scoreItem` — le
 * travail d'analyse du titre ne change pas — seule leur pondération diffère.
 */
export function scoreLot<T extends Scorable>(item: T, card: CardDetail): Scored<T> {
  const scored = scoreItem(item, card);
  const { name, number, set, bulk, fake } = scored.match;

  /**
   * La reproduction est éliminatoire ici, là où `scoreItem` se contente de
   * retirer huit points. Ce n'est pas une sévérité gratuite : un lot cumule un
   * signal de plus qu'une carte à l'unité — le sien s'ajoute au nom, au numéro
   * et à l'extension — et culmine donc à 14 au lieu de 11. Le même retrait de
   * huit points laisse « lot de 10 cartes custom Dracaufeu 4/102 Set de Base »
   * exactement à 6, soit le seuil, donc retenu.
   */
  let score = 0;
  if (bulk && !fake) {
    score = LOT_SIGNAL;
    if (name) score += 4;
    if (number) score += 4;
    if (set) score += 3;
    if (item.promoted) score -= 1;
  }

  return { ...scored, match: { ...scored.match, score } };
}

export function scoreLots<T extends Scorable>(items: T[], card: CardDetail): Scored<T>[] {
  return items.map((item) => scoreLot(item, card));
}

/**
 * Un lot de cartes Pokémon, jugé sur son seul titre.
 *
 * Tout le reste du fichier note une annonce **par rapport à une carte** : le
 * nom, le numéro, l'extension. Le flux des lots récents n'a pas de carte de
 * référence — c'est précisément son intérêt, on ne sait pas encore ce qu'il y a
 * dedans. Il faut donc trancher sur le titre nu.
 *
 * L'ancrage Pokémon n'est pas une précaution théorique : interrogé avec « lot
 * cartes pokemon », le catalogue Vinted rend un maillot de football et un
 * pantalon dans ses cinq premiers résultats. La recherche est floue, et sans ce
 * garde-fou le flux serait à moitié composé de vêtements.
 */
export function isPokemonLot(title: string): boolean {
  const text = normalize(title);
  // `normalize` a déjà retiré l'accent : « Pokémon » et « pokemon » convergent.
  if (!hasWord(text, "pokemon")) return false;
  if (!hasAny(text, BULK_WORDS)) return false;
  // Un lot de reproductions n'est jamais une affaire, quel que soit son prix.
  if (hasAny(text, FAKE_WORDS)) return false;
  return !hasAny(text, CODE_WORDS);
}

/**
 * Cartes-code : les jetons de recharge du jeu en ligne, distribués dans les
 * boosters et sans aucune valeur pour un collectionneur.
 *
 * Elles se vendent par centaines pour quelques euros, ce qui les place
 * mécaniquement en tête de tout classement au prix par carte — mesuré sur le
 * flux réel : « Lot 270 Cartes Code Pokémon » à 0,03 €/carte, premier de la
 * liste devant 451 vraies cartes à 0,06 €. Les garder reviendrait à faire de
 * l'onglet une vitrine de ce qu'on ne cherche pas.
 */
const CODE_WORDS = ["code", "codes"];

/* ------------------------------------------------------------------- état */

export type Condition = "neuf" | "excellent" | "bon" | "correct" | null;

/**
 * L'état déclaré est un déterminant de prix au moins aussi fort que l'extension,
 * et Vinted le fournit dans la réponse du catalogue. Les libellés varient selon
 * la locale ; on les ramène à quatre niveaux comparables.
 */
export function condition(status: string | null | undefined): Condition {
  if (!status) return null;
  const value = normalize(status);
  if (value.includes("neuf")) return "neuf";
  if (value.includes("tres bon") || value.includes("excellent")) return "excellent";
  if (value.includes("bon")) return "bon";
  if (value.includes("satisfaisant") || value.includes("correct")) return "correct";
  return null;
}

export const CONDITION_LABELS: Record<NonNullable<Condition>, string> = {
  neuf: "Neuf",
  excellent: "Très bon",
  bon: "Bon",
  correct: "Correct",
};

/* ---------------------------------------------------------------- requêtes */

/**
 * Requête la plus discriminante pour retrouver *cette* carte.
 *
 * La recherche Vinted est floue : « Dracaufeu 4/102 » et « Dracaufeu » renvoient
 * le même millier d'annonces. Son *classement*, lui, change beaucoup — et seule
 * la première page est lue. Mesuré sur la carte base1-4 : « Dracaufeu 4/102 »
 * remonte 29 correspondances fortes en page 1, « Dracaufeu carte pokemon » aucune.
 */
export function bestQuery(card: CardDetail): string {
  const name = searchName(card);
  const printed = cardNumber(card);
  if (printed?.includes("/")) return `${name} ${printed}`;
  if (card.localId) return `${name} ${card.localId}`;
  if (card.set?.name) return `${name} ${card.set.name}`;
  return `${name} carte pokemon`;
}

/**
 * Requêtes destinées à faire remonter des lots.
 *
 * `bestQuery` ne les trouve pas, et ce n'est pas un défaut : elle cherche
 * « Dracaufeu 4/102 », quand un lot s'annonce « lot de 200 cartes Pokémon ».
 * Les deux titres n'ont aucun mot en commun hormis le nom, que les gros lots
 * ne citent justement pas. Il faut donc interroger les catalogues autrement,
 * en partant du mot « lot » plutôt que de la carte.
 */
export function lotQueries(card: CardDetail): string[] {
  const queries = [`lot ${searchName(card)}`];

  // L'extension ouvre sur les lots qui ne nomment aucune carte — « lot Base
  // Set », « lot Écarlate et Violet ». Ce sont les plus volumineux, et les
  // seuls que la requête par nom ne peut pas atteindre.
  if (card.set?.name) queries.push(`lot cartes ${card.set.name}`);

  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = normalize(query);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Requêtes proposées à l'utilisateur, de la plus large à la plus ciblée. */
export function suggestedQueries(card: CardDetail): { label: string; query: string }[] {
  const out: { label: string; query: string }[] = [];
  const printed = cardNumber(card);
  const name = searchName(card);

  out.push({ label: "Nom seul", query: `${name} carte pokemon` });
  if (card.localId) {
    out.push({ label: `Nom + n°${card.localId}`, query: `${name} ${card.localId}` });
  }
  if (printed && printed.includes("/")) {
    out.push({ label: `Nom + ${printed}`, query: `${name} ${printed}` });
  }
  if (card.set?.name) {
    out.push({ label: "Nom + extension", query: `${name} ${card.set.name}` });
  }
  if (card.rarity && /rare|secret|ultra|arc|holo/i.test(card.rarity)) {
    out.push({ label: `Nom + ${card.rarity}`, query: `${name} ${card.rarity}` });
  }

  const seen = new Set<string>();
  return out.filter((entry) => {
    const key = normalize(entry.query);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
