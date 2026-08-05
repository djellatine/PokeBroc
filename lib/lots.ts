/**
 * L'instantané des lots Pokémon, partagé par tout le site.
 *
 * Un seul fichier, et non plus un par carte suivie : les requêtes ne dépendent
 * d'aucune collection. Douze recherches par quart d'heure pour l'ensemble des
 * visiteurs, quel que soit le nombre de comptes et de cartes épinglées.
 *
 * Module distinct de `feed.ts` plutôt qu'un champ de plus dans son instantané,
 * pour deux raisons qui tiennent à la nature d'un lot :
 *
 * 1. **La requête n'est pas la même.** Le fil cherche « Dracaufeu 4/102 » ; un
 *    lot s'annonce « lot de 200 cartes Pokémon ». Aucun mot en commun.
 * 2. **La notation ne s'applique pas.** Sans carte de référence, il n'y a rien
 *    à comparer : on tranche sur le titre nu, avec `isPokemonLot`.
 *
 * Une collecte par carte a existé ici, qui cherchait « lot Dracaufeu » et
 * « lot cartes Set de Base » pour chaque carte épinglée. Elle a été retirée :
 * le fil de la page d'accueil répond déjà à cette question — un lot qui nomme
 * une carte suivie y remonte par la notation ordinaire, et le bouton « Sans
 * lots » sert à les masquer. Deux chemins pour une même question, dont l'un
 * coûtait quatre recherches **par carte suivie** et émettait autant de fois la
 * même requête d'extension qu'il y avait de cartes dans cette extension.
 *
 * `scoreLot`, `scoreLots`, `LOT_SCORE` et `lotQueries` restent dans `match.ts`,
 * sans appelant : ils servaient cette collecte, et resserviront à un filtre
 * « ne montrer que les lots contenant telle carte » posé sur la liste unique.
 */

import path from "node:path";
import { isConfigured as hasEbay, searchEbay } from "./ebay";
import { DATA_DIR, readJson, serialize, writeJson } from "./json-file";
import { isConfigured as hasLbc, searchLbcRecents } from "./lbc";
import { condition, isPokemonLot, lotSize, type Condition } from "./match";
import { SOURCE_NAMES, type Source } from "./source";
import { searchVinted } from "./vinted";

const DIR = path.join(DATA_DIR, "lots");

/**
 * Lot tel que la page l'affiche.
 *
 * Deux champs de `FeedItem` manquent, et leur absence est le sujet même de ce
 * module : `trend` et `vsMarket` compareraient le prix d'un lot entier à la
 * cote d'une carte unique — un lot de 200 cartes à 60 € afficherait « −85 % »
 * et raflerait le classement sans rien vouloir dire. `firstSeen` manque parce
 * qu'on n'archive pas les lots ; voir `refreshRecentLots`.
 */
export interface LotItem {
  /** Préfixé par la source : `vinted:123`, `ebay:v1|456|0`, `lbc:3208812061`. */
  id: string;
  source: Source;
  title: string;
  url: string;
  thumbnail: string | null;
  price: number | null;
  totalPrice: number | null;
  condition: Condition;
  promoted: boolean;
  favourites: number;
  createdAt: number | null;
  /** Pays de l'objet quand la source le déclare — eBay et leboncoin le font, Vinted non. */
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

/* ---------------------------------------------------------------- collecte */

/** Prix par carte, arrondi au centime. */
function perCard(price: number | null, quantity: number | null): number | null {
  if (price === null || quantity === null || quantity <= 0) return null;
  return Math.round((price / quantity) * 100) / 100;
}

/**
 * Champs communs aux trois places de marché. Déclaré structurellement plutôt
 * qu'en union de `VintedItem | EbayItem | LbcItem` : les trois n'ont en partage
 * que ce qu'un lot affiche, et l'union obligerait à discriminer partout.
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

function toLot(
  item: MarketItem,
  source: Source,
  extra: Pick<LotItem, "country" | "auction" | "bids" | "endsAt">,
): LotItem {
  const quantity = lotSize(item.title);
  const total = item.totalPrice ?? item.price;

  return {
    id: `${source}:${item.id}`,
    source,
    title: item.title,
    url: item.url,
    thumbnail: item.thumbnail,
    price: item.price,
    totalPrice: item.totalPrice,
    condition: condition(item.status),
    promoted: item.promoted,
    favourites: item.favourites,
    createdAt: item.createdAt,
    quantity,
    // Une enchère en cours n'a pas de prix demandé : son prix par carte
    // baisserait mécaniquement le classement de tous les lots à prix fixe,
    // pour une valeur qui ne sera connue qu'à la clôture.
    perCard: extra.auction ? null : perCard(total, quantity),
    ...extra,
  };
}

/* ------------------------------------------------------------ lots récents */

/**
 * Les requêtes, volontairement larges.
 *
 * Le tri par nouveauté est ici le bon, contrairement au fil des cartes : la
 * requête n'est pas floue faute de mieux, elle est *délibérément* générique. Il
 * n'y a pas de bonne réponse à faire remonter en pertinence — juste des
 * annonces récentes à voir avant les autres.
 *
 * Le collecteur leboncoin a sa propre liste, dans `collect/lbc.py`, à une
 * exception près : « lot pokemon » y est écarté. Sans le mot « cartes »,
 * leboncoin rend surtout des peluches et des jouets, là où le catalogue de
 * Vinted — déjà celui d'une brocante de mode — restait exploitable.
 */
export const RECENT_QUERIES = [
  "lot cartes pokemon",
  "lot pokemon",
  "vrac cartes pokemon",
  "collection cartes pokemon",
];

/**
 * Un quart d'heure. La fraîcheur *est* le produit ici : un flux « des derniers
 * mis en ligne » vieux d'une demi-heure ne vaut pas grand-chose. C'est aussi ce
 * que la page promet — on recharge, les derniers arrivent.
 */
export const RECENTS_FRESH_MS = 15 * 60 * 1000;

/**
 * Lots conservés. Au-delà, personne ne fait défiler.
 *
 * Relevé à 120 du temps de deux places de marché ; leboncoin en apporte une
 * cinquantaine de plus par passage, et le plafond tronquait alors la fin de la
 * liste au lieu de la borner.
 */
const MAX_RECENTS = 200;

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

/** Le préfixe écarte toute collision avec les anciens fichiers par carte. */
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
  recent: RecentLots | null;
  recentIsStale: boolean;
  /**
   * Horloge du serveur, renvoyée plutôt que relue par l'appelant — pour la même
   * raison que `FeedVisit.now` : une page qui appelle `Date.now()` pendant son
   * rendu n'est plus pure, et son rendu cesserait de coïncider avec celui du
   * client sur les « il y a 3 min ». Une seule lecture sert donc à la fraîcheur
   * *et* au premier rendu, qui ne peuvent ainsi pas diverger.
   */
  now: number;
}

/** Depuis le disque seul : aucune requête réseau. */
export async function readLotsView(): Promise<LotsView> {
  const now = Date.now();
  const recent = await readRecentLots();

  return { recent, recentIsStale: !recentsAreFresh(recent, now), now };
}

/**
 * Interroge une place de marché sur toutes les requêtes génériques.
 *
 * Rend toujours une liste, même vide : l'erreur est retournée plutôt que
 * propagée, pour qu'une place de marché en panne n'emporte pas les autres.
 */
async function collectRecent(
  source: Source,
  /**
   * Ignorer le cache de réponses des places de marché. Sans lui, « Actualiser »
   * ne servait à rien pendant quatre-vingt-dix secondes : la collecte repartait,
   * mais les mêmes réponses en ressortaient. Leboncoin n'est pas concerné — il
   * n'interroge rien, il relit un fichier.
   */
  live = false,
): Promise<{ items: LotItem[]; error: string | null }> {
  try {
    if (source === "vinted") {
      const pages = await Promise.all(
        RECENT_QUERIES.map((query) =>
          searchVinted({ query, order: "newest_first", perPage: 48, fresh: live }),
        ),
      );
      return {
        items: pages
          .flatMap((page) => page.items)
          .filter((item) => isPokemonLot(item.title))
          .map((item) =>
            toLot(item, "vinted", { country: null, auction: false, bids: 0, endsAt: null }),
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
            toLot(item, "lbc", {
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
      RECENT_QUERIES.map((query) =>
        searchEbay({ query, order: "newly_listed", perPage: 50, fresh: live }),
      ),
    );
    return {
      items: pages
        .flatMap((page) => page.items)
        .filter((item) => isPokemonLot(item.title))
        .map((item) =>
          toLot(item, "ebay", {
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
 * Relance la collecte et réécrit l'instantané partagé.
 *
 * Aucun relevé n'est consigné, à la différence du fil. `recordSightings`
 * alimente la distribution des prix observés d'une carte, et le prix d'un lot
 * ne dit rien du prix d'une carte : un lot de 300 cartes à 200 € y entrerait
 * comme une observation valide et emporterait la médiane. Les lots ne portent
 * donc, en conséquence, pas de pastille « nouveau ».
 */
/**
 * @param force Passer outre la validité d'un quart d'heure, pour le bouton
 *              « Actualiser ». Le délai entre deux forçages est tenu par la
 *              route : elle seule sait qui demande.
 */
export async function refreshRecentLots(now = Date.now(), force = false): Promise<RecentLots> {
  return serialize("lots:recents", async () => {
    const existing = await readRecentLots();
    if (!force && recentsAreFresh(existing, now)) return existing as RecentLots;

    // Leboncoin ne rejoint la liste que si un instantané exploitable existe :
    // un projet qui n'a jamais lancé `collect/lbc.py` doit voir une source de
    // moins, pas une erreur — exactement comme eBay sans clef d'API.
    const sources: Source[] = ["vinted"];
    if (hasEbay()) sources.push("ebay");
    if (await hasLbc(now)) sources.push("lbc");

    const collected = await Promise.all(sources.map((source) => collectRecent(source, force)));
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

    // Les requêtes se recouvrent largement — « lot pokemon » ramène une bonne
    // part de ce que ramène « lot cartes pokemon ». On garde la première
    // occurrence : elles sont identiques, seule l'origine diffère.
    const best = new Map<string, LotItem>();
    for (const item of collected.flatMap((result) => result.items)) {
      if (!best.has(item.id)) best.set(item.id, item);
    }

    // Tri par mise en ligne, la raison d'être de la page. Les trois places de
    // marché ne datent pas leurs annonces pareil — eBay et leboncoin publient
    // une vraie date, Vinted l'horodatage de la photo — et les mélanger reste
    // le meilleur classement disponible. Sans date, en queue plutôt qu'en tête.
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
