/**
 * Lecture des offres Cardmarket collectées.
 *
 * Comme `lib/lbc.ts`, ce module ne fait aucune requête : il lit un instantané
 * déposé sur le disque par `collect/cardmarket.py`. La raison est cousine mais
 * pas identique. Leboncoin bute sur l'empreinte TLS ; Cardmarket bute sur
 * Cloudflare, qui sert un défi JavaScript. Mesuré le 31 août 2026, `curl_cffi`
 * en rejouant un cookie `cf_clearance` d'Edge tient quelques requêtes puis se
 * fait refuser — le cookie est lié à l'empreinte d'Edge, non à celle de Chrome
 * qu'imite `curl_cffi`. Seul un vrai navigateur passe de façon stable. La
 * collecte vit donc dans un processus séparé, piloté par Edge ; voir l'en-tête
 * de `collect/cardmarket.py`.
 *
 * Conséquence, la même que pour leboncoin : le site montre ce que la dernière
 * minuterie a déposé, et rien ne le rattrape en cours de route.
 *
 * Pourquoi Cardmarket n'est pas suivi pour toutes les cartes
 * ----------------------------------------------------------
 * Sonder une carte coûte une page de navigateur, là où Vinted et eBay coûtent
 * un `fetch`. On ne le fait donc que pour les cartes explicitement cochées
 * « précieuse » (`FavoriteCard.cardmarket`) — la liste de chasse, sous-ensemble
 * choisi des cartes épinglées. C'est `writeCardmarketWatched` qui la dépose
 * pour le collecteur.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR, readJson, writeJson } from "./json-file";
import type { Condition } from "./match";
import type { FavoriteCard } from "./store";

/** Doit rester identique aux chemins qu'écrit `collect/cardmarket.py`. */
const CARDS_FILE = path.join(DATA_DIR, "cardmarket", "cartes.json");
const WATCHED_FILE = path.join(DATA_DIR, "cardmarket", "cartes-suivies.json");
const STATUS_FILE = path.join(DATA_DIR, "cardmarket", "status.json");

/**
 * Une offre telle que le collecteur la dépose.
 *
 * `idArticle` est la clé qui compte : unique et stable par offre, c'est elle
 * qui, inconnue au relevé suivant, fait qu'une offre neuve est datée par
 * `recordSightings` et déclenche une alerte — sans une ligne de code de plus,
 * exactement comme pour les autres places de marché.
 */
export interface CardmarketOffer {
  idArticle: string;
  price: number | null;
  /** Pas d'URL par offre : l'achat se fait sur la page produit. */
  url: string;
  /** Code d'état Cardmarket (`NM`, `LP`…) ou `null` — ramené aux quatre niveaux par `cmCondition`. */
  condition: string | null;
  /** Pays du vendeur, en toutes lettres (« Pays-Bas ») ou `null`. */
  country: string | null;
  seller: string | null;
}

export interface CardmarketCardResult {
  /** Date du relevé, en ms epoch. */
  at: number;
  /** Page produit sondée. */
  url: string;
  items: CardmarketOffer[];
}

export interface CardmarketSnapshot {
  at: number;
  cards: Record<string, CardmarketCardResult>;
}

/**
 * Au-delà, les offres d'une carte ne sont plus tenues pour à jour.
 *
 * Trois heures : large, parce qu'une offre Cardmarket ne disparaît pas en
 * quelques minutes comme une annonce fraîche, et parce que le collecteur, piloté
 * par navigateur, peut manquer un passage sans que l'offre cesse d'exister. Un
 * seuil serré ferait clignoter la source à la première minuterie ratée.
 */
export const CARDMARKET_CARD_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** Offres conservées par carte : les moins chères, là où vivent les affaires. */
export const CARDMARKET_MAX_PER_CARD = 15;

export async function readCardmarketCards(): Promise<CardmarketSnapshot | null> {
  const snapshot = await readJson<CardmarketSnapshot>(CARDS_FILE);
  if (!snapshot?.cards || typeof snapshot.cards !== "object") return null;
  return snapshot;
}

/**
 * Les offres Cardmarket d'une carte, si le relevé est encore d'actualité.
 *
 * Rend une liste vide plutôt que de lever, comme `readLbcForCard` : l'absence
 * est le cas courant — une carte non cochée « précieuse » n'est jamais sondée —
 * et ce n'est pas une panne. Les offres sont rendues triées par prix croissant,
 * les moins chères d'abord, et plafonnées : au-delà, ce n'est plus un fil de
 * bonnes affaires mais le carnet d'ordres entier.
 */
export async function readCardmarketForCard(
  cardId: string,
  now = Date.now(),
  maxAge = CARDMARKET_CARD_MAX_AGE_MS,
): Promise<CardmarketOffer[]> {
  const snapshot = await readCardmarketCards();
  const found = snapshot?.cards[cardId];
  if (!found || now - found.at > maxAge) return [];

  return [...found.items]
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .slice(0, CARDMARKET_MAX_PER_CARD);
}

/**
 * Ramène un code d'état Cardmarket aux quatre niveaux du site.
 *
 * L'échelle de Cardmarket est plus fine (`MT` > `NM` > `EX` > `GD` > `LP` >
 * `PL` > `PO`) ; on la replie sur celle que les autres places de marché
 * emploient déjà, plutôt que d'ajouter un cinquième libellé qui n'aurait de
 * sens que pour une source. `condition()` de `match.ts` ne peut pas s'en
 * charger : il lit des mots (« neuf », « très bon »), pas ces sigles.
 */
export function cmCondition(code: string | null): Condition {
  switch (code) {
    case "MT":
      return "neuf";
    case "NM":
    case "EX":
      return "excellent";
    case "GD":
    case "LP":
      return "bon";
    case "PL":
    case "PO":
      return "correct";
    default:
      return null;
  }
}

/**
 * État de la dernière tentative de collecte, écrit par `collect/cardmarket.py`.
 * Il existe pour une seule raison : dire au fil *pourquoi* Cardmarket est vide,
 * plutôt que de le laisser muet.
 */
export interface CardmarketStatus {
  at: number;
  watched: number;
  collected: number;
  offers: number;
  /** La dernière tentative s'est heurtée au défi Cloudflare. */
  challenged: boolean;
  message: string;
}

/** Au-delà, l'état est trop vieux pour dire quoi que ce soit de la collecte. */
const STATUS_STALE_MS = 45 * 60 * 1000;

export async function readCardmarketStatus(): Promise<CardmarketStatus | null> {
  const status = await readJson<CardmarketStatus>(STATUS_FILE);
  if (!status || typeof status.at !== "number") return null;
  return status;
}

/**
 * Message à afficher au-dessus du fil quand Cardmarket ne rend rien, et
 * pourquoi. `null` s'il n'y a rien à signaler — aucune carte surveillée, ou
 * collecte en bonne santé.
 *
 * Le but est de ne jamais laisser un fil vide sans explication : un défi
 * Cloudflare (IP surchauffée) appelle un amorçage `--visible`, un simple retard
 * appelle la patience. Les deux se lisent d'un coup d'œil plutôt que de laisser
 * l'utilisateur croire que la fonction est cassée.
 */
export async function cardmarketWarning(
  cards: FavoriteCard[],
  now = Date.now(),
): Promise<string | null> {
  if (!cards.some((favorite) => favorite.cardmarket)) return null;

  const status = await readCardmarketStatus();
  if (!status) {
    return "Cardmarket : aucune collecte encore. Cochez « CM » sur une carte, puis lancez l’amorçage.";
  }
  if (status.challenged) {
    return "Cardmarket : collecte bloquée par Cloudflare (IP surchauffée). Relancez l’amorçage « --visible » (voir la page Cardmarket).";
  }
  if (now - status.at > STATUS_STALE_MS) {
    return "Cardmarket : la collecte ne tourne plus (minuterie arrêtée ?). Offres peut-être périmées.";
  }
  return null;
}

/** Une carte de la liste de chasse, telle que le collecteur l'attend. */
export interface CardmarketWatch {
  cardId: string;
  name: string;
  localId: string | null;
  /** Tirage reverse holo recherché. Absent = version standard. */
  reverse?: boolean;
  /** Première édition recherchée. Absent = toutes éditions. */
  firstEd?: boolean;
  /** Lien Cardmarket collé à la main : le collecteur le sonde sans chercher. */
  url?: string;
}

/**
 * Dépose la liste de chasse Cardmarket pour le collecteur.
 *
 * Écrite depuis TypeScript pour la même raison que les requêtes leboncoin : le
 * site tient déjà l'union des cartes suivies, et sait lesquelles sont cochées
 * « précieuse ». Le collecteur s'en sert pour résoudre l'URL produit d'une
 * carte qu'il ne connaît pas encore (`--resolve`), par le nom anglais et le
 * numéro imprimé.
 *
 * Appelée par la veille, au même quart d'heure que le reste du balayage.
 */
export async function writeCardmarketWatched(
  cards: FavoriteCard[],
): Promise<CardmarketWatch[]> {
  const watched: CardmarketWatch[] = cards
    .filter((favorite) => favorite.cardmarket)
    .map((favorite) => ({
      cardId: favorite.cardId,
      name: favorite.name,
      localId: favorite.localId,
      ...(favorite.cardmarketPrefs?.reverse ? { reverse: true } : {}),
      ...(favorite.cardmarketPrefs?.firstEd ? { firstEd: true } : {}),
      ...(favorite.cardmarketUrl ? { url: favorite.cardmarketUrl } : {}),
    }));

  await writeJson(WATCHED_FILE, watched);
  return watched;
}

/* --------------------------------------------------- collecte à la demande */

const exec = promisify(execFile);

/**
 * Interpréteur Python du collecteur Cardmarket.
 *
 * Absent, la collecte à la demande ne se fait pas : cocher « CM » ou changer un
 * critère pose l'intention, et le prochain passage de la minuterie la relève.
 * Le collecteur lance lui-même son navigateur (voir `collect/cardmarket.py`) —
 * il n'y a plus d'Edge à ouvrir ni d'endpoint à configurer.
 */
function python(): string | null {
  return process.env.CARDMARKET_PYTHON?.trim() || null;
}

export function liveIsConfigured(): boolean {
  return python() !== null;
}

/**
 * Au-delà, on rend la main : le collecteur pilote un navigateur, plus lent
 * qu'un `fetch`. Une carte seule est brève ; un tour complet (avec résolution)
 * peut durer, d'où le plafond plus large.
 */
const LIVE_TIMEOUT_MS = 60_000;
const SWEEP_TIMEOUT_MS = 180_000;

/**
 * Lance le collecteur Cardmarket, ganté de tout ce qui doit l'être.
 *
 * Ne lève jamais : un collecteur qui échoue (Edge absent, défi Cloudflare) ne
 * doit pas faire échouer ce qui l'appelle. Le fil retombe sur le dernier relevé.
 */
async function runCollector(cardArgs: string[], timeout: number): Promise<void> {
  const interpreter = python();
  if (!interpreter) return;

  const script = path.join(process.cwd(), "collect", "cardmarket.py");
  try {
    await exec(interpreter, [script, ...cardArgs, "--quiet"], {
      timeout,
      cwd: process.cwd(),
      windowsHide: true,
    });
  } catch (error) {
    console.error("[cardmarket] collecte", error);
  }
}

/**
 * Relance le collecteur pour une seule carte, à la demande.
 *
 * Appelé quand on coche « CM » ou qu'on change un critère : sans cela, activer
 * « reverse » ne changerait rien à l'écran tant que la minuterie n'a pas
 * repassé. Les critères sont lus dans `cartes-suivies.json`, que l'action a déjà
 * réécrit avant d'appeler ici — le collecteur y trouve le reverse tout juste
 * coché.
 */
export function refreshCardmarketLive(cardId: string): Promise<void> {
  return runCollector(["--cards", cardId], LIVE_TIMEOUT_MS);
}

/**
 * Relève toutes les cartes suivies en un seul lancement de navigateur.
 *
 * Appelé par la veille, au quart d'heure : lancer le navigateur une fois pour
 * toutes les cartes plutôt qu'une fois par carte (ce que ferait un déclenchement
 * dans le fil) épargne autant de démarrages d'Edge. Le collecteur lit
 * lui-même la liste de chasse.
 */
export function refreshCardmarketSweep(): Promise<void> {
  return runCollector([], SWEEP_TIMEOUT_MS);
}
