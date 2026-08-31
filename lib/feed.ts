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
import {
  cmCondition,
  readCardmarketForCard,
  type CardmarketOffer,
} from "./cardmarket";
import { isConfigured as hasEbay, searchEbay, type EbayItem } from "./ebay";
import { DATA_DIR, readJson, safeFileName, serialize, writeJson } from "./json-file";
import { readLbcForCard, refreshLbcLive, type LbcItem } from "./lbc";
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
import { cardImage, getCard, type CardDetail } from "./tcgdex";
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

/**
 * Places réservées aux offres Cardmarket dans le fil d'une carte suivie. Sans
 * cette réserve, elles se font évincer par les annonces datées des autres
 * sources (voir la fusion dans `refreshCard`). Douze suffisent à montrer les
 * moins chères sans que Cardmarket n'occupe tout le fil de la carte.
 */
const CARDMARKET_SLOTS = 12;

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
import { SOURCE_NAMES, type Source } from "./source";
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
  item: Scored<VintedItem> | Scored<EbayItem> | Scored<LbcItem>,
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
 * Une annonce leboncoin, telle que le collecteur l'a déposée.
 *
 * Les identifiants leboncoin sont des entiers, comme ceux de Vinted, d'où le
 * même préfixage par la source — `lbc:3258659803` ne peut pas se confondre
 * avec `vinted:3258659803`.
 */
function fromLbc(item: Scored<LbcItem>, cardId: string): PendingItem {
  return {
    ...common(item, cardId),
    id: `lbc:${item.id}`,
    source: "lbc",
    // Seule source dont la provenance est connue sans lire le titre :
    // leboncoin est franco-français, comme le pose déjà `lots.ts`.
    country: "FR",
    // Ni enchères ni ventes à durée limitée : tout y est à prix fixe.
    auction: false,
    bids: 0,
    endsAt: null,
  };
}

/**
 * Une offre Cardmarket vers une annonce du fil.
 *
 * À la différence des trois autres sources, elle ne passe pas par `scoreAll` :
 * l'offre est rattachée à *cette* carte par son `idProduct`, sans passer par le
 * titre. La correspondance est donc exacte par construction — score maximal,
 * jamais gradée, jamais un lot — et il n'y a rien à deviner.
 *
 * L'écart à la cote garde tout son sens, contrairement à ce qu'on pourrait
 * croire d'une offre qui *fait* la cote : la tendance Cardmarket est une moyenne
 * lissée sur trente jours, et une offre fraîche très en dessous est précisément
 * l'affaire qu'on guette — un vendeur qui brade sous la moyenne du marché.
 */
function fromCardmarket(offer: CardmarketOffer, card: CardDetail): PendingItem {
  const trend = card.pricing?.cardmarket?.trend ?? card.pricing?.cardmarket?.avg30 ?? null;
  const vsMarket =
    trend && trend > 0 && offer.price !== null
      ? Math.round(((offer.price - trend) / trend) * 100)
      : null;

  return {
    cardId: card.id,
    id: `cardmarket:${offer.idArticle}`,
    source: "cardmarket",
    title: [card.name, offer.condition, offer.seller].filter(Boolean).join(" · "),
    url: offer.url,
    // Cardmarket n'a pas de photo par offre. Plutôt que « sans photo », on
    // affiche le scan de la carte, toujours disponible puisque l'offre est
    // reliée à une carte connue par son `idProduct`.
    thumbnail: cardImage(card.image, "low"),
    price: offer.price,
    // Les frais de port dépendent du panier et du pays : pas de prix total sûr.
    totalPrice: null,
    condition: cmCondition(offer.condition),
    promoted: false,
    favourites: 0,
    // Cardmarket n'expose pas la date de mise en vente ; c'est `firstSeen`,
    // posé au premier relevé où l'`idArticle` apparaît, qui date la nouveauté.
    createdAt: null,
    score: STRONG_SCORE,
    graded: false,
    bulk: false,
    trend,
    vsMarket,
    // La France passe le filtre « français uniquement » ; un vendeur européen
    // (Pays-Bas, Italie…) est traité comme étranger, ce qui est exact.
    country: offer.country === "France" ? "FR" : offer.country,
    auction: false,
    bids: 0,
    endsAt: null,
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
    // Leboncoin n'interroge rien : le collecteur a déjà cherché cette carte
    // nommément, sur sa propre rotation. Voir l'en-tête de `lib/lbc.ts` — la
    // pile TLS de Node se fait refuser par Datadome, et une carte absente du
    // dernier tour rend simplement une liste vide, ce qui est le cas courant.
    // Une seule passe, donc : la requête est déjà triée par date et
    // discriminante, il n'y a pas de second classement à aller chercher.
    if (source === "lbc") {
      // « Actualiser » relance le collecteur, comme il relance les recherches
      // Vinted et eBay. Sans cela le bouton ne tenait sa promesse que pour deux
      // sources sur trois : leboncoin ne montrait que ce que la minuterie avait
      // déposé, jusqu'à un tour de rotation plus tôt. Le regroupement et le
      // plafond vivent dans `refreshLbcLive`, qui ne lève jamais — leboncoin
      // muet ne doit pas faire échouer un rafraîchissement que les deux autres
      // ont honoré.
      if (live) await refreshLbcLive(card.id);

      const items = await readLbcForCard(card.id);
      const scored = scoreAll(items, card);
      return { items: scored.map((item) => fromLbc(item, card.id)), error: null };
    }

    // Cardmarket n'interroge rien non plus : le collecteur piloté par navigateur
    // a déjà relevé les offres de cette carte. Aucune notation — la
    // correspondance est exacte par `idProduct` — et une carte non sondée rend
    // une liste vide, ce qui est le cas courant hors des cartes « précieuses ».
    // Cardmarket ne lance rien depuis le fil : la collecte, qui pilote un
    // navigateur, est déclenchée ailleurs — par le clic sur « CM » (une carte)
    // et par la veille (toutes, en un lancement). Ici on ne fait que lire le
    // dernier relevé, comme leboncoin.
    if (source === "cardmarket") {
      const offers = await readCardmarketForCard(card.id);
      return { items: offers.map((offer) => fromCardmarket(offer, card)), error: null };
    }

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
    const label = SOURCE_NAMES[source];
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
    // une erreur de collecte à chaque carte. Leboncoin est toujours de la
    // partie : il ne coûte aucune requête ici — il relit ce que la minuterie a
    // déposé — et rend une liste vide quand la carte n'a pas encore eu son
    // tour, ce qui n'est pas une erreur.
    const sources: Source[] = hasEbay() ? ["vinted", "ebay", "lbc"] : ["vinted", "lbc"];
    // Cardmarket seulement pour les cartes cochées « précieuse » : la sonder
    // coûte une page de navigateur, hors du site, et n'a de sens que pour les
    // cartes qu'on guette vraiment. La liste vient de la carte elle-même.
    if (favorite.cardmarket) sources.push("cardmarket");
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

    // À score égal, la plus récente. Le tri ne portait que sur le score, et
    // `Array.prototype.sort` étant stable, les égalités retombaient sur l'ordre
    // de collecte : Vinted, puis eBay, puis leboncoin. Autrement dit la source
    // arrivée en dernier était systématiquement la première tronquée par
    // `MAX_PER_CARD` — mesuré sur `hgss4-94`, six correspondances fortes
    // leboncoin, dont « Ectoplasma Prime 94/102 » à 160 €, sortaient du fil
    // derrière quarante annonces Vinted et eBay de même score. Départager par
    // date n'a pas seulement le mérite d'être neutre : c'est ce que la page
    // promet, les derniers mis en ligne d'abord.
    // Cardmarket ne date pas ses offres : leur `createdAt` est `null`, donc `0`
    // dans le départage par date. Fondues au même tas que les autres, elles
    // perdent toutes les égalités de score et tombent sous le plafond dès qu'une
    // carte a quarante annonces Vinted et eBay plus récentes — c'est-à-dire
    // qu'elles disparaissent précisément des cartes « précieuses » où on les
    // guette. On leur réserve donc leurs places, les moins chères d'abord, et on
    // complète avec le reste. Une carte non suivie sur Cardmarket n'a aucune
    // offre de cette source : la réserve est alors vide et rien ne change.
    const surviving = [...best.values()].filter((item) => item.score >= WIDE_SCORE);
    const cardmarket = surviving
      .filter((item) => item.source === "cardmarket")
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
      .slice(0, CARDMARKET_SLOTS);
    const others = surviving
      .filter((item) => item.source !== "cardmarket")
      .sort((a, b) => b.score - a.score || (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, MAX_PER_CARD - cardmarket.length);
    const kept = [...others, ...cardmarket];

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
