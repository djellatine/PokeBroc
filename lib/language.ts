/**
 * Langue apparente d'un titre d'annonce.
 *
 * Vinted ne dit pas d'où vient une annonce : le catalogue ne renvoie ni pays,
 * ni langue, ni domaine d'origine. Le titre est le seul indice disponible, et
 * il fait dix mots — d'où une lecture par marqueurs plutôt qu'une véritable
 * détection de langue, qui n'aurait rien de plus à se mettre sous la dent.
 *
 * Deux pièges dictent les listes ci-dessous, et ce sont eux qui rendent
 * l'exercice moins évident qu'il n'en a l'air :
 *
 * 1. Le jargon du TCG est anglais partout, y compris chez les vendeurs
 *    français : « holo », « mint », « reverse », « full art », « sealed »,
 *    « graded », « booster ». Aucun de ces mots ne peut compter comme un
 *    signal étranger, sinon la moitié du fil français disparaît. Il en va de
 *    même des noms d'extensions, qui ne sont jamais traduits.
 * 2. « Pokémon » garde son accent dans toutes les langues. Le mot est retiré
 *    avant la recherche d'accents, qui sans cela feraient passer pour français
 *    à peu près tous les titres anglais.
 *
 * En cas de doute, on garde : masquer à tort une annonce française coûte plus
 * cher à l'utilisateur que laisser passer une annonce anglaise, qu'il écarte
 * d'un coup d'œil.
 */

import { normalize } from "./match";

export type TitleLanguage = "french" | "foreign" | "unknown";

/**
 * Marqueurs français. Mots grammaticaux et vocabulaire de l'annonce — pas de
 * vocabulaire de collectionneur, trop souvent anglais des deux côtés.
 */
const FRENCH_WORDS = [
  "carte",
  "cartes",
  "etat",
  "neuf",
  "neuve",
  "tres",
  "bon",
  "bonne",
  "avec",
  "sans",
  "sous",
  "pour",
  "des",
  "du",
  "les",
  "une",
  "cette",
  "francais",
  "francaise",
  "anglais",
  "anglaise",
  "japonais",
  "japonaise",
  "allemande",
  "livraison",
  "envoi",
  "vends",
  "vendu",
  "occasion",
  "numero",
  "edition",
  "brillante",
  "doree",
  "rarete",
  "echange",
  "prix",
  "lot",
  "lots",
  "classeur",
  "pochette",
  "coffret",
  "jeu",
];

/**
 * Marqueurs étrangers : anglais surtout, puis les langues qui remontent le plus
 * dans le catalogue français. Volontairement dépourvue de tout terme de TCG,
 * pour la raison exposée en tête de fichier.
 */
const FOREIGN_WORDS = [
  // anglais
  "the",
  "and",
  "with",
  "for",
  "from",
  "your",
  "this",
  "new",
  "very",
  "good",
  "condition",
  "shipping",
  "free",
  "brand",
  "cards",
  // allemand
  "karte",
  "karten",
  "sammlung",
  "zustand",
  "neu",
  "und",
  "sehr",
  "gut",
  "mit",
  // néerlandais
  "kaart",
  "kaarten",
  "nieuw",
  "staat",
  "met",
  "zeer",
  "goede",
  // espagnol, italien
  "carta",
  "cartas",
  "nuevo",
  "nueva",
  "nuovo",
  "nuova",
  "estado",
  "stato",
  "con",
  "coleccion",
  "collezione",
  "molto",
  "buono",
  "muy",
  "bueno",
  // polonais
  "karta",
  "karty",
  "nowa",
  "nowe",
  "stan",
  "kolekcja",
];

/**
 * Une seule expression par liste plutôt qu'une par mot : la détection tourne
 * sur toutes les annonces du fil à chaque changement de filtre.
 *
 * La borne de gauche consomme son séparateur, celle de droite est une simple
 * assertion — sans quoi deux marqueurs voisins ne seraient comptés qu'une fois.
 */
function matcher(words: string[]): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])(?:${words.join("|")})(?![a-z0-9])`, "g");
}

const FRENCH = matcher(FRENCH_WORDS);
const FOREIGN = matcher(FOREIGN_WORDS);

function count(pattern: RegExp, text: string): number {
  pattern.lastIndex = 0;
  let hits = 0;
  while (pattern.exec(text) !== null) hits += 1;
  return hits;
}

/** Accents que l'anglais n'a pas — le nom de la marque mis à part. */
function hasAccent(title: string): boolean {
  return /[éèêëàâäîïôöûùüç]/i.test(title.replace(/pok[ée]mon/gi, " "));
}

export function titleLanguage(title: string): TitleLanguage {
  const text = normalize(title);
  const french = count(FRENCH, text) + (hasAccent(title) ? 1 : 0);
  const foreign = count(FOREIGN, text);

  // Strictement supérieur : à égalité de marqueurs, le titre est mixte —
  // « Carte Pokémon Charizard mint condition » est écrit par un francophone.
  if (foreign > french) return "foreign";
  if (french > 0) return "french";
  return "unknown";
}

/**
 * Un titre sans aucun marqueur reste affiché : « Pikachu 58/102 » ne dit rien
 * de la langue de son vendeur, et ces titres-là sont nombreux.
 */
export function isForeignTitle(title: string): boolean {
  return titleLanguage(title) === "foreign";
}

/**
 * Provenance d'une annonce du fil.
 *
 * Tout ce qui précède n'existe que faute de mieux : eBay, lui, déclare le pays
 * de l'objet. Quand cette information est là, elle tranche — un vendeur
 * madrilène qui rédige en français reste un envoi depuis l'Espagne, et aucune
 * lecture du titre ne le dirait. La détection par marqueurs redevient ce qu'elle
 * est, un repli pour Vinted, qui ne déclare rien.
 */
export function isForeignListing(listing: { country: string | null; title: string }): boolean {
  if (listing.country) return listing.country.toUpperCase() !== "FR";
  return isForeignTitle(listing.title);
}
