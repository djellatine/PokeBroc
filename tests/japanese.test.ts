/**
 * `lib/japanese.ts` fait le pont entre le catalogue japonais et les annonces
 * françaises. Sans lui, une Pikachu japonaise s'appelle « ピカチュウ » et
 * aucun titre Vinted ne la reconnaît.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasJapaneseScript, japaneseCandidates, translateJapaneseName } from "../lib/japanese.ts";

describe("translateJapaneseName", () => {
  it("traduit une espèce nue", () => {
    assert.deepEqual(translateJapaneseName("ピカチュウ"), {
      name: "Pikachu",
      nameEn: "Pikachu",
      translated: true,
    });
  });

  it("garde le suffixe latin, séparé par une espace comme l'écrivent les vendeurs", () => {
    const leafeon = translateJapaneseName("リーフィアex");
    assert.equal(leafeon.name, "Phyllali ex");
    assert.equal(leafeon.nameEn, "Leafeon ex");

    assert.equal(translateJapaneseName("ミュウツーVSTAR").name, "Mewtwo VSTAR");
  });

  it("traduit chaque espèce d'une carte TAG TEAM", () => {
    assert.equal(translateJapaneseName("ピカチュウ&ゼクロムGX").name, "Pikachu & Zekrom GX");
  });

  it("lit le « M » des Méga-évolutions comme « Mega »", () => {
    assert.equal(translateJapaneseName("Mリザードンex").name, "Mega Dracaufeu ex");
    assert.equal(translateJapaneseName("Mリザードンex").nameEn, "Mega Charizard ex");
  });

  it("laisse tomber un préfixe japonais qu'aucune annonce ne reprend", () => {
    // « Miaouss de la Team Rocket » : les vendeurs écrivent « Miaouss Rocket »
    // au mieux, et c'est le nom de l'espèce qui compte.
    assert.equal(translateJapaneseName("ロケット団のニャース").name, "Miaouss");
  });

  it("rend le nom tel quel quand aucune espèce n'y figure", () => {
    assert.deepEqual(translateJapaneseName("ナンジャモ"), {
      name: "ナンジャモ",
      nameEn: null,
      translated: false,
    });
  });

  it("lit les chiffres pleine chasse de la table comme ceux du catalogue", () => {
    assert.equal(translateJapaneseName("ポリゴン2").name, "Porygon2");
  });
});

describe("japaneseCandidates", () => {
  it("traduit une saisie française exacte, accents ou non", () => {
    assert.deepEqual(japaneseCandidates("Évoli"), ["イーブイ"]);
    assert.deepEqual(japaneseCandidates("evoli"), ["イーブイ"]);
  });

  it("accepte aussi le nom anglais", () => {
    assert.deepEqual(japaneseCandidates("eevee"), ["イーブイ"]);
  });

  it("met la correspondance exacte devant les préfixes", () => {
    assert.equal(japaneseCandidates("pikachu")[0], "ピカチュウ");
  });

  it("élargit une saisie partielle, dans la limite de quelques espèces", () => {
    const found = japaneseCandidates("dra");
    assert.ok(found.includes("リザードン"), "Dracaufeu attendu");
    assert.ok(found.length <= 8);
  });

  it("prend telle quelle une saisie déjà en japonais", () => {
    assert.deepEqual(japaneseCandidates("ナンジャモ"), ["ナンジャモ"]);
  });

  it("ne cherche rien sur une saisie trop courte", () => {
    assert.deepEqual(japaneseCandidates("p"), []);
  });
});

describe("hasJapaneseScript", () => {
  it("distingue katakanas et kanjis du latin", () => {
    assert.equal(hasJapaneseScript("ピカチュウ"), true);
    assert.equal(hasJapaneseScript("Pikachu ex"), false);
  });
});
