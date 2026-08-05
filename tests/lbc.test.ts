/**
 * Leboncoin est la seule source que le site ne peut pas interroger lui-même :
 * il lit un instantané déposé par une minuterie. Toute la logique de collecte
 * vit donc en Python, et sa suite est à côté — `collect/test_lbc.py`.
 *
 * Ne reste ici que la règle de péremption, et elle mérite ses tests : c'est
 * elle qui décide, sans rien afficher, si le « flux des lots récents » est un
 * flux ou un fichier oublié. Se tromper de sens la rendrait invisible.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LBC_MAX_AGE_MS, lbcIsUsable, type LbcSnapshot } from "../lib/lbc.ts";

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

function snapshot(overrides: Partial<LbcSnapshot> = {}): LbcSnapshot {
  return {
    at: NOW,
    windowHours: 3,
    queries: ["lot cartes pokemon"],
    items: [],
    ...overrides,
  };
}

describe("lbcIsUsable", () => {
  it("accepte un instantané qui vient d'être écrit", () => {
    assert.equal(lbcIsUsable(snapshot(), NOW), true);
  });

  it("accepte un passage manqué", () => {
    // La minuterie vise trois heures ; une machine en veille en saute un.
    // Tolérer ce cas évite de faire disparaître la section pour rien.
    const missed = snapshot({ at: NOW - 4 * 3600_000 });
    assert.equal(lbcIsUsable(missed, NOW), true);
  });

  it("rejette au-delà de deux passages manqués", () => {
    const abandoned = snapshot({ at: NOW - LBC_MAX_AGE_MS - 1 });
    assert.equal(lbcIsUsable(abandoned, NOW), false);
  });

  /**
   * Trois heures sans un seul lot mis en ligne est un résultat, pas une panne —
   * et cela arrive la nuit. Confondre les deux ferait clignoter la source à
   * chaque heure creuse.
   */
  it("accepte un instantané vide mais récent", () => {
    assert.equal(lbcIsUsable(snapshot({ items: [] }), NOW), true);
  });

  it("rejette l'absence d'instantané", () => {
    assert.equal(lbcIsUsable(null, NOW), false);
  });

  /**
   * Le collecteur horodate avec sa propre horloge. Une resynchronisation NTP
   * pendant la collecte peut poser un instantané quelques secondes en avance :
   * mieux vaut l'accepter que faire disparaître la section sur un écart que
   * personne ne peut voir.
   */
  it("tolère un instantané en avance sur l'horloge du site", () => {
    const skewed = snapshot({ at: NOW + 5_000 });
    assert.equal(lbcIsUsable(skewed, NOW), true);
  });
});
