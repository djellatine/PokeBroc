/**
 * Copie locale des fiches de cartes, un fichier par carte dans `.data/cards/`.
 *
 * La veille de la tablette a passé la journée du 3 septembre 2026 aveugle :
 * « 47 cartes balayées, 0 alerte envoyée — 48 erreurs : Carte introuvable
 * dans la base TCGdex », à presque chaque passage, alors que TCGdex répondait
 * en 350 ms dès qu'on l'interrogeait à la main. Un hoquet intermittent du
 * catalogue — il en a — suffisait à rendre *chaque* carte introuvable, donc à
 * ne rien collecter et ne rien annoncer, parce que rien ne retenait la fiche
 * lue au passage précédent. Or une fiche ne change presque jamais : le nom, le
 * numéro et l'extension sont gravés ; seule la cote bouge, d'un jour à l'autre.
 *
 * D'où cette copie. `loadCard` sert la fiche du disque tant qu'elle a moins de
 * six heures, ne va au catalogue qu'ensuite, et retombe sur la copie — même
 * vieille — quand le catalogue ne répond pas. Le catalogue reçoit ainsi une
 * requête par carte et par six heures au lieu de deux par quart d'heure, ce
 * qui, si ses refus venaient d'un excès de zèle contre notre adresse, règle
 * aussi la cause.
 *
 * Le site en profite de la même façon : hors de Next, `fetch` n'a aucun cache,
 * et la veille est précisément hors de Next.
 */

import path from "node:path";
import { DATA_DIR, readJson, safeFileName, writeJson } from "./json-file";
import { fetchCardDetail, type CardDetail } from "./tcgdex";

const DIR = path.join(DATA_DIR, "cards");

/** Au-delà, on retourne au catalogue — pour la cote, qui bouge chaque jour. */
export const CARD_FRESH_MS = 6 * 60 * 60 * 1000;

export interface CachedCard {
  /** Date de lecture au catalogue, en ms epoch. */
  at: number;
  card: CardDetail;
}

function file(cardId: string): string {
  return path.join(DIR, `${safeFileName(cardId)}.json`);
}

export async function readCardCache(cardId: string): Promise<CachedCard | null> {
  const cached = await readJson<CachedCard>(file(cardId));
  return cached?.card && typeof cached.at === "number" ? cached : null;
}

export async function writeCardCache(cardId: string, card: CardDetail, at = Date.now()): Promise<void> {
  await writeJson(file(cardId), { at, card } satisfies CachedCard);
}

export interface LoadedCard {
  card: CardDetail | null;
  /** D'où vient la fiche : lue à l'instant, ou reprise du disque. */
  source: "catalogue" | "copie";
  /** Copie plus vieille que `CARD_FRESH_MS`, servie faute de mieux. */
  stale: boolean;
  /** Ce que le catalogue a répondu quand il n'a pas répondu — pour le journal. */
  error: string | null;
}

/**
 * Fiche d'une carte, du disque d'abord, du catalogue ensuite.
 *
 * `card` n'est nul que si le catalogue dit que la carte n'existe pas *et*
 * qu'aucune copie n'en existe — ou qu'il est injoignable sans copie, auquel
 * cas `error` le dit. Une copie même périmée vaut mieux qu'une collecte
 * blanche : la cote y a peut-être un jour de retard, l'annonce, elle, sera vue.
 */
export async function loadCard(
  cardId: string,
  now = Date.now(),
  maxAge = CARD_FRESH_MS,
): Promise<LoadedCard> {
  const cached = await readCardCache(cardId);
  if (cached && now - cached.at < maxAge) {
    return { card: cached.card, source: "copie", stale: false, error: null };
  }

  const { card, error } = await fetchCardDetail(cardId);
  if (card) {
    await writeCardCache(cardId, card, now).catch(() => undefined);
    return { card, source: "catalogue", stale: false, error: null };
  }

  if (cached) return { card: cached.card, source: "copie", stale: true, error };
  return { card: null, source: "catalogue", stale: false, error };
}
