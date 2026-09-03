/**
 * `lib/bulbapedia.ts` lit du wikitexte : c'est fragile par nature, donc testé
 * sur des extraits réels des pages « Charmander (TCG) » et
 * « Charmander (McDonald Pack 4) », relevés le 3 septembre 2026.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bulbaId,
  cardPageOf,
  frenchCardName,
  parseBulbaId,
  parseCardPage,
  parseSpeciesReleases,
  plainText,
  setRef,
  templateParams,
} from "../lib/bulbapedia.ts";

const SPECIES = `
==List of Pokémon cards featuring Charmander==
{{card list/header|Charmander|Fire}}
{{card list/card|cardname={{TCG ID|Base Set|Charmander|46}}|type=Fire|color=FFF|rows=6}}
{{card list/release|type=Fire|enset=Base Set|ensymbol=None|enrarity=Common|ennum=46/102|jpset=Expansion Pack|jpsymbol=None|jprarity=Common}}
{{card list/release|type=Fire|jpset=Unnumbered Promotional cards|jpsymbol=None}}
{{card list/release|type=Fire|enset=Base Set 2|enrarity=Common|ennum=69/130}}
{{card list/release|type=Fire|enset=Stormfront|enrarity=Rare Secret|ennum=101/100|jpset=Intense Fight in the Destroyed Sky|jprarity=Ultra-Rare Common|jpnum=090/092}}

{{card list/card|cardname={{TCG ID|McDonald Pack|Charmander|4}}|type=Fire|color=FFF|rows=1}}
{{card list/release|type=Fire|jpset=McDonald's Pokémon-e Minimum Pack|jpsymbol=SetSymbolMcDonalds Minimum Pack|jpnum=004/018}}

{{card list/card|cardname={{TCG ID|EX Dragon|Charmander|98}}|type=Fire|color=FFF|rows=2}}
{{card list/release|type=Fire|enset=EX Dragon|ensymbol=SetSymbolDragon|enrarity=Rare Secret|ennum=98/97|jpset=Latias ex Half Deck|jpsetlink=Gift Box|jpnum=001/018}}
{{card list/release|type=Fire|enset=EX FireRed & LeafGreen|ensymbol=SetSymbolFireRed and LeafGreen|enrarity=Rare Secret|ennum=113/112|jpset=ADV-P Promotional cards|jpsymbol=SetSymbolPromo|jpnum=052/ADV-P}}

{{card list/card|cardname={{TCG ID|EX Crystal Guardians|Charmander δ|49}}|type=Lightning|color=FFF|rows=1}}
{{card list/release|type=Lightning|enset=EX Crystal Guardians|ensymbol=SetSymbolCrystal Guardians|enrarity=Common|ennum=49/100|jpset=Earth's Groudon ex Constructed Starter Deck|jpsymbol=SetSymbolGroudon ex Constructed Starter Deck|jpnum=004/016}}
{{card list/footer|Fire}}
`;

const CARD = `{{TCG Unreleased}}
{{PokémoncardInfobox
|cardname=Charmander
|jname=ヒトカゲ
|jtrans=Hitokage
|image=CharmanderMcDonaldPack4.jpg
|caption=Illus. [[Hajime Kusajima]]
|species=Charmander
|evostage=Basic
|type=Fire
|hp=50
|weakness=Water
|retreatcost=1
}}
{{PokémoncardInfobox/Expansion|type=Fire|jpexpansion={{TCG|McDonald's Pokémon-e Minimum Pack}}|jpcardno=004/018}}
{{PokémoncardInfobox/Footer|type=Fire|species=Charmander}}

'''Charmander''' (Japanese: '''ヒトカゲ''' ''Hitokage'') is a {{ct|Fire}} Basic Pokémon card.
`;

describe("templateParams", () => {
  it("découpe sur les barres, sauf à l'intérieur d'un modèle ou d'un lien", () => {
    const params = templateParams("|a=1|set={{TCG|Nom|avec barre}}|lien=[[Page|Libellé]]|b= 2 ");
    assert.deepEqual(params, {
      a: "1",
      set: "{{TCG|Nom|avec barre}}",
      lien: "[[Page|Libellé]]",
      b: "2",
    });
  });
});

describe("plainText", () => {
  it("dépouille les modèles TCG et les liens", () => {
    assert.equal(plainText("{{TCG|McDonald's Pokémon-e Minimum Pack}}"), "McDonald's Pokémon-e Minimum Pack");
    assert.equal(plainText("[[Gift Box|Latias ex Half Deck]]"), "Latias ex Half Deck");
    assert.equal(plainText("'''Charmander'''"), "Charmander");
  });
});

describe("cardPageOf", () => {
  it("compose le titre de page depuis un TCG ID", () => {
    assert.deepEqual(cardPageOf("{{TCG ID|McDonald Pack|Charmander|4}}"), {
      page: "Charmander (McDonald Pack 4)",
      name: "Charmander",
    });
  });

  it("garde un nom à symbole", () => {
    assert.deepEqual(cardPageOf("{{TCG ID|EX Crystal Guardians|Charmander δ|49}}"), {
      page: "Charmander δ (EX Crystal Guardians 49)",
      name: "Charmander δ",
    });
  });

  it("lit aussi un lien direct", () => {
    assert.deepEqual(cardPageOf("[[Charmander (Base Set 46)|Charmander]]"), {
      page: "Charmander (Base Set 46)",
      name: "Charmander",
    });
  });
});

describe("parseSpeciesReleases", () => {
  const releases = parseSpeciesReleases(SPECIES);

  it("ne retient que les sorties japonaises", () => {
    // Huit lignes de sortie, dont une sans `jpset` : Base Set 2, réédition
    // américaine sans équivalent japonais.
    assert.equal(releases.length, 7);
    assert.ok(releases.every((release) => release.set));
  });

  it("rattache chaque sortie à la page de sa carte", () => {
    const mcdo = releases.find((release) => release.number === "004/018");
    assert.deepEqual(mcdo, {
      page: "Charmander (McDonald Pack 4)",
      cardName: "Charmander",
      set: "McDonald's Pokémon-e Minimum Pack",
      number: "004/018",
      rarity: null,
    });
  });

  it("garde les anciennes cartes sans numéro", () => {
    const unnumbered = releases.filter((release) => release.number === null);
    assert.deepEqual(
      unnumbered.map((release) => release.set),
      ["Expansion Pack", "Unnumbered Promotional cards"],
    );
  });

  it("lit un numéro à code d'extension", () => {
    const promo = releases.find((release) => release.set === "ADV-P Promotional cards");
    assert.equal(promo?.number, "052/ADV-P");
    assert.equal(promo?.page, "Charmander (EX Dragon 98)");
  });
});

describe("parseCardPage", () => {
  const page = parseCardPage(CARD);

  it("lit l'infobox et ses sorties", () => {
    assert.ok(page);
    assert.equal(page.cardName, "Charmander");
    assert.equal(page.jname, "ヒトカゲ");
    assert.equal(page.image, "CharmanderMcDonaldPack4.jpg");
    assert.equal(page.hp, 50);
    assert.equal(page.type, "Fire");
    assert.equal(page.illustrator, "Hajime Kusajima");
    assert.deepEqual(page.releases, [
      { set: "McDonald's Pokémon-e Minimum Pack", number: "004/018", rarity: null },
    ]);
  });

  it("rend null sans infobox", () => {
    assert.equal(parseCardPage("Rien à voir."), null);
  });
});

describe("identifiants", () => {
  it("font l'aller-retour, numéro compris", () => {
    const id = bulbaId("Charmander (McDonald Pack 4)", "004/018");
    assert.equal(id, "jb:Charmander (McDonald Pack 4)|004/018");
    assert.deepEqual(parseBulbaId(id), { page: "Charmander (McDonald Pack 4)", release: "004/018" });
  });

  it("acceptent une sortie désignée par son extension, ou rien", () => {
    assert.deepEqual(parseBulbaId("jb:Charmander (Base Set 46)|Expansion Pack"), {
      page: "Charmander (Base Set 46)",
      release: "Expansion Pack",
    });
    assert.deepEqual(parseBulbaId("jb:Charmander (Base Set 46)"), {
      page: "Charmander (Base Set 46)",
      release: null,
    });
    assert.equal(parseBulbaId("ja:SV-P-001"), null);
  });
});

describe("setRef", () => {
  it("lit un total numérique", () => {
    assert.deepEqual(setRef("McDonald's Pokémon-e Minimum Pack", "004/018"), {
      id: "mcdonald-s-pokemon-e-minimum-pack",
      name: "McDonald's Pokémon-e Minimum Pack",
      cardCount: { official: 18, total: 18 },
      localId: "004",
    });
  });

  it("prend un dénominateur non numérique pour code d'extension", () => {
    const ref = setRef("ADV-P Promotional cards", "052/ADV-P");
    assert.equal(ref.id, "ADV-P");
    assert.equal(ref.cardCount.official, 0);
    assert.equal(ref.localId, "052");
  });

  it("laisse le numéro vide sur une carte non numérotée", () => {
    assert.equal(setRef("Expansion Pack", null).localId, null);
  });
});

describe("frenchCardName", () => {
  it("traduit l'espèce et garde le reste", () => {
    assert.equal(frenchCardName("Charmander", { en: "Charmander", fr: "Salamèche" }), "Salamèche");
    assert.equal(frenchCardName("Charmander δ", { en: "Charmander", fr: "Salamèche" }), "Salamèche δ");
    assert.equal(
      frenchCardName("Team Rocket's Charmander", { en: "Charmander", fr: "Salamèche" }),
      "Team Rocket's Salamèche",
    );
  });

  it("retrouve l'espèce seule, suffixe compris", () => {
    assert.equal(frenchCardName("Charmander"), "Salamèche");
    assert.equal(frenchCardName("Leafeon ex"), "Phyllali ex");
  });

  it("laisse un Dresseur en anglais", () => {
    assert.equal(frenchCardName("Iono"), "Iono");
  });
});
