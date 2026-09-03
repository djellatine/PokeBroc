/**
 * Alertes Discord, par webhook.
 *
 * Un webhook est une URL liée à un salon : on y POST un message, il s'y affiche.
 * Pas de bot, pas de token à entretenir, pas d'appairage par personne — c'est
 * tout l'intérêt face à l'ancien bot Telegram. La contrepartie assumée : un
 * webhook écrit dans **un seul salon**, ce qui suffit pour un usage perso.
 *
 * L'URL vit dans l'environnement (`DISCORD_WEBHOOK_URL`), comme le jetons eBay :
 * absente, la veille balaie sans alerter, et le site l'affiche sur `/alertes`.
 */

import { offerText, MAX_ALERTS, type AlertGroup } from "./alerts";
import { plural } from "./format";
import { cardImage, isJapaneseId } from "./tcgdex";

/** Discord accepte au plus dix embeds par message. */
const MAX_EMBEDS = 10;

/** Bleu « blurple » de Discord, pour la barre latérale des embeds. */
const COLOR = 0x5865f2;

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  thumbnail?: { url: string };
}

export function webhookUrl(): string | null {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  // Un webhook Discord a une forme fixe ; refuser tout le reste évite de POSTer
  // des alertes vers une URL collée de travers.
  return url && /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/\S+$/.test(url)
    ? url
    : null;
}

export function isConfigured(): boolean {
  return webhookUrl() !== null;
}

/**
 * Un embed par carte : titre = la carte, description = ses annonces neuves en
 * liens Markdown, vignette = son visuel. Groupé par carte plutôt qu'à plat pour
 * qu'on voie d'un coup d'œil *laquelle* de ses cartes bouge.
 *
 * Plafonné à `MAX_EMBEDS` cartes et `MAX_ALERTS` annonces : au-delà, le lecteur
 * est renvoyé au site (le nombre restant part dans le `content` du message).
 */
export function buildEmbeds(groups: AlertGroup[], max = MAX_ALERTS): DiscordEmbed[] {
  const embeds: DiscordEmbed[] = [];
  let shown = 0;

  for (const group of groups) {
    if (embeds.length >= MAX_EMBEDS || shown >= max) break;

    const lines: string[] = [];
    for (const item of group.items) {
      if (shown >= max) break;
      lines.push(`[${offerText(item)}](${item.url})`);
      shown += 1;
    }
    if (lines.length === 0) continue;

    // Le drapeau dit d'un coup d'œil qu'on parle de la version japonaise : sans
    // lui, « Pikachu · 001 » et « Pikachu · 25 » se lisent pareil sur un
    // téléphone.
    const flag = isJapaneseId(group.card.cardId) ? "🇯🇵 " : "";
    const name = group.card.localId
      ? `${flag}${group.card.name} · ${group.card.localId}`
      : `${flag}${group.card.name}`;
    const thumb = cardImage(group.card.image ?? undefined, "low");

    embeds.push({
      title: group.card.setName ? `${name} — ${group.card.setName}` : name,
      description: lines.join("\n"),
      color: COLOR,
      ...(thumb ? { thumbnail: { url: thumb } } : {}),
    });
  }

  return embeds;
}

/** Nombre total d'annonces dans les groupes. */
function countItems(groups: AlertGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

/**
 * Envoie les alertes au webhook. Rend le nombre d'annonces annoncées et une
 * erreur éventuelle — jamais ne lève, pour que la veille traite un webhook muet
 * comme une place de marché en panne : le repère des alertes ne bouge alors pas
 * et les annonces repartent au passage suivant.
 */
export async function sendAlerts(
  groups: AlertGroup[],
): Promise<{ sent: number; error: string | null }> {
  const url = webhookUrl();
  if (!url) return { sent: 0, error: "DISCORD_WEBHOOK_URL absent" };

  const embeds = buildEmbeds(groups);
  if (embeds.length === 0) return { sent: 0, error: null };

  const total = countItems(groups);
  const shown = embeds.reduce((n, embed) => n + embed.description.split("\n").length, 0);
  const header = `🔔 **${plural(total, "nouvelle annonce", "nouvelles annonces")}**`;
  const footer = total > shown ? `\n… et ${plural(total - shown, "autre")}, sur le site.` : "";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "PokeBroc",
        content: header + footer,
        embeds,
        allowed_mentions: { parse: [] },
      }),
    });
    if (!response.ok) {
      return { sent: 0, error: `Discord a refusé (HTTP ${response.status}).` };
    }
    return { sent: shown, error: null };
  } catch (error) {
    return { sent: 0, error: error instanceof Error ? error.message : "Discord injoignable." };
  }
}

/**
 * Un mot de test, pour vérifier que le webhook pointe bien où il faut depuis la
 * page Alertes. Rend l'erreur plutôt que de lever.
 */
export async function sendTest(): Promise<{ ok: boolean; error?: string }> {
  const url = webhookUrl();
  if (!url) return { ok: false, error: "Aucun webhook configuré." };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "PokeBroc",
        content: "✅ PokeBroc est bien branché sur ce salon. Les alertes arriveront ici.",
        allowed_mentions: { parse: [] },
      }),
    });
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Discord injoignable." };
  }
}
