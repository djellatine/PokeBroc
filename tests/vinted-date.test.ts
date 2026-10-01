/**
 * `lib/vinted-date.ts` date une annonce Vinted d'après son identifiant, faute
 * de date dans le nouveau catalogue.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { latestVinted, postedAt, vintedIdTime, vintedNumericId } from "../lib/vinted-date.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1, 18);

describe("vintedIdTime", () => {
  it("retrouve à quelques jours près des annonces datées par leur photo", () => {
    // Relevés du fil le 1er octobre 2026, hors des repères eux-mêmes.
    for (const [id, date] of [
      [6076111080, Date.UTC(2025, 3, 2)],
      [9070969650, Date.UTC(2026, 5, 2)],
      [9658066475, Date.UTC(2026, 7, 14)],
      [9939126261, Date.UTC(2026, 8, 9)],
    ] as const) {
      assert.ok(Math.abs(vintedIdTime(id) - date) < 21 * DAY, `${id}`);
    }
  });

  it("suit un repère frais au-delà du dernier repère écrit", () => {
    const later: [number, number] = [10500000000, Date.UTC(2026, 10, 1)];
    const t = vintedIdTime(10400000000, later);
    assert.ok(t > Date.UTC(2026, 9, 1) && t < Date.UTC(2026, 10, 1));
  });
});

describe("postedAt", () => {
  it("garde la date donnée par la source", () => {
    assert.equal(postedAt({ id: "lbc:1", createdAt: 42, firstSeen: NOW }), 42);
  });

  it("vieillit une vieille annonce Vinted croisée aujourd'hui", () => {
    const t = postedAt({ id: "vinted:6076111080", createdAt: null, firstSeen: NOW });
    assert.ok(NOW - t > 400 * DAY);
  });

  it("ne date jamais une annonce après le moment où nous l'avons croisée", () => {
    const seen = Date.UTC(2026, 9, 1, 17, 48);
    assert.ok(postedAt({ id: "vinted:10300000000", createdAt: null, firstSeen: seen }) <= seen);
  });

  it("retombe sur firstSeen hors Vinted", () => {
    assert.equal(postedAt({ id: "ebay:x", createdAt: null, firstSeen: NOW }), NOW);
  });
});

describe("latestVinted", () => {
  it("prend le plus grand identifiant Vinted et ignore les autres sources", () => {
    const items = [
      { id: "vinted:5", firstSeen: 1 },
      { id: "vinted:12", firstSeen: 2 },
      { id: "lbc:99", firstSeen: 3 },
    ];
    assert.deepEqual(latestVinted(items), [12, 2]);
    assert.equal(vintedNumericId("ebay:v1|1|0"), null);
  });
});
