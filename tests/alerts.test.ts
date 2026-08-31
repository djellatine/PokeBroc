import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { offerText, selectFresh } from "../lib/alerts.ts";
import { buildEmbeds } from "../lib/discord.ts";
import type { FeedCard, FeedItem } from "../lib/feed.ts";

const NOW = 1_700_000_000_000;

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "vinted:1",
    source: "vinted",
    cardId: "base1-4",
    title: "Dracaufeu 4/102",
    url: "https://www.vinted.fr/items/1",
    thumbnail: null,
    price: 42,
    totalPrice: 42,
    condition: null,
    promoted: false,
    favourites: 0,
    createdAt: NOW,
    score: 10,
    graded: false,
    bulk: false,
    trend: 100,
    vsMarket: -58,
    country: null,
    auction: false,
    bids: 0,
    endsAt: null,
    firstSeen: NOW,
    ...overrides,
  };
}

const CARD: FeedCard = {
  cardId: "base1-4",
  name: "Dracaufeu",
  localId: "4",
  setName: "Set de Base",
  image: null,
  trend: 100,
};

describe("selectFresh", () => {
  it("ne retient que ce qui est apparu après le repère", () => {
    const items = [
      item({ id: "vinted:1", firstSeen: NOW }),
      item({ id: "vinted:2", firstSeen: NOW - 1000 }),
    ];
    const fresh = selectFresh(items, NOW - 500);
    assert.deepEqual(
      fresh.map((entry) => entry.id),
      ["vinted:1"],
    );
  });

  it("écarte ce que l'utilisateur a masqué à la main", () => {
    const items = [item({ id: "vinted:1" }), item({ id: "vinted:2" })];
    const fresh = selectFresh(items, 0, { "vinted:2": NOW });
    assert.deepEqual(
      fresh.map((entry) => entry.id),
      ["vinted:1"],
    );
  });

  it("exclut l'annonce découverte à l'instant du repère, déjà annoncée", () => {
    // `>` et non `>=` : le repère vaut la date du dernier envoi.
    assert.equal(selectFresh([item({ firstSeen: NOW })], NOW).length, 0);
  });

  it("écarte les correspondances faibles, qui parlent d'une autre carte", () => {
    assert.equal(selectFresh([item({ score: 5 })], 0).length, 0);
  });

  it("écarte gradées et lots, que le fil masque par défaut", () => {
    // Sinon l'alerte mène à une page où l'annonce annoncée est filtrée.
    assert.equal(selectFresh([item({ graded: true })], 0).length, 0);
    assert.equal(selectFresh([item({ bulk: true })], 0).length, 0);
  });

  it("classe la découverte la plus récente en tête", () => {
    const items = [
      item({ id: "vinted:vieux", firstSeen: NOW - 5000 }),
      item({ id: "vinted:neuf", firstSeen: NOW }),
    ];
    assert.equal(selectFresh(items, 0)[0].id, "vinted:neuf");
  });
});

describe("offerText", () => {
  it("compose prix, écart, provenance et état", () => {
    const text = offerText(item({ condition: "bon", vsMarket: -38 }));
    // `percent()` sépare le nombre du signe par une espace insécable : `\s` la
    // couvre, une espace ordinaire dans le motif ne la trouverait pas.
    assert.match(text, /-38\s%/);
    assert.match(text, /Vinted/);
    assert.match(text, /Bon/);
  });

  it("préfère le prix total au prix affiché, frais compris", () => {
    assert.match(offerText(item({ price: 42, totalPrice: 47 })), /47/);
  });

  it("tait l'écart quand il n'y a pas de cote", () => {
    assert.doesNotMatch(offerText(item({ vsMarket: null })), /%/);
  });

  it("annonce une enchère et son nombre d'offres", () => {
    assert.match(offerText(item({ auction: true, bids: 3, vsMarket: null })), /enchère · 3 offres/);
  });
});

describe("buildEmbeds", () => {
  it("un embed par carte, ses annonces en liens Markdown", () => {
    const [embed] = buildEmbeds([{ card: CARD, items: [item(), item({ id: "vinted:2" })] }]);
    assert.match(embed.title, /Dracaufeu · 4/);
    assert.match(embed.title, /Set de Base/);
    // Chaque ligne est un lien Markdown `[texte](url)`.
    const lignes = embed.description.split("\n");
    assert.equal(lignes.length, 2);
    assert.match(lignes[0], /^\[.+\]\(https:\/\/www\.vinted\.fr\/items\/1\)$/);
  });

  it("plafonne le nombre d'annonces citées", () => {
    const many = Array.from({ length: 30 }, (_, index) => item({ id: `vinted:${index}` }));
    const [embed] = buildEmbeds([{ card: CARD, items: many }], 25);
    assert.equal(embed.description.split("\n").length, 25);
  });
});
