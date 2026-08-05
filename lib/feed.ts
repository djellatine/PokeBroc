/**
 * Instantanés du fil d'annonces, un fichier par carte.
 *
 * Avant, chaque chargement de page relançait une recherche par carte,
 * sérialisées à 350 ms : vingt cartes suivies, c'était sept secondes d'attente
 * refaites à chaque visite, par chaque visiteur. Le travail est désormais fait
 * une fois toutes les dix minutes et rangé sur le disque ; la page se rend
 * depuis ce cache, et ne rafraîchit en arrière-plan que les cartes périmées.
 *
 * Deux passes par place de marché, exécutées ici plutôt que sur demande du
 * client : le tri par nouveauté ne sert pas qu'au tri « derniers ajouts », c'est
 * aussi le seul classement qui fasse remonter une annonce fraîche encore mal
 * positionnée en pertinence — donc la condition d'un badge « nouveau » fiable.
 *
 * Vinted et eBay sont collectés indépendamment et fusionnés : une panne d'un
 * côté ne doit pas vider le fil de l'autre, ni empêcher d'écrire l'instantané.
 */

import path from "node:path";
import { isConfigured as hasEbay, searchEbay, type EbayItem } from "./ebay";
import { DATA_DIR, readJson, safeFileName, serialize, writeJson } from "./json-file";
import {
  bestQuery,
  condition,
  scoreAll,
  WIDE_SCORE,
  STRONG_SCORE,
  type Condition,
  type Scored,
} from "./match";
import { recordSightings } from "./sightings";
import type { FavoriteCard } from "./store";
import { getCard, type CardDetail } from "./tcgdex";
import { searchVinted, type VintedItem } from "./vinted";

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
/**
 * Réexporté pour les nombreux `import type { Source } from "./feed"` déjà en
 * place. La définition vit dans `source.ts`, sans dépendance : voir son
 * en-tête — l'importer *comme valeur* depuis ici entraînerait `node:fs/promises`
 * dans le paquet client.
 */
import type { Source } from "./source";
export type { Source };

export interface FeedItem {
  /** Préfixé par la source : deux places de marché numérotent chacune de son côté. */
  id: string;
  source: Source;
  cardId: string;
  title: string;
  url: string;
  thumbnail: string | null;
  price: number | null;
  totalPrice: number | null;
  condition: Condition;
  promoted: boolean;
  favourites: number;
  /** Mise en ligne, en ms epoch. Date réelle sur eBay, horodatage de la photo sur Vinted. */
  createdAt: number | null;
  score: number;
  graded: boolean;
  bulk: boolean;
  trend: number | null;
  vsMarket: number | null;
  /**
   * Pays de l'objet, quand la source le déclare — eBay le fait, Vinted non.
   * C'est le seul signal fiable de provenance : le filtre « français
   * uniquement » s'y fie avant de retomber sur la langue du titre.
   */
  country: string | null;
  /** Enchère en cours : le prix affiché n'est pas un prix demandé. */
  auction: boolean;
  bids: number;
  /** Fin de l'enchère, en ms epoch. */
  endsAt: number | null;
  /** Première fois que *nous* avons croisé cette annonce, en ms epoch. */
  firstSeen: number;
}

export interface Snapshot {
  card: FeedCard;
  /** Date de la collecte, en ms epoch. */
  at: number;
  query: string;
  items: FeedItem[];
  /** Renseigné quand *toutes* les places de marché ont échoué ; l'instantané précédent est conservé. */
  error?: string;
  /**
   * Renseigné quand une seule place de marché a échoué. L'instantané est
   * valide — `isFresh` le laisse donc passer — mais incomplet, et le fil le dit.
   */
  partial?: string;
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
  if (!snapshot?.items || !Array.isArray(snapshot.items)) return null;

  // Instantané écrit avant l'arrivée d'eBay : ses annonces n'ont pas de
  // provenance, donc pas de pastille et un identifiant qui ne correspond plus à
  // rien dans le journal. On le traite comme absent — la carte sera recollectée
  // au prochain passage, ce qui coûte une recherche et remet tout d'aplomb.
  if (snapshot.items.some((item) => item.source === undefined)) return null;

  return snapshot;
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

/** Annonce prête pour le fil, avant qu'on sache depuis quand on la connaît. */
type PendingItem = Omit<FeedItem, "firstSeen">;

/** Champs communs aux deux places de marché, une fois l'annonce notée. */
function common(
  item: Scored<VintedItem> | Scored<EbayItem>,
  cardId: string,
): Omit<PendingItem, "id" | "source" | "country" | "auction" | "bids" | "endsAt"> {
  return {
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
    score: item.match.score,
    graded: item.match.graded,
    bulk: item.match.bulk,
    trend: item.trend,
    vsMarket: item.vsMarket,
  };
}

function fromVinted(item: Scored<VintedItem>, cardId: string): PendingItem {
  return {
    ...common(item, cardId),
    id: `vinted:${item.id}`,
    source: "vinted",
    // Le catalogue Vinted ne dit ni le pays du vendeur ni celui de l'objet.
    country: null,
    auction: false,
    bids: 0,
    endsAt: null,
  };
}

function fromEbay(item: Scored<EbayItem>, cardId: string): PendingItem {
  return {
    ...common(item, cardId),
    id: `ebay:${item.id}`,
    source: "ebay",
    country: item.country,
    auction: item.auction,
    bids: item.bids,
    endsAt: item.endsAt,
    // Une enchère en cours n'a pas de prix demandé : à trois jours de la fin,
    // un Dracaufeu à 1 € afficherait −99 % et raflerait toutes les « meilleures
    // affaires », exactement comme le faisaient les reproductions à 3 €. On
    // laisse donc l'écart vide plutôt que faux ; le fil affiche l'enchère et son
    // nombre d'offres, et le lecteur juge.
    vsMarket: item.auction ? null : item.vsMarket,
  };
}

/**
 * Deux passes sur une place de marché, fusionnées.
 *
 * Rend toujours une liste, même vide : l'erreur éventuelle est retournée à
 * l'appelant plutôt que propagée, pour qu'une place de marché en panne
 * n'emporte pas l'autre.
 */
async function collect(
  source: Source,
  card: CardDetail,
  query: string,
  /** Ignorer le cache de réponses des places de marché — voir `refreshCard`. */
  live = false,
): Promise<{ items: PendingItem[]; error: string | null }> {
  try {
    // Les deux passes partent ensemble ; les clients les sérialisent de toute
    // façon, mais on n'attend pas la première pour poster la seconde.
    if (source === "vinted") {
      const [relevant, newest] = await Promise.all([
        searchVinted({ query, order: "relevance", perPage: 48, fresh: live }),
        searchVinted({ query, order: "newest_first", perPage: 48, fresh: live }),
      ]);
      const scored = scoreAll([...relevant.items, ...newest.items], card);
      return { items: scored.map((item) => fromVinted(item, card.id)), error: null };
    }

    const [relevant, newest] = await Promise.all([
      searchEbay({ query, order: "best_match", perPage: 50, fresh: live }),
      searchEbay({ query, order: "newly_listed", perPage: 50, fresh: live }),
    ]);
    const scored = scoreAll([...relevant.items, ...newest.items], card);
    return { items: scored.map((item) => fromEbay(item, card.id)), error: null };
  } catch (error) {
    const label = source === "vinted" ? "Vinted" : "eBay";
    const message = error instanceof Error ? error.message : `Recherche ${label} impossible.`;
    return { items: [], error: `${label} : ${message}` };
  }
}

/**
 * Relance la collecte pour une carte et réécrit son instantané.
 *
 * Sérialisé par carte : deux visiteurs arrivant en même temps sur une carte
 * périmée ne déclenchent qu'une collecte, le second récupérant l'instantané que
 * le premier vient d'écrire.
 *
 * @param force Passer outre la validité de dix minutes. C'est ce que demande le
 *              bouton « Actualiser » : sans lui, recharger la page pendant ces
 *              dix minutes rendait invariablement le même instantané, et une
 *              annonce parue entre-temps restait invisible sans qu'on puisse
 *              rien y faire. Le délai entre deux forçages est tenu par la route,
 *              qui seule connaît le demandeur.
 */
export async function refreshCard(
  favorite: FavoriteCard,
  now = Date.now(),
  force = false,
): Promise<Snapshot> {
  return serialize(`feed:${favorite.cardId}`, async () => {
    const existing = await readSnapshot(favorite.cardId);
    if (!force && isFresh(existing, now)) return existing as Snapshot;

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

    // Sans clés eBay, le site fonctionne sur Vinted seul plutôt que de signaler
    // une erreur de collecte à chaque carte.
    const sources: Source[] = hasEbay() ? ["vinted", "ebay"] : ["vinted"];
    const collected = await Promise.all(
      sources.map((source) => collect(source, card, query, force)),
    );

    const errors = collected.map((result) => result.error).filter((msg) => msg !== null);

    // Tout est en panne : on republie l'instantané précédent, qui vaut mieux
    // qu'un fil vide, en signalant l'échec.
    if (errors.length === sources.length) {
      const failed: Snapshot = {
        card: feedCard,
        at: now,
        query,
        items: existing?.items ?? [],
        error: errors.join(" · "),
      };
      await writeJson(file(card.id), failed);
      return failed;
    }

    // La même annonce revient dans les deux passes : on garde la meilleure note.
    // Les identifiants étant préfixés par la source, Vinted et eBay ne peuvent
    // pas se recouvrir ici.
    const best = new Map<string, PendingItem>();
    for (const item of collected.flatMap((result) => result.items)) {
      const known = best.get(item.id);
      if (!known || item.score > known.score) best.set(item.id, item);
    }

    const kept = [...best.values()]
      .filter((item) => item.score >= WIDE_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PER_CARD);

    const firstSeen = await recordSightings(
      card.id,
      kept.map((item) => ({
        id: item.id,
        price: item.totalPrice ?? item.price,
        strong: item.score >= STRONG_SCORE,
      })),
      now,
    );

    const snapshot: Snapshot = {
      card: feedCard,
      at: now,
      query,
      items: kept.map((item) => ({ ...item, firstSeen: firstSeen.get(item.id) ?? now })),
      // Une seule place de marché en panne : le fil reste servi par l'autre, et
      // l'instantané reste daté de maintenant — le signaler sans le traiter
      // comme un échec de collecte, sinon la carte serait rejouée en boucle.
      ...(errors.length > 0 ? { partial: errors.join(" · ") } : {}),
    };
    await writeJson(file(card.id), snapshot);
    return snapshot;
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
