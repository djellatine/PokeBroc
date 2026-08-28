/**
 * Lecture des lots collectés sur leboncoin.
 *
 * Ce module ne fait aucune requête, à la différence de `vinted.ts` et
 * `ebay.ts` : il lit un instantané déposé sur le disque par `collect/lbc.py`.
 *
 * La raison tient en une mesure. Leboncoin est derrière Datadome, qui
 * n'inspecte pas l'en-tête `User-Agent` mais l'empreinte du handshake TLS et
 * de la négociation HTTP/2 ; le `fetch` de Node en produit une immédiatement
 * reconnaissable, et se voit refuser jusqu'à la page d'accueil. Aucune session
 * anonyme à entretenir comme chez Vinted, aucun jeton à renouveler comme chez
 * eBay : le problème n'est pas l'authentification, c'est la pile TLS. Il ne se
 * règle donc pas ici, mais dans un processus séparé — voir l'en-tête de
 * `collect/lbc.py`.
 *
 * Conséquence sur la fraîcheur : les deux autres places de marché sont
 * interrogées quand leur instantané expire, celle-ci ne l'est jamais à la
 * demande. Le site affiche ce que la dernière minuterie a déposé, et rien ne
 * peut le rattraper en cours de route. `lbcIsUsable` existe pour cela : ne pas
 * présenter comme un « flux des lots récents » un fichier vieux d'un jour.
 */

import path from "node:path";
import { DATA_DIR, readJson, writeJson } from "./json-file";
import { bestQuery } from "./match";
import type { FavoriteCard } from "./store";
import { getCard } from "./tcgdex";

/** Doit rester identique au chemin par défaut de `collect/lbc.py`. */
const FILE = path.join(DATA_DIR, "lbc", "recents.json");

/** Les requêtes par carte, écrites ici et lues par `collect/lbc.py`. */
const QUERIES_FILE = path.join(DATA_DIR, "lbc", "queries.json");

/** Les annonces par carte, écrites par `collect/lbc.py` et lues ici. */
const CARDS_FILE = path.join(DATA_DIR, "lbc", "cartes.json");

/**
 * Annonce telle que le collecteur la dépose : exactement les champs que
 * `toLot()` consomme, plus deux que leboncoin est seul à fournir.
 */
export interface LbcItem {
  id: number;
  title: string;
  url: string;
  thumbnail: string | null;
  price: number | null;
  /** Toujours `null` : les frais de port dépendent du mode de remise, non fixé par l'annonce. */
  totalPrice: number | null;
  /** État déclaré, en toutes lettres — `condition()` le ramène aux quatre niveaux. */
  status: string | null;
  promoted: boolean;
  favourites: number;
  /** Mise en ligne réelle, en ms epoch. Jamais la date de remontée : voir `collect/lbc.py`. */
  createdAt: number | null;
  /** Ville du vendeur. Leboncoin est la seule source à la donner. */
  city: string | null;
  seller: string | null;
}

export interface LbcSnapshot {
  /** Date de la collecte, en ms epoch. */
  at: number;
  /** Fenêtre de mise en ligne retenue par le collecteur, en heures. */
  windowHours: number;
  queries: string[];
  items: LbcItem[];
  /** Renseigné quand une partie des requêtes a échoué : instantané valide mais incomplet. */
  partial?: string;
}

/**
 * Au-delà, l'instantané n'est plus un flux de lots récents.
 *
 * Six fois la période de collecte, qui est d'un quart d'heure. Le facteur n'est
 * pas choisi pour laisser dormir une machine, mais **mesuré sur le taux d'échec
 * de la collecte elle-même**. Relevé du 25 au 29 août 2026, sur les deux cents
 * passages du journal : 134 réussis, 66 refusés par Datadome en 403, soit un
 * tiers d'échec — et des séries allant jusqu'à cinq refus d'affilée.
 *
 * Un seuil d'une heure vaut exactement quatre passages manqués : la série de
 * cinq du 25 août l'aurait franchi, et celle de quatre du 29 août l'a franchi.
 * Leboncoin disparaissait donc de la page sans que rien n'ait cessé de tourner.
 * Une heure et demie couvre six passages, ce qui laisse passer les séries
 * observées sans jamais présenter comme « récent » un fichier réellement
 * oublié : au-delà, la collecte ne tourne plus, et mieux vaut ne rien afficher
 * qu'un « publié il y a 3 h » vieux d'une journée.
 *
 * La valeur d'origine, six heures, était le double d'une collecte trihoraire —
 * vingt-quatre passages de retard une fois la cadence au quart d'heure. Un
 * seuil de péremption suit la cadence *et* la fiabilité de la source ; ni l'une
 * ni l'autre seule ne suffit à le poser.
 */
export const LBC_MAX_AGE_MS = 90 * 60 * 1000;

export async function readLbcSnapshot(): Promise<LbcSnapshot | null> {
  const snapshot = await readJson<LbcSnapshot>(FILE);
  if (!snapshot?.items || !Array.isArray(snapshot.items)) return null;
  return snapshot;
}

/**
 * L'instantané est-il assez récent pour être montré ?
 *
 * Un instantané vide reste utilisable : trois heures sans un seul lot mis en
 * ligne est un résultat, pas une panne. Seul l'âge disqualifie.
 */
export function lbcIsUsable(
  snapshot: LbcSnapshot | null,
  now = Date.now(),
  maxAge = LBC_MAX_AGE_MS,
): boolean {
  return snapshot !== null && now - snapshot.at < maxAge;
}

/**
 * La source est-elle en service ?
 *
 * Absence de fichier et fichier périmé se distinguent volontairement en amont :
 * ici on ne répond qu'à « peut-on lister leboncoin parmi les sources ». Un
 * projet qui n'a jamais lancé le collecteur ne doit pas voir d'erreur, juste
 * une source de moins — comme eBay sans clef d'API.
 */
export async function isConfigured(now = Date.now()): Promise<boolean> {
  return lbcIsUsable(await readLbcSnapshot(), now);
}

/**
 * Les lots de l'instantané courant, du plus récent au plus ancien.
 *
 * Lève si l'instantané manque ou a expiré, pour que `collectRecent` traite le
 * cas comme il traite une place de marché en panne — c'est-à-dire sans
 * emporter les autres.
 */
export async function searchLbcRecents(now = Date.now()): Promise<LbcItem[]> {
  const snapshot = await readLbcSnapshot();
  if (snapshot === null) {
    throw new Error("aucun instantané. Lancez `python collect/lbc.py`.");
  }
  if (!lbcIsUsable(snapshot, now)) {
    const hours = Math.round((now - snapshot.at) / 3600_000);
    throw new Error(`instantané vieux de ${hours} h : la collecte ne tourne plus.`);
  }
  return snapshot.items;
}

/* ------------------------------------------------------------- par carte */

/**
 * Pourquoi leboncoin est interrogé carte par carte, et pas en vrac.
 *
 * Les quatre requêtes génériques du flux de lots ramènent aussi des cartes à
 * l'unité — leboncoin cherche large, « lot cartes pokemon » rend des
 * « Brindibou ar 90/88 ». On a donc mesuré, le 29 août 2026, si ce vivier
 * suffisait : 109 annonces de cartes publiées dans les trois heures,
 * confrontées aux 48 cartes suivies, ont produit **zéro correspondance
 * forte**. Vingt et une correspondances larges, toutes fausses — un
 * « Raichu 14/62 » accroché à « Suicune 14/64 » par le seul numéro.
 *
 * La raison n'est pas que leboncoin n'a pas ces cartes : il les a. Cherchées
 * nommément, `swsh8-271` sort à 750 € et `dc1-6` à trois exemplaires entre 100
 * et 175 €. Elles sont simplement rares — le site publie ~78 annonces de
 * cartes par heure, et la probabilité qu'une carte précise soit dans le lot
 * d'une heure donnée est infime. Un flux générique ne les croisera jamais.
 *
 * D'où une requête par carte suivie. Et d'où la rotation : 48 requêtes par
 * quart d'heure quadrupleraient le trafic vers un site qui refuse déjà une
 * requête sur trois. Chaque passage en prend une tranche, et le tour complet
 * se boucle en une heure — ce qui reste très en deçà du rythme auquel ces
 * annonces apparaissent.
 */

/** Une carte suivie et le texte à chercher pour elle. */
export interface LbcQuery {
  cardId: string;
  query: string;
}

/**
 * Les annonces trouvées pour une carte, avec la date de leur collecte.
 *
 * Datée carte par carte et non globalement : la rotation fait que deux cartes
 * du même instantané peuvent avoir été collectées à trois quarts d'heure
 * d'écart, et présenter la plus ancienne comme fraîche serait faux.
 */
export interface LbcCardResult {
  at: number;
  items: LbcItem[];
}

export interface LbcCardsSnapshot {
  at: number;
  /** Rang de la prochaine requête à jouer : c'est la rotation qui l'avance. */
  offset: number;
  cards: Record<string, LbcCardResult>;
}

/**
 * Compose les requêtes par carte et les dépose pour le collecteur.
 *
 * Écrit depuis TypeScript plutôt que composé en Python, pour la raison qui
 * tient déjà `isPokemonLot` et `lotSize` de ce côté-ci : `bestQuery` s'appuie
 * sur `searchName`, qui traduit `☆` en « gold star » et retire `δ`. Ces règles
 * sont mesurées, testées, et la moitié des cartes suivies ici porte un de ces
 * symboles. Les redire en Python serait les laisser diverger au premier
 * ajustement.
 *
 * Appelé par la veille, qui tourne au même quart d'heure que le collecteur et
 * connaît déjà l'union des cartes suivies.
 */
export async function writeLbcQueries(cards: FavoriteCard[]): Promise<LbcQuery[]> {
  const queries: LbcQuery[] = [];

  for (const favorite of cards) {
    const card = await getCard(favorite.cardId);
    // Une carte absente de TCGdex n'a pas de numéro imprimé, donc pas de
    // requête discriminante. La sauter vaut mieux que chercher son nom nu, qui
    // ramènerait 35 annonces sans rapport à noter pour rien.
    if (card) queries.push({ cardId: favorite.cardId, query: bestQuery(card) });
  }

  await writeJson(QUERIES_FILE, queries);
  return queries;
}

export async function readLbcCards(): Promise<LbcCardsSnapshot | null> {
  const snapshot = await readJson<LbcCardsSnapshot>(CARDS_FILE);
  if (!snapshot?.cards || typeof snapshot.cards !== "object") return null;
  return snapshot;
}

/**
 * Les annonces leboncoin d'une carte, si elles sont encore d'actualité.
 *
 * Le seuil est celui du tour de rotation, pas celui de `LBC_MAX_AGE_MS` : une
 * carte n'est réinterrogée qu'une fois par tour, donc ses annonces ont par
 * construction jusqu'à un tour d'âge. Les refuser à une heure ferait
 * clignoter la source à chaque passage.
 *
 * Rend une liste vide plutôt que de lever, à la différence de
 * `searchLbcRecents` : ici l'absence est le cas courant — la plupart des
 * cartes n'ont aucune annonce sur leboncoin la plupart du temps — et ce n'est
 * pas une panne.
 */
export async function readLbcForCard(
  cardId: string,
  now = Date.now(),
  maxAge = LBC_CARD_MAX_AGE_MS,
): Promise<LbcItem[]> {
  const snapshot = await readLbcCards();
  const found = snapshot?.cards[cardId];
  if (!found || now - found.at > maxAge) return [];
  return found.items;
}

/**
 * Au-delà, les annonces d'une carte ne sont plus tenues pour à jour.
 *
 * Deux tours de rotation. Un seul aurait fait disparaître les annonces d'une
 * carte dès qu'un passage manque son tour — ce qui arrive une fois sur trois,
 * Datadome refusant à ce rythme — alors que l'annonce, elle, est toujours en
 * ligne. Deux tours absorbent un passage manqué sans jamais présenter comme
 * courante une annonce vieille de deux heures.
 */
export const LBC_CARD_MAX_AGE_MS = 2 * 60 * 60 * 1000;
