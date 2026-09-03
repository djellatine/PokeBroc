/** Fixtures partagées par la suite de tests. */

import type { CardDetail } from "../lib/tcgdex.ts";
import type { VintedItem } from "../lib/vinted.ts";

/** Dracaufeu du Set de Base : numéro imprimé « 4/102 », cote ronde à 100 €. */
export const DRACAUFEU: CardDetail = {
  id: "base1-4",
  localId: "4",
  name: "Dracaufeu",
  rarity: "Rare Holo",
  set: {
    id: "base1",
    name: "Set de Base",
    cardCount: { official: 102, total: 102 },
  },
  pricing: { cardmarket: { trend: 100 } },
};

/**
 * Dracaufeu Gold Star, `ex15-100`. Le nom officiel publié par TCGdex porte deux
 * symboles — l'étoile blanche (U+2606) et le delta (U+03B4) — qu'aucune annonce
 * n'emploie : les vendeurs écrivent « Dracaufeu Gold star 100/101 ».
 */
export const DRACAUFEU_STAR: CardDetail = {
  id: "ex15-100",
  localId: "100",
  name: "Dracaufeu ☆ δ",
  rarity: "Rare",
  set: {
    id: "ex15",
    name: "EX Île des Dragons",
    cardCount: { official: 101, total: 101 },
  },
  pricing: { cardmarket: { trend: 900 } },
};

/** Carte à delta seul, sans étoile : le symbole est retiré, pas traduit. */
export const EOKO_DELTA: CardDetail = {
  id: "pop4-1",
  localId: "1",
  name: "Eoko δ",
  set: { id: "pop4", name: "POP Série 4", cardCount: { official: 17, total: 17 } },
};

/** Carte sans numéro total ni cote, pour les chemins dégradés. */
export const SANS_COTE: CardDetail = {
  id: "xy1-7",
  localId: "7",
  name: "Feunard",
  set: { id: "xy1", name: "XY" },
};

let nextId = 1;

/**
 * `graded` est le seul champ étranger à Vinted admis ici : c'est la gradation
 * déclarée par la source, qu'eBay renseigne et que la notation doit préférer au
 * titre. Optionnel, donc représentatif des deux places de marché.
 */
export function makeItem(
  overrides: Partial<VintedItem> & { title: string; graded?: boolean },
): VintedItem & { graded?: boolean } {
  return {
    id: nextId++,
    url: "https://www.vinted.fr/items/1",
    photo: null,
    thumbnail: null,
    price: 50,
    totalPrice: 50,
    serviceFee: 0,
    currency: "EUR",
    brand: null,
    status: null,
    favourites: 0,
    views: 0,
    promoted: false,
    createdAt: null,
    seller: { login: null, url: null, business: false },
    ...overrides,
  };
}

/**
 * Pikachu promo japonaise, `ja:SV-P-001` — la carte que TCGdex livre en
 * japonais et que `getCard` a déjà traduite : nom français, nom anglais,
 * code de l'extension devant son nom. Pas de total officiel : les promos
 * s'impriment « 001/SV-P ».
 */
export const PIKACHU_JA: CardDetail = {
  id: "ja:SV-P-001",
  localId: "001",
  name: "Pikachu",
  nameJa: "ピカチュウ",
  nameEn: "Pikachu",
  lang: "ja",
  rarity: "Promo",
  set: {
    id: "SV-P",
    name: "SV-P · スカーレット&バイオレット プロモカード",
    cardCount: { official: 0, total: 288 },
  },
  pricing: { cardmarket: { trend: 25 } },
};

/** Phyllali ex de Terastal Festival, `ja:SV8a-003` : une extension numérotée « 003/187 ». */
export const PHYLLALI_JA: CardDetail = {
  id: "ja:SV8a-003",
  localId: "003",
  name: "Phyllali ex",
  nameJa: "リーフィアex",
  nameEn: "Leafeon ex",
  lang: "ja",
  set: {
    id: "SV8a",
    name: "SV8a · テラスタルフェスex",
    cardCount: { official: 187, total: 237 },
  },
  pricing: { cardmarket: { trend: 40 } },
};

/** Carte Dresseur japonaise, hors table des espèces : le nom reste en japonais. */
export const NANJAMO_JA: CardDetail = {
  id: "ja:SV-P-121",
  localId: "121",
  name: "ナンジャモ",
  nameJa: "ナンジャモ",
  lang: "ja",
  set: {
    id: "SV-P",
    name: "SV-P · スカーレット&バイオレット プロモカード",
    cardCount: { official: 0, total: 288 },
  },
};

/**
 * Salamèche McDonald's 2002, `jb:…`, venue de Bulbapedia : extension nommée
 * en anglais, total imprimé sur trois chiffres (« 004/018 »), pas de cote.
 */
export const SALAMECHE_MCDO_JA: CardDetail = {
  id: "jb:Charmander (McDonald Pack 4)|004/018",
  localId: "004",
  name: "Salamèche",
  nameJa: "ヒトカゲ",
  nameEn: "Charmander",
  lang: "ja",
  set: {
    id: "mcdonald-s-pokemon-e-minimum-pack",
    name: "McDonald's Pokémon-e Minimum Pack",
    cardCount: { official: 18, total: 18 },
  },
};

/** Salamèche japonaise de 1996, sans numéro de collection. */
export const SALAMECHE_1996_JA: CardDetail = {
  id: "jb:Charmander (Base Set 46)|Expansion Pack",
  localId: "",
  name: "Salamèche",
  nameEn: "Charmander",
  lang: "ja",
  set: { id: "expansion-pack", name: "Expansion Pack", cardCount: { official: 0, total: 0 } },
};
