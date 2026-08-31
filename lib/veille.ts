/**
 * État de la veille : l'appairage Telegram, et le repère des alertes déjà
 * envoyées.
 *
 * Pourquoi un fichier à part de `users.json`
 * ------------------------------------------
 * La veille tourne dans un **second processus Node**, à côté du site.
 * `store.ts` sérialise ses écritures en mémoire (`serialize()`), ce qui ne
 * protège de rien entre deux processus : le site et la veille liraient la même
 * version de `users.json`, et la seconde écriture effacerait la première — avec
 * la carte que l'utilisateur venait tout juste d'épingler.
 *
 * Un seul écrivain par fichier lève la question. Le site possède `users.json`,
 * la veille possède celui-ci, et chacun se contente de lire celui de l'autre.
 * C'est exactement le partage déjà en place entre `collect/lbc.py` et
 * `lib/lbc.ts`, pour la même raison : ce qui tourne hors du site n'écrit pas
 * dans ses fichiers.
 *
 * Pourquoi `notifiedAt` n'est pas `feedNewSince`
 * ----------------------------------------------
 * Les deux datent « ce qui est nouveau », mais pour deux lecteurs différents.
 * `feedNewSince` suit les **visites** : il avance quand on revient sur le site
 * après une interruption, et un bouton le remet à zéro. S'en servir aussi pour
 * les alertes aurait deux effets, tous deux faux : ouvrir la page éteindrait
 * des alertes jamais envoyées, et un retour après trente minutes ferait
 * renvoyer celles qui l'avaient déjà été. Le repère des alertes n'avance que
 * lorsqu'un message est parti.
 */

import path from "node:path";
import { DATA_DIR, readJson, serialize, writeJson } from "./json-file";

/** Doit rester identique au chemin qu'écrit `collect/veille.ts`. */
export const VEILLE_DIR = path.join(DATA_DIR, "veille");
const FILE = path.join(VEILLE_DIR, "state.json");

export interface VeilleState {
  /**
   * Les annonces découvertes **après** cette date restent à annoncer. Un seul
   * repère global, là où l'appairage Telegram en tenait un par personne : le
   * webhook Discord écrit dans un seul salon, il n'y a plus de destinataire à
   * distinguer. Absent au premier passage — on le pose alors à « maintenant »,
   * sans quoi la première alerte déverserait tout l'historique du disque.
   */
  notifiedAt?: number;
  /** Alertes envoyées au total, pour le journal et la page Alertes. */
  sent?: number;
  /** Date du dernier balayage abouti, en ms epoch. */
  at?: number;
  /** Résumé du dernier passage, tel que la page Alertes l'affiche. */
  summary?: string;
}

const EMPTY: VeilleState = {};

/**
 * Lecture tolérante : le fichier n'existe pas tant que la veille n'a pas tourné
 * une première fois, et le site doit s'afficher quand même.
 */
export async function readVeille(): Promise<VeilleState> {
  const parsed = await readJson<Partial<VeilleState>>(FILE);
  if (!parsed) return { ...EMPTY };
  return {
    notifiedAt: typeof parsed.notifiedAt === "number" ? parsed.notifiedAt : undefined,
    sent: typeof parsed.sent === "number" ? parsed.sent : undefined,
    at: parsed.at,
    summary: parsed.summary,
  };
}

/** Réservé à `collect/veille.ts` : le site ne fait que lire ce fichier. */
export async function writeVeille(state: VeilleState): Promise<void> {
  await serialize("veille", () => writeJson(FILE, state));
}

/**
 * Lecture datée de l'horloge du serveur.
 *
 * `Date.now()` appelé dans le corps d'un composant le rend impur — le linter le
 * refuse, et à raison : le rendu serveur cesserait de coïncider avec celui du
 * client. Même remède que `FeedVisit.now` côté fil, l'horloge est relevée ici
 * puis passée au rendu.
 */
export async function readVeilleAt(): Promise<{ state: VeilleState; now: number }> {
  const state = await readVeille();
  return { state, now: Date.now() };
}
