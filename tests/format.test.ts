import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { age, countdown, euro, percent, plural } from "../lib/format.ts";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("euro", () => {
  it("remplace une valeur absente par un tiret plutôt que par 0 €", () => {
    assert.equal(euro(null), "—");
    assert.equal(euro(undefined), "—");
    assert.equal(euro(Number.NaN), "—");
  });

  it("formate zéro, qui est une valeur légitime", () => {
    assert.match(euro(0), /^0,00/);
  });
});

describe("percent", () => {
  // L'espace avant le « % » est insécable : c'est la règle française, et elle
  // évite qu'un pourcentage se coupe en fin de ligne dans une cellule étroite.
  const NBSP = "\u00a0";

  it("marque explicitement le signe positif", () => {
    assert.equal(percent(12), `+12${NBSP}%`);
    assert.equal(percent(-12), `-12${NBSP}%`);
    assert.equal(percent(0), `0${NBSP}%`);
  });
});

describe("age", () => {
  it("choisit l'unité selon l'ancienneté", () => {
    assert.equal(age(NOW - 5 * MINUTE, NOW), "5 min");
    assert.equal(age(NOW - 3 * HOUR, NOW), "3 h");
    assert.equal(age(NOW - 4 * DAY, NOW), "4 j");
    assert.equal(age(NOW - 60 * DAY, NOW), "2 mois");
    assert.equal(age(NOW - 800 * DAY, NOW), "2 ans");
  });

  it("nomme l'instant présent", () => {
    assert.equal(age(NOW, NOW), "à l’instant");
  });

  it("n'invente rien sans horodatage", () => {
    // Vinted n'expose pas toujours de date : mieux vaut ne rien afficher que
    // de laisser croire à une annonce publiée à l'instant.
    assert.equal(age(null, NOW), null);
    assert.equal(age(0, NOW), null);
  });
});

describe("countdown", () => {
  it("choisit l'unité selon le temps restant", () => {
    assert.equal(countdown(NOW + 5 * MINUTE, NOW), "5 min");
    assert.equal(countdown(NOW + 3 * HOUR, NOW), "3 h");
    assert.equal(countdown(NOW + 4 * DAY, NOW), "4 j");
  });

  it("se tait sur une échéance passée", () => {
    // L'instantané du fil peut avoir dix minutes : une enchère terminée entre
    // temps ne doit pas afficher « il reste −3 min ».
    assert.equal(countdown(NOW - MINUTE, NOW), null);
    assert.equal(countdown(NOW, NOW), null);
  });

  it("n'invente rien sans échéance", () => {
    assert.equal(countdown(null, NOW), null);
    assert.equal(countdown(0, NOW), null);
  });
});

describe("plural", () => {
  it("n'accorde qu'au-delà de un", () => {
    assert.equal(plural(0, "carte"), "0 carte");
    assert.equal(plural(1, "carte"), "1 carte");
    assert.equal(plural(2, "carte"), "2 cartes");
  });

  it("accepte un pluriel irrégulier", () => {
    assert.equal(plural(2, "journal", "journaux"), "2 journaux");
  });
});
