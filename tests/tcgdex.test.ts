/**
 * Ce que `lib/tcgdex.ts` décide sans réseau : l'identité d'une carte
 * japonaise et le numéro qu'on imprime pour elle.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cardImage,
  cardNumber,
  fallbackImage,
  isJapaneseId,
  JA_PREFIX,
  TCGPLAYER_PREFIX,
} from "../lib/tcgdex.ts";
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

describe("cardImage — repli TCGplayer", () => {
  it("construit une URL TCGdex quand la base est une base TCGdex", () => {
    assert.equal(
      cardImage("https://assets.tcgdex.net/ja/SV/SV8a/001", "low"),
      "https://assets.tcgdex.net/ja/SV/SV8a/001/low.webp",
    );
  });

  it("lit un identifiant TCGplayer, en deux tailles", () => {
    assert.equal(
      cardImage(`${TCGPLAYER_PREFIX}587758`, "low"),
      "https://product-images.tcgplayer.com/fit-in/437x437/587758.jpg",
    );
    assert.equal(
      cardImage(`${TCGPLAYER_PREFIX}587758`, "high"),
      "https://tcgplayer-cdn.tcgplayer.com/product/587758_in_1000x1000.jpg",
    );
  });
});

describe("fallbackImage", () => {
  it("garde l'image TCGdex quand elle existe", () => {
    assert.equal(
      fallbackImage({
        image: "https://assets.tcgdex.net/ja/SV/SV8a/001",
        variants_detailed: [{ thirdParty: { tcgplayer: 1 } }],
      }),
      "https://assets.tcgdex.net/ja/SV/SV8a/001",
    );
  });

  it("se rabat sur le premier tirage connu de TCGplayer", () => {
    assert.equal(
      fallbackImage({
        variants_detailed: [{ thirdParty: { tcgplayer: null } }, { thirdParty: { tcgplayer: 587758 } }],
      }),
      `${TCGPLAYER_PREFIX}587758`,
    );
  });

  it("ne rend rien sans image ni identifiant", () => {
    assert.equal(fallbackImage({ variants_detailed: [{ thirdParty: null }] }), undefined);
    assert.equal(fallbackImage({}), undefined);
  });
});
