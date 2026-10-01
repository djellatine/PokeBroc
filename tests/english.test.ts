/**
 * `lib/english.ts` rend trouvables les cartes des extensions jamais sorties
 * en français — Legendary Treasures, Skyridge, Base Set 2 — depuis une saisie
 * française, et lisibles sous leur nom français.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { englishCandidates, translateEnglishName } from "../lib/english.ts";

describe("translateEnglishName", () => {
  it("traduit une espèce nue", () => {
    assert.equal(translateEnglishName("Charizard"), "Dracaufeu");
  });

  it("garde préfixes et suffixes tels quels", () => {
    assert.equal(translateEnglishName("Dark Charizard"), "Dark Dracaufeu");
    assert.equal(translateEnglishName("Reshiram-EX"), "Reshiram-EX");
    assert.equal(translateEnglishName("Venusaur ex"), "Florizarre ex");
  });

  it("préfère le nom le plus long, sans couper un mot", () => {
    assert.equal(translateEnglishName("Mewtwo"), "Mewtwo");
    assert.equal(translateEnglishName("Mew"), "Mew");
    assert.equal(translateEnglishName("Mr. Mime"), "M. Mime");
    assert.equal(translateEnglishName("Farfetch'd"), "Canarticho");
  });

  it("laisse une Dresseur en anglais", () => {
    assert.equal(translateEnglishName("Professor Oak"), "Professor Oak");
  });
});

describe("englishCandidates", () => {
  it("interroge la saisie, puis le nom anglais de l'espèce", () => {
    assert.deepEqual(englishCandidates("dracaufeu"), ["dracaufeu", "Charizard"]);
  });

  it("ne double pas un nom identique dans les deux langues", () => {
    assert.deepEqual(englishCandidates("Reshiram"), ["Reshiram"]);
  });
});
