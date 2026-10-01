/**
 * `lib/health.ts` décide quand une panne de source mérite un message : pas à
 * la première coupure, pas à chaque passage, et toujours au retour.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOWN_AFTER_MS,
  nextHealth,
  noticeText,
  observeFromCards,
  REMIND_EVERY_MS,
  type HealthState,
} from "../lib/health.ts";

const T0 = Date.UTC(2026, 9, 1, 12);
const QUART = 15 * 60 * 1000;
const DOWN = { vinted: { down: true as const, reason: "aucun jeton reçu" } };
const UP = { vinted: { down: false as const } };

describe("nextHealth", () => {
  it("ne dit rien d'une coupure passagère", () => {
    const first = nextHealth({}, DOWN, T0);
    assert.equal(first.notices.length, 0);
    assert.equal(first.state.vinted?.since, T0);
    const back = nextHealth(first.state, UP, T0 + QUART);
    assert.equal(back.notices.length, 0, "aucun « refonctionne » sans alerte d'abord");
    assert.equal(back.state.vinted?.since, null);
  });

  it("alerte une fois la panne installée, puis se tait", () => {
    let state: HealthState = {};
    const sent: string[] = [];
    for (let t = T0; t <= T0 + 3 * 60 * 60 * 1000; t += QUART) {
      const step = nextHealth(state, DOWN, t);
      state = step.state;
      sent.push(...step.notices.map((notice) => notice.kind));
    }
    assert.deepEqual(sent, ["down"]);
    assert.ok(state.vinted?.alertedAt && state.vinted.alertedAt - T0 >= DOWN_AFTER_MS);
  });

  it("rappelle une panne qui dure, une fois par jour", () => {
    const alerted: HealthState = { vinted: { since: T0, alertedAt: T0 } };
    assert.equal(nextHealth(alerted, DOWN, T0 + REMIND_EVERY_MS - QUART).notices.length, 0);
    const reminder = nextHealth(alerted, DOWN, T0 + REMIND_EVERY_MS);
    assert.deepEqual(reminder.notices.map((notice) => notice.kind), ["still-down"]);
    assert.equal(reminder.state.vinted?.since, T0, "la panne garde sa date de début");
  });

  it("annonce le retour d'une source signalée en panne", () => {
    const alerted: HealthState = { vinted: { since: T0, alertedAt: T0 + DOWN_AFTER_MS } };
    const back = nextHealth(alerted, UP, T0 + 5 * 60 * 60 * 1000);
    assert.deepEqual(back.notices.map((notice) => notice.kind), ["up"]);
    assert.match(noticeText(back.notices[0], T0 + 5 * 60 * 60 * 1000), /refonctionne.*5 h/);
  });

  it("laisse intacte une source dont on n'a rien observé", () => {
    const state: HealthState = { ebay: { since: T0, alertedAt: null } };
    assert.deepEqual(nextHealth(state, { ebay: null }, T0 + DOWN_AFTER_MS).state, state);
  });
});

describe("observeFromCards", () => {
  it("tient une source pour en panne à partir de la moitié des cartes", () => {
    assert.deepEqual(observeFromCards(34, 68, "x"), { down: true, reason: "x" });
    assert.deepEqual(observeFromCards(1, 68, "x"), { down: false });
    assert.equal(observeFromCards(0, 0, null), null);
  });
});

describe("noticeText", () => {
  it("dit quoi faire, avec la commande à taper pour Vinted", () => {
    const text = noticeText({ source: "vinted", kind: "down", since: T0, reason: "aucun jeton" }, T0 + DOWN_AFTER_MS);
    assert.match(text, /Vinted\*\* ne répond plus depuis 45 min/);
    assert.match(text, /vinted_session\.py --force/);
    assert.ok(text.length < 2000);
  });
});
