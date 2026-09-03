/**
 * La cote française de `lib/cardmarket.ts` : ce qu'on tire des offres relevées,
 * sans disque ni navigateur.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { frenchQuote, type CardmarketOffer } from "../lib/cardmarket.ts";

function offer(price: number | null, condition: string | null): CardmarketOffer {
  return {
    idArticle: String(Math.random()),
    price,
    url: "https://www.cardmarket.com/fr/Pokemon/Products/Singles/x",
    condition,
    country: "France",
    seller: null,
    firstSeen: 0,
  };
}

describe("frenchQuote", () => {
  it("prend la médiane des trois offres les moins chères en bel état", () => {
    const offers = [offer(230, "EX"), offer(260, "NM"), offer(240, "NM"), offer(500, "MT")];
    assert.equal(frenchQuote(offers), 240);
  });

  it("ignore les états abîmés, même moins chers", () => {
    const offers = [offer(1.35, "PO"), offer(1.5, "PL"), offer(20, "GD"), offer(45, "EX"), offer(50, "NM"), offer(52, "EX")];
    assert.equal(frenchQuote(offers), 50);
  });

  it("ne rend rien faute de trois offres : une seule peut être une erreur", () => {
    assert.equal(frenchQuote([offer(230, "EX"), offer(240, "NM")]), null);
    assert.equal(frenchQuote([]), null);
  });

  it("écarte les offres sans prix ou sans état", () => {
    const offers = [offer(null, "NM"), offer(10, null), offer(20, "NM"), offer(21, "NM"), offer(22, "EX")];
    assert.equal(frenchQuote(offers), 21);
  });
});
