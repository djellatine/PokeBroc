import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, describe, it } from "node:test";
import { clientIp, rateLimit, refund, resetRateLimits } from "../lib/rate-limit.ts";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("laisse passer exactement le nombre de jetons du seau", () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(rateLimit("k", 3, 60_000).ok, true, `appel ${i + 1}`);
    }
    assert.equal(rateLimit("k", 3, 60_000).ok, false);
  });

  it("décompte les jetons restants", () => {
    assert.equal(rateLimit("k", 3, 60_000).remaining, 2);
    assert.equal(rateLimit("k", 3, 60_000).remaining, 1);
    assert.equal(rateLimit("k", 3, 60_000).remaining, 0);
  });

  it("isole les clés les unes des autres", () => {
    rateLimit("a", 1, 60_000);
    assert.equal(rateLimit("a", 1, 60_000).ok, false);
    assert.equal(rateLimit("b", 1, 60_000).ok, true);
  });

  it("annonce un délai d'attente exploitable une fois à sec", () => {
    rateLimit("k", 1, 60_000);
    const blocked = rateLimit("k", 1, 60_000);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60);
  });

  it("régénère les jetons avec le temps", async () => {
    // Deux jetons sur 200 ms : après 130 ms il en est revenu au moins un.
    assert.equal(rateLimit("k", 2, 200).ok, true);
    assert.equal(rateLimit("k", 2, 200).ok, true);
    assert.equal(rateLimit("k", 2, 200).ok, false);

    await sleep(130);
    assert.equal(rateLimit("k", 2, 200).ok, true);
  });

  it("ne dépasse jamais la capacité du seau, même après une longue pause", async () => {
    rateLimit("k", 2, 50);
    await sleep(120); // largement de quoi tout reconstituer, et pas plus

    assert.equal(rateLimit("k", 2, 50).ok, true);
    assert.equal(rateLimit("k", 2, 50).ok, true);
    assert.equal(rateLimit("k", 2, 50).ok, false);
  });
});

describe("refund", () => {
  it("rend ses jetons à une clé épuisée", () => {
    rateLimit("k", 1, 60_000);
    assert.equal(rateLimit("k", 1, 60_000).ok, false);

    refund("k");
    assert.equal(rateLimit("k", 1, 60_000).ok, true);
  });
});

describe("clientIp", () => {
  it("retient le client d'origine dans une chaîne de proxys", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" });
    assert.equal(clientIp(headers), "203.0.113.7");
  });

  it("se rabat sur x-real-ip", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  });

  it("renvoie une valeur constante quand rien n'est connu", () => {
    // Toutes les requêtes anonymes partagent alors un seul seau : c'est
    // volontaire, mieux vaut brider trop que pas du tout.
    assert.equal(clientIp(new Headers()), "inconnu");
  });
});
