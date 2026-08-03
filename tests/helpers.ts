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
