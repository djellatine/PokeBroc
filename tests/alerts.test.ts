import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose, isPermanentFailure, offerLine, selectFresh } from "../lib/alerts.ts";
import type { FeedCard, FeedItem } from "../lib/feed.ts";
import { chunk, escapeHtml, MAX_MESSAGE } from "../lib/telegram.ts";

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

describe("offerLine", () => {
  it("compose prix, écart, provenance et état", () => {
    const line = offerLine(item({ condition: "bon", vsMarket: -38 }));
    // `percent()` sépare le nombre du signe par une espace insécable : `\s` la
    // couvre, une espace ordinaire dans le motif ne la trouverait pas.
    assert.match(line, /-38\s%/);
    assert.match(line, /Vinted/);
    assert.match(line, /Bon/);
    assert.match(line, /^<a href="https:\/\/www\.vinted\.fr\/items\/1">/);
  });

  it("préfère le prix total au prix affiché, frais compris", () => {
    assert.match(offerLine(item({ price: 42, totalPrice: 47 })), /47/);
  });

  it("tait l'écart quand il n'y a pas de cote", () => {
    assert.doesNotMatch(offerLine(item({ vsMarket: null })), /%/);
  });

  it("annonce une enchère et son nombre d'offres", () => {
    const line = offerLine(item({ auction: true, bids: 3, vsMarket: null }));
    assert.match(line, /enchère · 3 offres/);
  });

  it("échappe une URL qui contient une esperluette", () => {
    // Non échappée, `&` casserait l'attribut et Telegram rejetterait le message.
    const line = offerLine(item({ url: "https://ebay.fr/itm/1?a=1&b=2" }));
    assert.match(line, /a=1&amp;b=2/);
    assert.doesNotMatch(line, /a=1&b=2/);
  });
});

describe("compose", () => {
  it("annonce le total et groupe par carte", () => {
    const lines = compose([{ card: CARD, items: [item(), item({ id: "vinted:2" })] }]);
    assert.match(lines[0], /2 nouvelles annonces/);
    assert.ok(lines.some((line) => line.includes("Dracaufeu — 4")));
    assert.ok(lines.some((line) => line.includes("Set de Base")));
  });

  it("accorde le singulier", () => {
    const lines = compose([{ card: CARD, items: [item()] }]);
    assert.match(lines[0], /1 nouvelle annonce/);
  });

  it("plafonne les annonces citées et renvoie au site pour le reste", () => {
    const many = Array.from({ length: 30 }, (_, index) => item({ id: `vinted:${index}` }));
    const lines = compose([{ card: CARD, items: many }], 25);
    const offers = lines.filter((line) => line.startsWith("<a href="));
    assert.equal(offers.length, 25);
    assert.ok(lines.at(-1)?.includes("5 autres"));
  });

  it("échappe un nom de carte porteur de chevrons", () => {
    const lines = compose([{ card: { ...CARD, name: "Pikachu <3" }, items: [item()] }]);
    assert.ok(lines.some((line) => line.includes("Pikachu &lt;3")));
  });
});

describe("isPermanentFailure", () => {
  it("reconnaît un bot bloqué ou une conversation disparue", () => {
    assert.ok(isPermanentFailure("Forbidden: bot was blocked by the user"));
    assert.ok(isPermanentFailure("Bad Request: chat not found"));
  });

  it("traite le reste comme passager, pour ne pas perdre les annonces", () => {
    assert.equal(isPermanentFailure("Internal Server Error"), false);
    assert.equal(isPermanentFailure("fetch failed"), false);
  });
});

describe("escapeHtml", () => {
  it("neutralise ce que parse_mode HTML interpréterait", () => {
    assert.equal(escapeHtml("<b>a & b</b>"), "&lt;b&gt;a &amp; b&lt;/b&gt;");
  });
});

describe("chunk", () => {
  it("rend un seul message tant que la limite tient", () => {
    assert.deepEqual(chunk(["a", "b", "c"]), ["a\nb\nc"]);
  });

  it("découpe sur les sauts de ligne, jamais au milieu", () => {
    const line = "x".repeat(30);
    const messages = chunk([line, line, line], 70);
    // 30 + 1 + 30 = 61 tient ; ajouter la troisième ferait 92.
    assert.deepEqual(messages, [`${line}\n${line}`, line]);
  });

  it("ne dépasse jamais la limite annoncée", () => {
    const lines = Array.from({ length: 400 }, (_, index) => `<a href="#">ligne ${index}</a>`);
    for (const message of chunk(lines)) {
      assert.ok(message.length <= MAX_MESSAGE, `message de ${message.length} caractères`);
    }
  });

  it("ne perd aucune ligne au passage", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `ligne ${index}`);
    const rejoined = chunk(lines, 100).join("\n").split("\n");
    assert.deepEqual(rejoined, lines);
  });
});
