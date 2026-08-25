/**
 * Bot Telegram — le canal des alertes.
 *
 * Choisi pour ce qu'il ne demande pas. Le Web Push voudrait un service worker,
 * des clés VAPID et surtout du HTTPS, que ce site n'a pas. L'e-mail partirait
 * d'une IP résidentielle, donc en indésirables, à moins de louer un relais —
 * c'est-à-dire d'ajouter le service tiers que le projet a évité partout
 * ailleurs. Telegram n'attend qu'un POST sortant : ni certificat, ni port
 * ouvert, ni dépendance ajoutée. Le site en compte toujours trois.
 *
 * Aucun webhook non plus : c'est la veille qui va chercher les messages
 * (`getUpdates`), au rythme de son balayage. Un webhook exigerait une adresse
 * publique, ce qui ferait rentrer le problème du HTTPS par la fenêtre.
 *
 * Facultatif, comme les clés eBay : sans `TELEGRAM_BOT_TOKEN`, la veille
 * continue de balayer — ce qui garde le badge « nouveau » honnête — et se
 * contente de ne rien envoyer.
 */

const API = "https://api.telegram.org";

const TIMEOUT_MS = 15_000;

/** Telegram refuse au-delà. On découpe plutôt que de tronquer : voir `chunk`. */
export const MAX_MESSAGE = 4096;

export function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function isConfigured(): boolean {
  return botToken() !== null;
}

/**
 * Nom du bot, sans `@`. Facultatif, et purement cosmétique côté serveur : il
 * n'existe que pour fabriquer le lien profond `t.me/<bot>?start=<code>`, qui
 * ouvre Telegram avec le code déjà saisi. Sans lui, la page Alertes retombe sur
 * la consigne manuelle — recopier six caractères dans la conversation.
 *
 * Il pourrait être déduit d'un appel à `getMe`, mais ce serait une requête
 * sortante à chaque rendu de la page pour une chaîne qui ne change jamais.
 */
export function botName(): string | null {
  return process.env.TELEGRAM_BOT_NAME?.trim().replace(/^@/, "") || null;
}

interface Envelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function call<T>(method: string, payload: unknown): Promise<T> {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN absent.");

  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = (await response.json().catch(() => null)) as Envelope<T> | null;

  if (!body?.ok) {
    // `description` porte le motif réel — « chat not found », « bot was blocked
    // by the user », « Unauthorized ». Le code HTTP seul ne distingue pas un
    // jeton invalide d'un destinataire qui a supprimé la conversation, et
    // c'est précisément la différence qu'on veut lire dans le journal.
    throw new Error(body?.description ?? `HTTP ${response.status} sur ${method}`);
  }

  return body.result as T;
}

/* ------------------------------------------------------------------ envoi */

/**
 * Échappe ce que `parse_mode: "HTML"` interpréterait.
 *
 * Les titres d'annonces viennent des vendeurs : un « <3 » dans un titre Vinted
 * suffirait à faire rejeter tout le message par Telegram, et l'alerte serait
 * perdue sans que rien ne le dise.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;",
  );
}

/**
 * Regroupe des lignes en messages tenant dans la limite de Telegram.
 *
 * Le découpage se fait sur les sauts de ligne, jamais au milieu : couper à
 * 4096 octets pile trancherait une balise `<a>` en deux et rendrait le message
 * illisible — Telegram le refuserait même, faute de balise fermante.
 */
export function chunk(lines: string[], max = MAX_MESSAGE): string[] {
  const messages: string[] = [];
  let current: string[] = [];
  let length = 0;

  for (const line of lines) {
    // +1 pour le saut de ligne qui joindra cette ligne à la précédente.
    const cost = line.length + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && length + cost > max) {
      messages.push(current.join("\n"));
      current = [];
      length = 0;
    }
    current.push(line);
    length += current.length > 1 ? line.length + 1 : line.length;
  }

  if (current.length > 0) messages.push(current.join("\n"));
  return messages;
}

export async function sendMessage(chatId: string, html: string): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    // Sans cela, Telegram déplie la première annonce en image et description
    // sur dix lignes, et enterre les neuf autres sous le pli.
    link_preview_options: { is_disabled: true },
  });
}

/* ---------------------------------------------------------------- réception */

export interface Update {
  /** Numéro de séquence Telegram. L'accuser vaut acquittement — voir `getUpdates`. */
  updateId: number;
  chatId: string;
  text: string;
}

interface RawUpdate {
  update_id: number;
  message?: { chat?: { id?: number | string }; text?: string };
}

/**
 * Messages reçus depuis `offset`, sans long polling.
 *
 * Telegram ne conserve un message que jusqu'à ce qu'on demande un `offset`
 * supérieur : c'est l'accusé de réception. L'appelant doit donc mémoriser
 * `updateId + 1` **après** avoir traité le lot, sinon un appairage se perdrait
 * au premier plantage.
 *
 * `timeout: 0` parce que la veille passe et repart : elle n'a pas trente
 * secondes à attendre qu'un message arrive, elle regarde ce qu'il y a et
 * enchaîne sur le balayage.
 */
export async function getUpdates(offset: number): Promise<Update[]> {
  const raw = await call<RawUpdate[]>("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["message"],
  });

  return raw
    .map((update) => ({
      updateId: update.update_id,
      chatId: String(update.message?.chat?.id ?? ""),
      text: (update.message?.text ?? "").trim(),
    }))
    .filter((update) => update.chatId !== "" && update.text !== "");
}
