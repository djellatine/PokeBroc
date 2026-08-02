import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarize, type Sighting } from "../lib/sightings.ts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 3600 * 1000;

function sighting(price: number | null, daysAgo = 1, strong = true): Sighting {
  const at = NOW - daysAgo * DAY;
  return { first: at, last: at, price, strong };
}

describe("summarize", () => {
  it("ne renvoie rien sans observation", () => {
    const stats = summarize([], 30, NOW);
    assert.deepEqual(stats, { count: 0, median: null, min: null, max: null, days: 30, since: null });
  });

  it("calcule la médiane d'un nombre impair de prix", () => {
    const stats = summarize([sighting(10), sighting(30), sighting(20)], 30, NOW);
    assert.equal(stats.count, 3);
    assert.equal(stats.median, 20);
    assert.equal(stats.min, 10);
    assert.equal(stats.max, 30);
  });

  it("moyenne les deux valeurs centrales quand le nombre est pair", () => {
    const stats = summarize([sighting(10), sighting(20), sighting(30), sighting(50)], 30, NOW);
    assert.equal(stats.median, 25);
  });

  it("préfère la médiane à la moyenne face à une annonce aberrante", () => {
    // Une gradée à 900 € déplacerait une moyenne de 20 € à plus de 200 €.
    const stats = summarize([sighting(18), sighting(20), sighting(22), sighting(900)], 30, NOW);
    assert.equal(stats.median, 21);
  });

  it("écarte les correspondances faibles, qui parlent d'une autre carte", () => {
    const stats = summarize([sighting(20), sighting(1000, 1, false)], 30, NOW);
    assert.equal(stats.count, 1);
    assert.equal(stats.median, 20);
  });

  it("écarte les observations hors fenêtre", () => {
    const stats = summarize([sighting(20, 5), sighting(999, 40)], 30, NOW);
    assert.equal(stats.count, 1);
    assert.equal(stats.max, 20);
  });

  it("écarte les prix absents ou nuls", () => {
    const stats = summarize([sighting(null), sighting(0), sighting(15)], 30, NOW);
    assert.equal(stats.count, 1);
    assert.equal(stats.median, 15);
  });

  it("remonte la première observation, même hors fenêtre de prix", () => {
    const stats = summarize([sighting(20, 5), sighting(30, 90)], 30, NOW);
    assert.equal(stats.since, NOW - 90 * DAY);
  });

  it("arrondit la médiane au centime", () => {
    const stats = summarize([sighting(10.005), sighting(10.005)], 30, NOW);
    assert.equal(stats.median, 10.01);
  });
});
