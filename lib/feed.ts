/**
 * Instantanés du fil d'annonces, un fichier par carte.
 *
 * Avant, chaque chargement de page relançait une recherche Vinted par carte,
 * sérialisées à 350 ms : vingt cartes suivies, c'était sept secondes d'attente
 * refaites à chaque visite, par chaque visiteur. Le travail est désormais fait
 * une fois toutes les dix minutes et rangé sur le disque ; la page se rend
 * depuis ce cache, et ne rafraîchit en arrière-plan que les cartes périmées.
 *
 * Les deux passes Vinted sont exécutées ici plutôt que sur demande du client :
 * `newest_first` ne sert pas qu'au tri « derniers ajouts », c'est aussi le seul
 * classement qui fasse remonter une annonce fraîche encore mal positionnée en
 * pertinence — donc la condition d'un badge « nouveau » fiable.
 */

import path from "node:path";
import { DATA_DIR, readJson, safeFileName, serialize, writeJson } from "./json-file";
import {
  bestQuery,
  condition,
  scoreAll,
  WIDE_SCORE,
  STRONG_SCORE,
  type Condition,
  type ScoredItem,
} from "./match";
import { recordSightings } from "./sightings";
import type { FavoriteCard } from "./store";
import { getCard } from "./tcgdex";
import { searchVinted } from "./vinted";

const DIR = path.join(DATA_DIR, "feed");

/** Durée de validité d'un instantané. */
export const FRESH_MS = 10 * 60 * 1000;

/**
 * Annonces conservées par carte. Au-delà, on archive du bruit : le classement
 * place les correspondances fortes en tête, et la queue de liste ne cite déjà
 * plus le numéro.
 */
const MAX_PER_CARD = 40;

/** Carte concernée, réduite à ce que le fil affiche. */
export interface FeedCard {
  cardId: string;
  name: string;
  localId: string | null;
  setName: string | null;
  image: string | null;
  /** Cote Cardmarket de référence, en euros. */
  trend: number | null;
}

/**
 * Annonce telle que le fil la manipule.
 *
 * Volontairement plus étroite que `ScoredItem` : ce type traverse le disque puis
 * le réseau jusqu'au navigateur, et les champs inutilisés y coûteraient deux
 * fois.
 */
export interface FeedItem {
  id: number;
  cardId: string;
  title: string;
  url: string;
  thumbnail: string | null;
  price: number | null;
  totalPrice: number | null;
  condition: Condition;
  promoted: boolean;
  favourites: number;
  /** Mise en ligne (horodatage de la photo), en ms epoch. */
  createdAt: number | null;
  seller: string | null;
  score: number;
  graded: boolean;
  bulk: boolean;
  trend: number | null;
  vsMarket: number | null;
  /** Première fois que *nous* avons croisé cette annonce, en ms epoch. */
  firstSeen: number;
}

export interface Snapshot {
  card: FeedCard;
  /** Date de la collecte, en ms epoch. */
  at: number;
  query: string;
  items: FeedItem[];
  /** Renseigné quand la collecte a échoué ; l'instantané précédent est conservé. */
  error?: string;
}

function file(cardId: string): string {
  return path.join(DIR, `${safeFileName(cardId)}.json`);
}

export function isFresh(
  snapshot: Snapshot | null,
  now = Date.now(),
  maxAge = FRESH_MS,
): boolean {
  return snapshot !== null && !snapshot.error && now - snapshot.at < maxAge;
}

export async function readSnapshot(cardId: string): Promise<Snapshot | null> {
  const snapshot = await readJson<Snapshot>(file(cardId));
  return snapshot?.items && Array.isArray(snapshot.items) ? snapshot : null;
}

/** Instantanés disponibles, dans l'ordre de la collection. Aucune requête réseau. */
export async function readSnapshots(favorites: FavoriteCard[]): Promise<Snapshot[]> {
  const found = await Promise.all(favorites.map((favorite) => readSnapshot(favorite.cardId)));
  return found.filter((snapshot): snapshot is Snapshot => snapshot !== null);
}

/** Cartes dont l'instantané manque ou a expiré. */
export function staleCardIds(
  favorites: FavoriteCard[],
  snapshots: Snapshot[],
  now = Date.now(),
): string[] {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.card.cardId, snapshot]));
  return favorites
    .filter((favorite) => !isFresh(byId.get(favorite.cardId) ?? null, now))
    .map((favorite) => favorite.cardId);
}

/* ---------------------------------------------------------------- collecte */

function toFeedItem(item: ScoredItem, cardId: string, firstSeen: number): FeedItem {
  return {
    id: item.id,
    cardId,
    title: item.title,
    url: item.url,
    thumbnail: item.thumbnail,
    price: item.price,
    totalPrice: item.totalPrice,
    condition: condition(item.status),
    promoted: item.promoted,
    favourites: item.favourites,
    createdAt: item.createdAt,
    seller: item.seller.login,
    score: item.match.score,
    graded: item.match.graded,
    bulk: item.match.bulk,
    trend: item.trend,
    vsMarket: item.vsMarket,
    firstSeen,
  };
}

/**
 * Relance la collecte pour une carte et réécrit son instantané.
 *
 * Sérialisé par carte : deux visiteurs arrivant en même temps sur une carte
 * périmée ne déclenchent qu'une collecte, le second récupérant l'instantané que
 * le premier vient d'écrire.
 */
export async function refreshCard(favorite: FavoriteCard, now = Date.now()): Promise<Snapshot> {
  return serialize(`feed:${favorite.cardId}`, async () => {
    const existing = await readSnapshot(favorite.cardId);
    if (isFresh(existing, now)) return existing as Snapshot;

    const card = await getCard(favorite.cardId);
    if (!card) {
      const failed: Snapshot = {
        card: fallbackCard(favorite),
        at: now,
        query: "",
        items: existing?.items ?? [],
        error: "Carte introuvable dans la base TCGdex.",
      };
      await writeJson(file(favorite.cardId), failed);
      return failed;
    }

    const feedCard: FeedCard = {
      cardId: card.id,
      name: card.name,
      localId: card.localId ?? null,
      setName: card.set?.name ?? favorite.setName ?? null,
      image: card.image ?? favorite.image ?? null,
      trend: card.pricing?.cardmarket?.trend ?? card.pricing?.cardmarket?.avg30 ?? null,
    };

    const query = bestQuery(card);

    try {
      // Les deux passes partent ensemble ; `lib/vinted.ts` les sérialise de
      // toute façon, mais on n'attend pas la première pour poster la seconde.
      const [relevant, fresh] = await Promise.all([
        searchVinted({ query, order: "relevance", perPage: 48 }),
        searchVinted({ query, order: "newest_first", perPage: 48 }),
      ]);

      // La même annonce revient dans les deux passes : on garde la meilleure note.
      const best = new Map<number, ScoredItem>();
      for (const item of [...scoreAll(relevant.items, card), ...scoreAll(fresh.items, card)]) {
        const known = best.get(item.id);
        if (!known || item.match.score > known.match.score) best.set(item.id, item);
      }

      const kept = [...best.values()]
        .filter((item) => item.match.score >= WIDE_SCORE)
        .sort((a, b) => b.match.score - a.match.score)
        .slice(0, MAX_PER_CARD);

      const firstSeen = await recordSightings(
        card.id,
        kept.map((item) => ({
          id: item.id,
          price: item.totalPrice ?? item.price,
          strong: item.match.score >= STRONG_SCORE,
        })),
        now,
      );

      const snapshot: Snapshot = {
        card: feedCard,
        at: now,
        query,
        items: kept.map((item) => toFeedItem(item, card.id, firstSeen.get(item.id) ?? now)),
      };
      await writeJson(file(card.id), snapshot);
      return snapshot;
    } catch (error) {
      // Vinted en panne ne doit pas vider le fil : on republie les annonces
      // précédentes en signalant que la collecte a échoué.
      const message = error instanceof Error ? error.message : "Recherche Vinted impossible.";
      const failed: Snapshot = {
        card: feedCard,
        at: now,
        query,
        items: existing?.items ?? [],
        error: message,
      };
      await writeJson(file(card.id), failed);
      return failed;
    }
  });
}

function fallbackCard(favorite: FavoriteCard): FeedCard {
  return {
    cardId: favorite.cardId,
    name: favorite.name,
    localId: favorite.localId,
    setName: favorite.setName,
    image: favorite.image,
    trend: null,
  };
}
