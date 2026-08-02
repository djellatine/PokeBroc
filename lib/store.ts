/**
 * Stockage des comptes et des favoris dans un fichier JSON (`.data/users.json`).
 *
 * Choix assumé pour un projet perso : aucune dépendance, aucun service à lancer.
 * Toute la surface publique est asynchrone et ignore la forme du stockage, ce qui
 * permet de remplacer ce module par un vrai SGBD sans toucher aux pages.
 *
 * Le fichier est relu seulement quand il a changé sur le disque (comparaison de
 * `mtime` et de la taille) : sans ce cache, chaque requête reparsait l'intégralité
 * des comptes pour n'en retrouver qu'un.
 *
 * Limites : un seul processus Node à la fois (les écritures sont sérialisées en
 * mémoire, pas verrouillées sur le disque).
 */

import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, readJson, serialize, writeJson } from "./json-file";

const FILE = path.join(DATA_DIR, "users.json");

export interface FavoriteCard {
  cardId: string;
  name: string;
  /** Base d'URL TCGdex, sans extension — voir `cardImage()`. */
  image: string | null;
  localId: string | null;
  setName: string | null;
  addedAt: string;
}

export interface User {
  id: string;
  email: string;
  /** Format `salt:clé` en hexadécimal — voir `lib/auth.ts`. */
  passwordHash: string;
  createdAt: string;
  favorites: FavoriteCard[];
  /** Dernier passage sur le fil, en ms epoch. Voir `touchFeedVisit()`. */
  feedSeenAt?: number;
  /** Repère du badge « nouveau » : les annonces vues après ne l'étaient pas. */
  feedNewSince?: number;
}

interface Database {
  users: User[];
}

/* -------------------------------------------------------------------- lecture */

let cache: { mtimeMs: number; size: number; db: Database } | null = null;

async function read(): Promise<Database> {
  let info;
  try {
    info = await stat(FILE);
  } catch {
    // Premier démarrage : le fichier n'existe pas encore.
    return { users: [] };
  }

  if (cache && cache.mtimeMs === info.mtimeMs && cache.size === info.size) {
    return cache.db;
  }

  const parsed = await readJson<Partial<Database>>(FILE);
  const db: Database = { users: Array.isArray(parsed?.users) ? parsed.users : [] };
  cache = { mtimeMs: info.mtimeMs, size: info.size, db };
  return db;
}

/**
 * Copie défensive : le résultat de `read()` est partagé entre tous les appelants
 * tant que le fichier ne bouge pas. Le muter à distance corromprait le cache.
 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Sérialise les écritures, et relit toujours le disque : partir du cache
 * risquerait d'écrire par-dessus une version qu'on aurait mutée en mémoire.
 */
function transaction<T>(mutate: (db: Database) => T): Promise<T> {
  return serialize("users", async () => {
    const parsed = await readJson<Partial<Database>>(FILE);
    const db: Database = { users: Array.isArray(parsed?.users) ? parsed.users : [] };
    const result = mutate(db);
    await writeJson(FILE, db);
    cache = null;
    return result;
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/* ------------------------------------------------------------------ comptes */

export async function findUserByEmail(email: string): Promise<User | null> {
  const needle = normalizeEmail(email);
  const db = await read();
  const user = db.users.find((entry) => entry.email === needle);
  return user ? clone(user) : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const db = await read();
  const user = db.users.find((entry) => entry.id === id);
  return user ? clone(user) : null;
}

export async function countUsers(): Promise<number> {
  return (await read()).users.length;
}

/** Crée un compte, ou renvoie `null` si l'adresse est déjà prise. */
export async function insertUser(email: string, passwordHash: string): Promise<User | null> {
  const normalized = normalizeEmail(email);
  const now = Date.now();
  // Le contrôle d'unicité est fait dans la transaction : deux inscriptions
  // simultanées avec la même adresse ne peuvent pas passer toutes les deux.
  return transaction((db) => {
    if (db.users.some((user) => user.email === normalized)) return null;
    const user: User = {
      id: randomUUID(),
      email: normalized,
      passwordHash,
      createdAt: new Date(now).toISOString(),
      favorites: [],
      feedSeenAt: now,
      feedNewSince: now,
    };
    db.users.push(user);
    return clone(user);
  });
}

/* ------------------------------------------------------------------ favoris */

/** Ajoute une carte à la collection. Idempotent : une carte déjà là n'est pas dupliquée. */
export async function addFavorite(
  userId: string,
  card: Omit<FavoriteCard, "addedAt">,
): Promise<boolean> {
  return transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return false;
    if (user.favorites.some((favorite) => favorite.cardId === card.cardId)) return true;
    user.favorites.unshift({ ...card, addedAt: new Date().toISOString() });
    return true;
  });
}

export async function removeFavorite(userId: string, cardId: string): Promise<boolean> {
  return transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return false;
    user.favorites = user.favorites.filter((favorite) => favorite.cardId !== cardId);
    return true;
  });
}

/** Union des cartes suivies par l'ensemble des comptes, sans doublon. */
export async function allTrackedCards(): Promise<FavoriteCard[]> {
  const db = await read();
  const byId = new Map<string, FavoriteCard>();
  for (const user of db.users) {
    for (const favorite of user.favorites) byId.set(favorite.cardId, favorite);
  }
  return clone([...byId.values()]);
}

/* ------------------------------------------------------- badge « nouveau » */

/**
 * Au-delà de cet écart entre deux passages, la visite est considérée comme
 * nouvelle. En deçà, on prolonge la précédente.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * Enregistre un passage sur le fil et renvoie la date de référence du badge
 * « nouveau ».
 *
 * Le repère ne bouge pas à chaque rechargement : sans cela, un simple F5
 * effacerait les pastilles qu'on vient tout juste d'afficher. Il n'avance que
 * lorsque l'utilisateur revient après une vraie interruption, et vaut alors la
 * fin de la session précédente.
 */
export interface FeedVisit {
  /** Les annonces vues après cette date portent la pastille « nouveau ». */
  newSince: number;
  /**
   * Horloge du serveur au moment de la visite. Renvoyée plutôt que relue par
   * l'appelant : un composant qui appelle `Date.now()` pendant son rendu n'est
   * plus pur, et le rendu serveur cesserait de coïncider avec celui du client.
   */
  now: number;
}

export async function touchFeedVisit(userId: string, at?: number): Promise<FeedVisit> {
  const now = at ?? Date.now();

  const newSince = await transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return now;

    const previousVisit = user.feedSeenAt ?? 0;

    if (previousVisit === 0) {
      // Première visite : tout serait « nouveau », ce qui ne veut rien dire.
      user.feedNewSince = now;
    } else if (now - previousVisit > SESSION_GAP_MS) {
      user.feedNewSince = previousVisit;
    }

    user.feedSeenAt = now;
    return user.feedNewSince ?? now;
  });

  return { newSince, now };
}

/** Remet le repère à maintenant : « tout marquer comme vu ». */
export async function markFeedSeen(userId: string, now = Date.now()): Promise<void> {
  await transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (user) {
      user.feedNewSince = now;
      user.feedSeenAt = now;
    }
  });
}

/** Vide le cache de lecture. Réservé aux tests. */
export function resetStoreCache(): void {
  cache = null;
}
