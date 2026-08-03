/**
 * Mémoire des annonces déjà rencontrées, carte par carte.
 *
 * Deux usages, tous deux impossibles sans persistance :
 *
 * 1. **Le badge « nouveau »** — sans trace du passé, un utilisateur qui revient
 *    trois fois par jour rescanne à l'œil les mêmes deux cents vignettes. La
 *    date de première apparition est la seule information qui rende le fil
 *    consultable dans la durée.
 * 2. **Les prix réellement pratiqués** — Cardmarket publie une cote, pas ce que
 *    les vendeurs Vinted demandent. En enregistrant chaque annonce croisée, on
 *    obtient gratuitement la distribution des prix observés, qui est la vraie
 *    référence pour juger d'une affaire.
 *
 * Une entrée par annonce et par carte : la même annonce peut légitimement
 * remonter sur deux cartes différentes, avec une pertinence différente.
 */

import path from "node:path";
import { DATA_DIR, readJson, safeFileName, serialize, writeJson } from "./json-file";

const DIR = path.join(DATA_DIR, "sightings");

/** Au-delà, une annonce n'est plus représentative du marché courant. */
const RETENTION_DAYS = 120;
/** Garde-fou de taille : on ne conserve que les plus récemment vues. */
const MAX_ENTRIES = 1_500;

const DAY_MS = 24 * 3600 * 1000;

export interface Sighting {
  /** Première apparition, en ms epoch. */
  first: number;
  /** Dernière apparition. */
  last: number;
  /** Prix total (frais inclus) au dernier passage. */
  price: number | null;
  /**
   * L'annonce citait le nom **et** le numéro ou l'extension. Seules ces
   * annonces-là entrent dans les statistiques de prix : une correspondance
   * approximative parle d'une autre carte, et fausserait la médiane.
   */
  strong: boolean;
}

interface CardSightings {
  cardId: string;
  items: Record<string, Sighting>;
}

function file(cardId: string): string {
  return path.join(DIR, `${safeFileName(cardId)}.json`);
}

async function load(cardId: string): Promise<CardSightings> {
  const parsed = await readJson<Partial<CardSightings>>(file(cardId));
  const items = parsed?.items && typeof parsed.items === "object" ? parsed.items : {};
  return { cardId, items: migrate(items) };
}

/**
 * Les identifiants étaient les seuls numéros d'annonce Vinted, avant qu'eBay ne
 * rejoigne le fil et n'impose un préfixe de provenance. Sans cette reprise, tout
 * un historique deviendrait illisible d'un coup : chaque annonce déjà connue
 * repasserait pour nouvelle, et le badge « nouveau » — dont tout l'intérêt est
 * de ne pas se déclencher à tort — perdrait sa crédibilité au premier
 * déploiement.
 */
function migrate(items: Record<string, Sighting>): Record<string, Sighting> {
  return Object.fromEntries(
    Object.entries(items).map(([key, sighting]) => [
      /^\d+$/.test(key) ? `vinted:${key}` : key,
      sighting,
    ]),
  );
}

/** Annonce telle qu'on la reçoit du fil, réduite à ce qu'on archive. */
export interface SeenItem {
  /** Identifiant préfixé par la source : `vinted:123`, `ebay:v1|456|0`. */
  id: string;
  price: number | null;
  strong: boolean;
}

/**
 * Consigne les annonces vues à l'instant et renvoie, pour chacune, la date de
 * sa première apparition.
 *
 * Cette date est la valeur qui alimente le badge « nouveau » ; elle est donc
 * rendue à l'appelant plutôt que relue plus tard, pour qu'un même passage
 * n'écrive et ne lise pas deux fois le même fichier.
 */
export async function recordSightings(
  cardId: string,
  items: SeenItem[],
  now = Date.now(),
): Promise<Map<string, number>> {
  const firstSeen = new Map<string, number>();
  if (items.length === 0) return firstSeen;

  await serialize(`sightings:${cardId}`, async () => {
    const data = await load(cardId);

    for (const item of items) {
      const key = item.id;
      const known = data.items[key];
      if (known) {
        known.last = now;
        known.price = item.price;
        // Une annonce peut passer de « large » à « forte » si le score change ;
        // l'inverse n'a pas de sens et effacerait un historique valide.
        known.strong ||= item.strong;
        firstSeen.set(item.id, known.first);
      } else {
        data.items[key] = { first: now, last: now, price: item.price, strong: item.strong };
        firstSeen.set(item.id, now);
      }
    }

    prune(data, now);
    await writeJson(file(cardId), data);
  });

  return firstSeen;
}

function prune(data: CardSightings, now: number): void {
  const cutoff = now - RETENTION_DAYS * DAY_MS;
  let entries = Object.entries(data.items).filter(([, sighting]) => sighting.last >= cutoff);

  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b[1].last - a[1].last);
    entries = entries.slice(0, MAX_ENTRIES);
  }

  data.items = Object.fromEntries(entries);
}

/* ------------------------------------------------------------ statistiques */

export interface PriceStats {
  /** Annonces distinctes retenues sur la fenêtre. */
  count: number;
  median: number | null;
  min: number | null;
  max: number | null;
  /** Largeur de la fenêtre, en jours. */
  days: number;
  /** Première observation, toutes fenêtres confondues. */
  since: number | null;
}

export function summarize(sightings: Sighting[], days: number, now = Date.now()): PriceStats {
  const cutoff = now - days * DAY_MS;
  const prices = sightings
    .filter((s) => s.strong && s.last >= cutoff && typeof s.price === "number" && s.price > 0)
    .map((s) => s.price as number)
    .sort((a, b) => a - b);

  const since = sightings.length > 0 ? Math.min(...sightings.map((s) => s.first)) : null;

  if (prices.length === 0) {
    return { count: 0, median: null, min: null, max: null, days, since };
  }

  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 1 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;

  return {
    count: prices.length,
    median: Math.round(median * 100) / 100,
    min: prices[0],
    max: prices[prices.length - 1],
    days,
    since,
  };
}

/** Distribution des prix observés pour une carte, sur les `days` derniers jours. */
export async function priceStats(cardId: string, days = 30, now = Date.now()): Promise<PriceStats> {
  const data = await load(cardId);
  return summarize(Object.values(data.items), days, now);
}
