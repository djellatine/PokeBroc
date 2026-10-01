/**
 * Les avis de panne partent dans le salon « ERREUR » quand il est configuré,
 * sinon dans celui des alertes.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { errorWebhookUrl, webhookUrl } from "../lib/discord.ts";

const ALERTES = "https://discord.com/api/webhooks/1/alertes";
const ERREUR = "https://discord.com/api/webhooks/2/erreur";

afterEach(() => {
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.DISCORD_ERREUR_WEBHOOK_URL;
});

describe("errorWebhookUrl", () => {
  it("prend le salon ERREUR quand il est là", () => {
    process.env.DISCORD_WEBHOOK_URL = ALERTES;
    process.env.DISCORD_ERREUR_WEBHOOK_URL = ERREUR;
    assert.equal(errorWebhookUrl(), ERREUR);
    assert.equal(webhookUrl(), ALERTES);
  });

  it("retombe sur le salon des alertes sinon, ou si l'adresse est collée de travers", () => {
    process.env.DISCORD_WEBHOOK_URL = ALERTES;
    assert.equal(errorWebhookUrl(), ALERTES);
    process.env.DISCORD_ERREUR_WEBHOOK_URL = "https://exemple.fr/pas-un-webhook";
    assert.equal(errorWebhookUrl(), ALERTES);
  });
});
