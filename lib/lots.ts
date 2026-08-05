/**
 * Instantanés des lots, un fichier par carte suivie.
 *
 * Module distinct de `feed.ts` plutôt qu'un champ de plus dans son instantané,
 * pour trois raisons qui tiennent toutes à la nature d'un lot :
 *
 * 1. **La requête n'est pas la même.** Le fil cherche « Dracaufeu 4/102 » ; un
 *    lot s'annonce « lot de 200 cartes Pokémon ». Voir `lotQueries`.
 * 2. **La notation est inversée.** `scoreItem` retire deux points au mot
 *    « lot » ; ici il est éliminatoire dans l'autre sens. Voir `scoreLot`.
 * 3. **Le rythme n'est pas le même.** Un lot reste en ligne des semaines, là où
 *    une carte à l'unité part en heures — le collecter aussi souvent que le fil
 *    doublerait les appels aux catalogues pour rien.
 *
 * Fusionner les deux aurait donc imposé de porter partout la distinction
 * « c'est un lot / c'en est pas un », et surtout de rejouer la collecte des
 * lots à chaque expiration du fil.
 */

import path from "node:path";
import { isConfigured as hasEbay, searchEbay } from "./ebay";
import { DATA_DIR, readJson, safeFileName, serialize, writeJson } from "./json-file";
import { isConfigured as hasLbc, searchLbcRecents } from "./lbc";
import {
  condition,
  isPokemonLot,
  lotQueries,
  lotSize,
  scoreLots,
  LOT_SCORE,
  type Condition,
} from "./match";
import { SOURCE_NAMES, type FeedCard, type Source } from "./feed";
import type { FavoriteCard } from "./store";
import { getCard, type CardDetail } from "./tcgdex";
import { searchVinted } from "./vinted";

const DIR = path.join(DATA_DIR, "lots");

/**
 * Durée de validité : dix-huit fois celle du fil.
 *
 * Un lot à 300 cartes n'est pas une bonne affaire qui s'évapore en dix minutes.
 * Il reste en ligne des semaines, souvent jusqu'à négociation — le rafraîchir
 * au rythme du fil coûterait des appels aux catalogues sans rien montrer de
 * neuf. Le rythme doit suivre celui des *mises en ligne*, pas celui des
 * disparitions.
 *
 * Trente minutes, valeur précédente, était calquée sur le fil par symétrie
 * plutôt que sur ce que la collecte rapporte réellement. Trois heures s'aligne
 * sur ce qui a été mesuré côté leboncoin : une requête *générique* produit une
 * trentaine de mises en ligne par heure, et une requête de lot par carte —
 * « lot Dracaufeu », bien plus étroite — en produit quelques-unes par jour. À
 * trente minutes, la quasi-totalité des collectes réécrivait le même
 * instantané.
 *
 * Aucun effet sur une carte qu'on vient d'ajouter : sans instantané, elle est
 * périmée d'emblée et collectée au premier affichage.
 */
export const LOTS_FRESH_MS = 3 * 60 * 60 * 1000;

/** Lots conservés par carte. La queue de liste ne cite déjà plus la carte. */
const MAX_PER_CARD = 20;

/**
 * Lot tel que la section l'affiche.
 *
 * Trois champs de `FeedItem` manquent, et leur absence est le sujet même de ce
 * module : `trend` et `vsMarket` compareraient le prix d'un lot entier à la
 * cote d'une carte unique — un lot de 200 cartes à 60 € afficherait « −85 % »
 * et raflerait le classement sans rien vouloir dire. `firstSeen` manque parce
 * qu'on n'archive pas les lots ; voir `refreshLots`.
 */
export interface LotItem {
  /** Préfixé par la source, comme dans le fil : `vinted:123`, `ebay:v1|456|0`. */
  id: string;
  source: Source;
  /**
   * Carte de la collection à laquelle le lot a été rattaché, `null` dans le
   * flux des lots récents — qui ne part d'aucune carte, et dont c'est tout
   * l'intérêt : on ne sait pas encore ce qu'il y a dedans.
   */
  cardId: string | null;
  title: string;
  url: string;
  thumbnail: string | null;
  price: number | null;
  totalPrice: number | null;
  condition: Condition;
  promoted: boolean;
  favourites: number;
  createdAt: number | null;
  score: number;
  /** Pays de l'objet quand la source le déclare — eBay le fait, Vinted non. */
  country: string | null;
  auction: boolean;
  bids: number;
  endsAt: number | null;
  /** Nombre de cartes annoncé par le titre, `null` s'il n'en donne pas. */
  quantity: number | null;
  /**
   * Prix par carte, en euros. La seule grandeur qui rende deux lots
   * comparables — et elle n'existe que si le titre a annoncé une quantité.
   */
  perCard: number | null;
}

export interface LotSnapshot {
  card: FeedCard;
  /** Date de la collecte, en ms epoch. */
  at: number;
  /** Requêtes employées, dans l'ordre. Affichées nulle part, utiles au débogage. */
  queries: string[];
  items: LotItem[];
  /** Renseigné quand *toutes* les places de marché ont échoué. */
  error?: string;
  /** Renseigné quand une seule a échoué : l'instantané est valide mais incomplet. */
  partial?: string;
}

function file(cardId: string): string {
  return path.join(DIR, `${safeFileName(cardId)}.json`);
}

export function isFresh(
  snapshot: LotSnapshot | null,
  now = Date.now(),
  maxAge = LOTS_FRESH_MS,
): boolean {
  return snapshot !== null && !snapshot.error && now - snapshot.at < maxAge;
}

export async function readLotSnapshot(cardId: string): Promise<LotSnapshot | null> {
  const snapshot = await readJson<LotSnapshot>(file(cardId));
  if (!snapshot?.items || !Array.isArray(snapshot.items)) return null;
  return snapshot;
}

/** Instantanés disponibles, dans l'ordre de la collection. Aucune requête réseau. */
export async function readLotSnapshots(favorites: FavoriteCard[]): Promise<LotSnapshot[]> {
  const found = await Promise.all(favorites.map((favorite) => readLotSnapshot(favorite.cardId)));
  return found.filter((snapshot): snapshot is LotSnapshot => snapshot !== null);
}

/** Cartes dont l'instantané de lots manque ou a expiré. */
export function staleLotCardIds(
  favorites: FavoriteCard[],
  snapshots: LotSnapshot[],
  now = Date.now(),
): string[] {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.card.cardId, snapshot]));
  return favorites
    .filter((favorite) => !isFresh(byId.get(favorite.cardId) ?? null, now))
    .map((favorite) => favorite.cardId);
}

/* ---------------------------------------------------------------- collecte */

/** Prix par carte, arrondi au centime. */
function perCard(price: number | null, quantity: number | null): number | null {
  if (price === null || quantity === null || quantity <= 0) return null;
  return Math.round((price / quantity) * 100) / 100;
}

/**
 * Champs communs aux deux places de marché. Déclaré structurellement plutôt
 * qu'en union de `VintedItem | EbayItem` : le flux des lots récents construit
 * des `LotItem` sans passer par la notation, donc sans `Scored<>`.
 */
type MarketItem = {
  id: string | number;
  title: string;
  url: string;
  thumbnail: string | null;
  price: number | null;
  totalPrice: number | null;
  status: string | null;
  promoted: boolean;
  favourites: number;
  createdAt: number | null;
};

/**
 * La note est passée à part plutôt que lue dans `item.match` : elle vient de
 * `scoreLot` pour les lots d'une carte, et n'existe pas pour le flux récent,
 * qui n'a aucune carte à laquelle se comparer.
 */
function toLot(
  item: MarketItem,
  cardId: string | null,
  source: Source,
  score: number,
  extra: Pick<LotItem, "country" | "auction" | "bids" | "endsAt">,
): LotItem {
  const quantity = lotSize(item.title);
  const total = item.totalPrice ?? item.price;

  return {
    id: `${source}:${item.id}`,
    source,
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
    score,
    quantity,
    // Une enchère en cours n'a pas de prix demandé : son prix par carte
    // baisserait mécaniquement le classement de tous les lots à prix fixe,
    // pour une valeur qui ne sera connue qu'à la clôture.
    perCard: extra.auction ? null : perCard(total, quantity),
    ...extra,
  };
}

/**
 * Places de marché interrogeables à la demande.
 *
 * Leboncoin en est exclu, et le type le dit plutôt qu'un commentaire : sa
 * collecte tourne sur minuterie dans un processus séparé — voir `lib/lbc.ts` —
 * et ne sait donc rien des requêtes d'une carte particulière. Il n'alimente
 * que le flux des lots récents, qui ne part d'aucune carte.
 */
type QueryableSource = Exclude<Source, "lbc">;

/**
 * Interroge une place de marché sur toutes les requêtes de lot d'une carte.
 *
 * Rend toujours une liste, même vide : l'erreur est retournée plutôt que
 * propagée, pour qu'une place de marché en panne n'emporte pas l'autre.
 */
async function collect(
  source: QueryableSource,
  card: CardDetail,
  queries: string[],
): Promise<{ items: LotItem[]; error: string | null }> {
  try {
    if (source === "vinted") {
      // Pertinence seule, là où le fil croise deux tris : le tri par nouveauté
      // sert au badge « nouveau », que les lots ne portent pas.
      const pages = await Promise.all(
        queries.map((query) => searchVinted({ query, order: "relevance", perPage: 48 })),
      );
      const scored = scoreLots(
        pages.flatMap((page) => page.items),
        card,
      );
      return {
        items: scored.map((item) =>
          toLot(item, card.id, "vinted", item.match.score, {
            country: null,
            auction: false,
            bids: 0,
            endsAt: null,
          }),
        ),
        error: null,
      };
    }

    const pages = await Promise.all(
      queries.map((query) => searchEbay({ query, order: "best_match", perPage: 50 })),
    );
    const scored = scoreLots(
      pages.flatMap((page) => page.items),
      card,
    );
    return {
      items: scored.map((item) =>
        toLot(item, card.id, "ebay", item.match.score, {
          country: item.country,
          auction: item.auction,
          bids: item.bids,
          endsAt: item.endsAt,
        }),
      ),
      error: null,
    };
  } catch (error) {
    const label = SOURCE_NAMES[source];
    const message = error instanceof Error ? error.message : `Recherche ${label} impossible.`;
    return { items: [], error: `${label} : ${message}` };
  }
}

/**
 * Relance la collecte des lots pour une carte et réécrit son instantané.
 *
 * Aucun relevé n'est consigné, à la différence du fil. `recordSightings`
 * alimente la distribution des prix observés pour la carte, et
 * `summarize` n'écarte que les correspondances faibles : un lot de 300 cartes
 * à 200 € y entrerait comme une observation valide et emporterait la médiane.
 * Le prix d'un lot ne dit rien du prix de la carte, donc il n'est pas archivé —
 * et les lots ne portent, en conséquence, pas de pastille « nouveau ».
 */
export async function refreshLots(favorite: FavoriteCard, now = Date.now()): Promise<LotSnapshot> {
  return serialize(`lots:${favorite.cardId}`, async () => {
    const existing = await readLotSnapshot(favorite.cardId);
    if (isFresh(existing, now)) return existing as LotSnapshot;

    const card = await getCard(favorite.cardId);
    if (!card) {
      const failed: LotSnapshot = {
        card: fallbackCard(favorite),
        at: now,
        queries: [],
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

    const queries = lotQueries(card);
    const sources: QueryableSource[] = hasEbay() ? ["vinted", "ebay"] : ["vinted"];
    const collected = await Promise.all(
      sources.map((source) => collect(source, card, queries)),
    );

    const errors = collected.map((result) => result.error).filter((msg) => msg !== null);

    if (errors.length === sources.length) {
      const failed: LotSnapshot = {
        card: feedCard,
        at: now,
        queries,
        items: existing?.items ?? [],
        error: errors.join(" · "),
      };
      await writeJson(file(card.id), failed);
      return failed;
    }

    // Les deux requêtes d'une même source se recouvrent largement — « lot
    // Dracaufeu » et « lot cartes Base Set » ramènent les mêmes gros lots. On
    // garde la meilleure note de chaque annonce.
    const best = new Map<string, LotItem>();
    for (const item of collected.flatMap((result) => result.items)) {
      const known = best.get(item.id);
      if (!known || item.score > known.score) best.set(item.id, item);
    }

    const kept = [...best.values()]
      .filter((item) => item.score >= LOT_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PER_CARD);

    const snapshot: LotSnapshot = {
      card: feedCard,
      at: now,
      queries,
      items: kept,
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

/* ------------------------------------------------------------ lots récents */

/**
 * Le flux des lots qui viennent d'être mis en ligne.
 *
 * C'est l'inverse exact de tout ce qui précède : on ne part d'aucune carte. Un
 * gros lot ne dit pas ce qu'il contient, et c'est justement là que se font les
 * affaires — le vendeur qui liquide un classeur au poids ne sait pas toujours
 * ce qu'il y a dedans. La seule chose qui compte est donc d'arriver tôt, d'où
 * un tri par nouveauté et non par pertinence.
 *
 * Un instantané unique, partagé par tous : les requêtes ne dépendent d'aucune
 * collection. Huit recherches tous les quarts d'heure pour tout le site, là où
 * les lots par carte en coûtent quatre par carte suivie.
 */
export const RECENT_QUERIES = [
  "lot cartes pokemon",
  "lot pokemon",
  "vrac cartes pokemon",
  "collection cartes pokemon",
];

/**
 * Un quart d'heure. Plus court que les lots par carte : ici la fraîcheur *est*
 * le produit, et un flux « des plus récents » vieux d'une demi-heure ne vaut
 * pas grand-chose.
 */
export const RECENTS_FRESH_MS = 15 * 60 * 1000;

/** Annonces conservées. Au-delà, personne ne fait défiler. */
const MAX_RECENTS = 120;

export interface RecentLots {
  /** Date de la collecte, en ms epoch. */
  at: number;
  queries: string[];
  items: LotItem[];
  /** Renseigné quand *toutes* les places de marché ont échoué. */
  error?: string;
  /** Renseigné quand une seule a échoué : l'instantané est valide mais incomplet. */
  partial?: string;
}

/** Le préfixe écarte toute collision avec un identifiant de carte. */
const RECENTS_FILE = path.join(DIR, "_recents.json");

export function recentsAreFresh(
  snapshot: RecentLots | null,
  now = Date.now(),
  maxAge = RECENTS_FRESH_MS,
): boolean {
  return snapshot !== null && !snapshot.error && now - snapshot.at < maxAge;
}

export async function readRecentLots(): Promise<RecentLots | null> {
  const snapshot = await readJson<RecentLots>(RECENTS_FILE);
  if (!snapshot?.items || !Array.isArray(snapshot.items)) return null;
  return snapshot;
}

/** Tout ce que la page `/lots` doit lire, y compris son horloge. */
export interface LotsView {
  snapshots: LotSnapshot[];
  /** Cartes dont l'instantané manque ou a expiré, à rattraper côté client. */
  staleIds: string[];
  recent: RecentLots | null;
  recentIsStale: boolean;
  /**
   * Horloge du serveur, renvoyée plutôt que relue par l'appelant — pour la même
   * raison que `FeedVisit.now` : une page qui appelle `Date.now()` pendant son
   * rendu n'est plus pure, et son rendu cesserait de coïncider avec celui du
   * client sur les « il y a 3 min ». Une seule lecture sert donc aux deux
   * fraîcheurs *et* au premier rendu, qui ne peuvent ainsi pas diverger.
   */
  now: number;
}

/** Les deux onglets d'un coup, depuis le disque seul : aucune requête réseau. */
export async function readLotsView(favorites: FavoriteCard[]): Promise<LotsView> {
  const now = Date.now();

  const [snapshots, recent] = await Promise.all([readLotSnapshots(favorites), readRecentLots()]);

  return {
    snapshots,
    staleIds: staleLotCardIds(favorites, snapshots, now),
    recent,
    recentIsStale: !recentsAreFresh(recent, now),
    now,
  };
}

/**
 * Interroge une place de marché sur toutes les requêtes génériques.
 *
 * Le tri par nouveauté est ici le bon, contrairement au fil des cartes : la
 * requête n'est pas floue faute de mieux, elle est *volontairement* large. Il
 * n'y a pas de bonne réponse à faire remonter en pertinence — juste des
 * annonces récentes à voir avant les autres.
 */
async function collectRecent(
  source: Source,
): Promise<{ items: LotItem[]; error: string | null }> {
  try {
    if (source === "vinted") {
      const pages = await Promise.all(
        RECENT_QUERIES.map((query) =>
          searchVinted({ query, order: "newest_first", perPage: 48 }),
        ),
      );
      return {
        items: pages
          .flatMap((page) => page.items)
          .filter((item) => isPokemonLot(item.title))
          .map((item) =>
            toLot(item, null, "vinted", 0, {
              country: null,
              auction: false,
              bids: 0,
              endsAt: null,
            }),
          ),
        error: null,
      };
    }

    if (source === "lbc") {
      // Aucune requête réseau ici : le collecteur a déjà moissonné, filtré sur
      // la fenêtre de mise en ligne et trié. Voir `lib/lbc.ts` pour la raison —
      // Datadome ferme la porte au client HTTP de Node.
      //
      // `isPokemonLot` s'applique néanmoins ici, et non côté collecteur : les
      // trois sources doivent passer par la *même* règle, sous peine de voir
      // leboncoin dériver le jour où la liste des mots de lot changera.
      const items = await searchLbcRecents();
      return {
        items: items
          .filter((item) => isPokemonLot(item.title))
          .map((item) =>
            toLot(item, null, "lbc", 0, {
              // Seule source dont la provenance est connue sans lire le titre :
              // leboncoin est franco-français. Le filtre « français uniquement »
              // s'y fie directement, sans retomber sur la langue du titre.
              country: "FR",
              // Ni enchères ni ventes à durée limitée : tout y est à prix fixe.
              auction: false,
              bids: 0,
              endsAt: null,
            }),
          ),
        error: null,
      };
    }

    const pages = await Promise.all(
      RECENT_QUERIES.map((query) => searchEbay({ query, order: "newly_listed", perPage: 50 })),
    );
    return {
      items: pages
        .flatMap((page) => page.items)
        .filter((item) => isPokemonLot(item.title))
        .map((item) =>
          toLot(item, null, "ebay", 0, {
            country: item.country,
            auction: item.auction,
            bids: item.bids,
            endsAt: item.endsAt,
          }),
        ),
      error: null,
    };
  } catch (error) {
    const label = SOURCE_NAMES[source];
    const message = error instanceof Error ? error.message : `Recherche ${label} impossible.`;
    return { items: [], error: `${label} : ${message}` };
  }
}

/** Relance la collecte du flux récent et réécrit l'instantané partagé. */
export async function refreshRecentLots(now = Date.now()): Promise<RecentLots> {
  return serialize("lots:recents", async () => {
    const existing = await readRecentLots();
    if (recentsAreFresh(existing, now)) return existing as RecentLots;

    // Leboncoin ne rejoint la liste que si un instantané exploitable existe :
    // un projet qui n'a jamais lancé `collect/lbc.py` doit voir une source de
    // moins, pas une erreur — exactement comme eBay sans clef d'API.
    const sources: Source[] = ["vinted"];
    if (hasEbay()) sources.push("ebay");
    if (await hasLbc(now)) sources.push("lbc");

    const collected = await Promise.all(sources.map((source) => collectRecent(source)));
    const errors = collected.map((result) => result.error).filter((msg) => msg !== null);

    if (errors.length === sources.length) {
      const failed: RecentLots = {
        at: now,
        queries: RECENT_QUERIES,
        items: existing?.items ?? [],
        error: errors.join(" · "),
      };
      await writeJson(RECENTS_FILE, failed);
      return failed;
    }

    // Les quatre requêtes se recouvrent largement — « lot pokemon » ramène une
    // bonne part de ce que ramène « lot cartes pokemon ». Toutes les notes
    // valant zéro ici, on garde simplement la première occurrence.
    const best = new Map<string, LotItem>();
    for (const item of collected.flatMap((result) => result.items)) {
      if (!best.has(item.id)) best.set(item.id, item);
    }

    // Tri par mise en ligne, la raison d'être du flux. Les deux places de
    // marché ne datent pas leurs annonces pareil — eBay publie une vraie date,
    // Vinted l'horodatage de la photo — et les mélanger reste le meilleur
    // classement disponible. Sans date, en queue plutôt qu'en tête.
    const kept = [...best.values()]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, MAX_RECENTS);

    const snapshot: RecentLots = {
      at: now,
      queries: RECENT_QUERIES,
      items: kept,
      ...(errors.length > 0 ? { partial: errors.join(" · ") } : {}),
    };
    await writeJson(RECENTS_FILE, snapshot);
    return snapshot;
  });
}
