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
 * Messages qu'un passage peut poster. Huit messages, c'est deux cents annonces :
 * au-delà, il s'est passé quelque chose d'anormal — une panne de plusieurs
 * heures qui se rattrape — et le lecteur préfère un renvoi au site.
 */
export const MAX_MESSAGES = 8;

export interface DiscordMessage {
  content: string;
  embeds: DiscordEmbed[];
}

/**
 * Découpe les alertes en messages, chacun sous les plafonds de Discord.
 *
 * Avant, un seul message partait, et tout ce qui dépassait ses vingt-cinq
 * annonces n'était que compté — « … et 14 autres, sur le site » — puis marqué
 * comme annoncé. Les annonces au-delà de la vingt-cinquième n'étaient donc
 * jamais citées, alors qu'une rafale est précisément le moment où l'on veut
 * tout voir : après une panne de Vinted, ou une soirée où vingt vendeurs
 * postent. On poste désormais autant de messages qu'il faut, et le renvoi au
 * site ne vaut plus que passé `MAX_MESSAGES`.
 *
 * Une carte aux nombreuses annonces peut s'étaler sur deux messages ; chaque
 * message garde au plus `MAX_EMBEDS` cartes et `MAX_ALERTS` annonces.
 */
export function buildMessages(
  groups: AlertGroup[],
  perMessage = MAX_ALERTS,
  maxMessages = MAX_MESSAGES,
): { messages: DiscordMessage[]; shown: number; total: number } {
  const total = countItems(groups);

  // Tranches de groupes, chacune sous les deux plafonds.
  const chunks: AlertGroup[][] = [];
  let chunk: AlertGroup[] = [];
  let items = 0;
  const close = () => {
    if (chunk.length > 0) chunks.push(chunk);
    chunk = [];
    items = 0;
  };
  for (const group of groups) {
    let offset = 0;
    while (offset < group.items.length) {
      if (chunk.length >= MAX_EMBEDS || items >= perMessage) close();
      const slice = group.items.slice(offset, offset + (perMessage - items));
      chunk.push({ card: group.card, items: slice });
      items += slice.length;
      offset += slice.length;
    }
  }
  close();

  const kept = chunks.slice(0, maxMessages);
  let shown = 0;
  const messages = kept.map((part, index) => {
    const embeds = buildEmbeds(part, perMessage);
    shown += embeds.reduce((n, embed) => n + embed.description.split("\n").length, 0);
    const header = `🔔 **${plural(total, "nouvelle annonce", "nouvelles annonces")}**`;
    const page = kept.length > 1 ? ` (${index + 1}/${kept.length})` : "";
    const footer =
      index === kept.length - 1 && total > shown
        ? `\n… et ${plural(total - shown, "autre")}, sur le site.`
        : "";
    return { content: header + page + footer, embeds };
  });

  return { messages, shown, total };
}

/** Discord admet une trentaine de messages par minute sur un webhook : on ne se presse pas. */
const BETWEEN_MESSAGES_MS = 1_200;

/**
 * Envoie les alertes au webhook. Rend le nombre d'annonces annoncées et une
 * erreur éventuelle — jamais ne lève, pour que la veille traite un webhook muet
 * comme une place de marché en panne : le repère des alertes ne bouge alors pas
 * et les annonces repartent au passage suivant.
 *
 * Plusieurs messages s'il le faut. Un échec en cours de route rend l'erreur,
 * et le repère ne bouge pas : les annonces déjà postées repartiront au passage
 * suivant, en doublon — le prix d'une règle simple, et un cas rare.
 */
export async function sendAlerts(
  groups: AlertGroup[],
): Promise<{ sent: number; error: string | null }> {
  const url = webhookUrl();
  if (!url) return { sent: 0, error: "DISCORD_WEBHOOK_URL absent" };

  const { messages, shown } = buildMessages(groups);
  if (messages.length === 0) return { sent: 0, error: null };

  for (const [index, message] of messages.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, BETWEEN_MESSAGES_MS));
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "PokeBroc",
          ...message,
          allowed_mentions: { parse: [] },
        }),
      });
      if (!response.ok) {
        return { sent: 0, error: `Discord a refusé (HTTP ${response.status}).` };
      }
    } catch (error) {
      return { sent: 0, error: error instanceof Error ? error.message : "Discord injoignable." };
    }
  }
  return { sent: shown, error: null };
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
