/**
 * Évaluation de la pertinence d'une annonce Vinted vis-à-vis d'une carte précise.
 * Les vendeurs écrivent les titres à leur façon : on cherche des signaux
 * (nom, numéro imprimé, nom du set, gradation) plutôt qu'une correspondance stricte.
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
  score: number;
}

export interface ScoredItem extends VintedItem {
  match: MatchSignals;
  /** Cote Cardmarket retenue pour la comparaison, en euros. */
  trend: number | null;
  /** Écart en % avec la cote Cardmarket, négatif = moins cher. */
  vsMarket: number | null;
}

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

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

export function scoreItem(item: VintedItem, card: CardDetail): ScoredItem {
  const title = normalize(item.title);
  const cardName = normalize(card.name);
  const total = card.set?.cardCount?.official;

  const name = cardName.length > 2 && title.includes(cardName);

  // "4/102", "4 / 102", "#4", ou le numéro isolé entre séparateurs.
  const local = card.localId?.replace(/[^a-z0-9]/gi, "");
  let number = false;
  if (local) {
    const patterns = [
      total ? new RegExp(`\\b${local}\\s*[/-]\\s*${total}\\b`, "i") : null,
      new RegExp(`(?:^|[\\s(\\[#])n?[°o]?\\s*${local}(?:$|[\\s)\\]/,.-])`, "i"),
    ].filter(Boolean) as RegExp[];
    number = patterns.some((re) => re.test(title));
  }

  const keywords = card.set?.name ? setKeywords(card.set.name) : [];
  const set = keywords.length > 0 && keywords.some((word) => title.includes(word));

  const graded = hasAny(title, GRADED_WORDS);
  const bulk = hasAny(title, BULK_WORDS);
  const fake = hasAny(title, FAKE_WORDS);

  let score = 0;
  if (name) score += 4;
  if (number) score += 4;
  if (set) score += 3;
  if (bulk) score -= 2;
  if (item.promoted) score -= 1;
  // Assez lourd pour faire passer une reproduction sous le seuil strict, même
  // quand son titre cite scrupuleusement le nom, le numéro et l'extension.
  if (fake) score -= 8;

  const trend = card.pricing?.cardmarket?.trend ?? card.pricing?.cardmarket?.avg30 ?? null;
  const price = item.totalPrice ?? item.price;
  const vsMarket =
    trend && trend > 0 && price !== null ? Math.round(((price - trend) / trend) * 100) : null;

  return { ...item, match: { name, number, set, graded, bulk, fake, score }, trend, vsMarket };
}

export function scoreAll(items: VintedItem[], card: CardDetail): ScoredItem[] {
  return items.map((item) => scoreItem(item, card));
}

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
  const printed = cardNumber(card);
  if (printed?.includes("/")) return `${card.name} ${printed}`;
  if (card.localId) return `${card.name} ${card.localId}`;
  if (card.set?.name) return `${card.name} ${card.set.name}`;
  return `${card.name} carte pokemon`;
}

/** Requêtes proposées à l'utilisateur, de la plus large à la plus ciblée. */
export function suggestedQueries(card: CardDetail): { label: string; query: string }[] {
  const out: { label: string; query: string }[] = [];
  const printed = cardNumber(card);

  out.push({ label: "Nom seul", query: `${card.name} carte pokemon` });
  if (card.localId) {
    out.push({ label: `Nom + n°${card.localId}`, query: `${card.name} ${card.localId}` });
  }
  if (printed && printed.includes("/")) {
    out.push({ label: `Nom + ${printed}`, query: `${card.name} ${printed}` });
  }
  if (card.set?.name) {
    out.push({ label: "Nom + extension", query: `${card.name} ${card.set.name}` });
  }
  if (card.rarity && /rare|secret|ultra|arc|holo/i.test(card.rarity)) {
    out.push({ label: `Nom + ${card.rarity}`, query: `${card.name} ${card.rarity}` });
  }

  const seen = new Set<string>();
  return out.filter((entry) => {
    const key = normalize(entry.query);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
