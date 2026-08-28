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
import { DATA_DIR, readJson } from "./json-file";

/** Doit rester identique au chemin par défaut de `collect/lbc.py`. */
const FILE = path.join(DATA_DIR, "lbc", "recents.json");

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
