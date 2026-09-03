/**
 * Ce que `lib/tcgdex.ts` décide sans réseau : l'identité d'une carte
 * japonaise et le numéro qu'on imprime pour elle.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cardNumber, isJapaneseId, JA_PREFIX } from "../lib/tcgdex.ts";
import { DRACAUFEU, NANJAMO_JA, PHYLLALI_JA, PIKACHU_JA, SANS_COTE } from "./helpers.ts";

describe("isJapaneseId", () => {
  it("reconnaît le préfixe, et rien d'autre", () => {
    assert.equal(isJapaneseId(`${JA_PREFIX}SV-P-001`), true);
    assert.equal(isJapaneseId("SV-P-001"), false);
    assert.equal(isJapaneseId("base1-4"), false);
  });
});

describe("cardNumber", () => {
  it("imprime « numéro/total » quand le total est connu, japonaise ou non", () => {
    assert.equal(cardNumber(DRACAUFEU), "4/102");
    assert.equal(cardNumber(PHYLLALI_JA), "003/187");
  });

  it("remplace le total absent d'une promo japonaise par le code de l'extension", () => {
    assert.equal(cardNumber(PIKACHU_JA), "001/SV-P");
    assert.equal(cardNumber(NANJAMO_JA), "121/SV-P");
  });

  it("garde le numéro nu pour une française sans total", () => {
    assert.equal(cardNumber(SANS_COTE), "7");
  });
});
