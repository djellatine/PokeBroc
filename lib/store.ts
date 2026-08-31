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

import { randomInt, randomUUID } from "node:crypto";
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
  /**
   * Carte précieuse à surveiller *aussi* sur Cardmarket. Volontairement opt-in
   * et par carte, non global : sonder Cardmarket demande un navigateur piloté
   * (voir `collect/cardmarket.py`), trop coûteux pour l'appliquer aux dizaines
   * de cartes épinglées. Absent vaut « non » — le champ n'existe que sur les
   * cartes cochées, pour ne pas alourdir les autres.
   */
  cardmarket?: boolean;
  /**
   * Critères de recherche Cardmarket pour cette carte. La langue n'y figure
   * pas : elle est toujours le français, imposée par le collecteur — un
   * collectionneur francophone ne guette pas une carte japonaise. Seuls varient
   * le tirage `reverse` et la `firstEd` (première édition), qui changent
   * radicalement la cote et donc ce qu'on veut surveiller. Absent = version
   * standard, sans reverse ni première édition.
   */
  cardmarketPrefs?: { reverse?: boolean; firstEd?: boolean };
  /**
   * Lien Cardmarket collé à la main. Le collecteur résout tout seul l'URL des
   * cartes courantes, mais échoue sur les anciennes ou rares que la recherche
   * ne remonte pas — cf. l'écueil déjà documenté pour leboncoin. Ce champ passe
   * outre : quand il est là, le collecteur sonde cette page-là sans chercher.
   * C'est la porte de sortie pour toute carte que la résolution ne trouve pas.
   */
  cardmarketUrl?: string;
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
  /**
   * Annonces écartées du fil à la main, par identifiant (`vinted:123`), datées
   * du geste.
   *
   * Un dictionnaire plutôt qu'un tableau, pour deux raisons. La première est la
   * date, sans laquelle le plafond n'aurait rien à trancher — voir
   * `pruneHidden`. La seconde est la lecture : la veille interroge cette liste
   * pour *chaque* annonce de *chaque* carte suivie, et un `includes` sur mille
   * identifiants coûterait mille comparaisons à chaque annonce.
   *
   * Sur le serveur et non dans `localStorage` : une annonce congédiée depuis le
   * téléphone doit le rester sur l'ordinateur, et la veille — qui tourne dans un
   * autre processus — doit pouvoir la lire pour ne pas annoncer sur Telegram ce
   * qu'on vient tout juste d'écarter.
   */
  hidden?: Record<string, number>;
  /**
   * Code d'appairage Telegram en attente, à envoyer au bot. Voir
   * `startTelegramLink()` — le lien lui-même vit dans `.data/veille/state.json`,
   * que la veille est seule à écrire.
   */
  telegramCode?: string;
  /** Émission du code, en ms epoch. Passé le délai, le code ne vaut plus rien. */
  telegramCodeAt?: number;
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

/**
 * Coche ou décoche une carte pour la surveillance Cardmarket, avec ses critères.
 *
 * Les champs sont retirés plutôt que mis à `false` quand on décoche :
 * `cardmarket` n'existe que sur les cartes surveillées, ce qui garde
 * `users.json` propre et fait de la liste de chasse un simple filtre de
 * présence. De même, un critère `reverse`/`firstEd` faux n'est pas stocké — la
 * version standard est l'absence de préférence, pas une préférence à `false`.
 */
export async function setCardmarketWatch(
  userId: string,
  cardId: string,
  on: boolean,
  prefs: { reverse?: boolean; firstEd?: boolean } = {},
  url: string | null = null,
): Promise<boolean> {
  return transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return false;
    const favorite = user.favorites.find((entry) => entry.cardId === cardId);
    if (!favorite) return false;

    if (!on) {
      delete favorite.cardmarket;
      delete favorite.cardmarketPrefs;
      // Le lien collé, lui, survit à un décochage : le retrouver a coûté un
      // aller sur Cardmarket, et la carte reste épinglée. Le retirer forcerait
      // à le recoller au prochain suivi.
      return true;
    }

    favorite.cardmarket = true;
    const kept: { reverse?: boolean; firstEd?: boolean } = {};
    if (prefs.reverse) kept.reverse = true;
    if (prefs.firstEd) kept.firstEd = true;
    if (Object.keys(kept).length > 0) favorite.cardmarketPrefs = kept;
    else delete favorite.cardmarketPrefs;

    // `null` laisse le lien tel quel ; chaîne vide l'efface ; sinon on pose la
    // valeur fournie (déjà validée par l'appelant).
    if (url === "") delete favorite.cardmarketUrl;
    else if (url !== null) favorite.cardmarketUrl = url;
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

/* ------------------------------------------------------ annonces masquées */

/**
 * Annonces masquées conservées par compte.
 *
 * Sans plafond, `users.json` grossirait sans fin : un masquage est définitif,
 * alors que l'annonce, elle, disparaît de la place de marché au bout de
 * quelques semaines — passé quoi son identifiant ne protège plus de rien. Les
 * plus anciennement masquées sautent donc en premier : ce sont celles dont
 * l'annonce a le plus de chances d'être déjà vendue, et de ne jamais revenir
 * dans le fil.
 *
 * Mille, c'est vingt-cinq fois ce qu'un fil affiche d'un coup : y toucher
 * suppose d'avoir masqué mille annonces sans jamais en réafficher une.
 */
export const MAX_HIDDEN = 1000;

/**
 * Ramène le dictionnaire sous le plafond, en gardant les masquages les plus
 * récents. Exporté pour les tests : une règle de rétention qui se trompe de
 * sens ne se voit qu'au millième masquage.
 */
export function pruneHidden(hidden: Record<string, number>): Record<string, number> {
  const entries = Object.entries(hidden);
  if (entries.length <= MAX_HIDDEN) return hidden;
  return Object.fromEntries(entries.sort(([, a], [, b]) => b - a).slice(0, MAX_HIDDEN));
}

/**
 * Écarte une annonce du fil.
 *
 * Idempotent au résultat près : masquer deux fois la même annonce ne fait que
 * redater le geste, ce qui la remet en tête face au plafond — et c'est bien ce
 * qu'on veut, puisque c'est le signe qu'elle revient.
 */
export async function hideListing(
  userId: string,
  itemId: string,
  at = Date.now(),
): Promise<boolean> {
  return transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return false;
    user.hidden = pruneHidden({ ...user.hidden, [itemId]: at });
    return true;
  });
}

/** Rend une annonce au fil. Sans effet si elle n'y était pas. */
export async function unhideListing(userId: string, itemId: string): Promise<boolean> {
  return transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return false;
    if (user.hidden) delete user.hidden[itemId];
    return true;
  });
}

/** « Tout réafficher » : le fil repart sans aucun masquage. */
export async function unhideAllListings(userId: string): Promise<boolean> {
  return transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return false;
    delete user.hidden;
    return true;
  });
}

/* ------------------------------------------------- appairage Telegram */

/**
 * Durée de validité d'un code d'appairage.
 *
 * Un code sans péremption reste indéfiniment une clé : qui le lit par-dessus
 * une épaule peut brancher *sa* conversation Telegram sur le compte d'un autre,
 * des semaines plus tard. Un quart d'heure suffit largement à ouvrir Telegram
 * et à coller six caractères.
 */
export const TELEGRAM_CODE_TTL_MS = 15 * 60 * 1000;

/** Sans I, O, 0 ni 1 : le code se lit sur un écran et se retape à la main. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/**
 * Émet un code d'appairage et le renvoie.
 *
 * `randomInt` plutôt que `Math.random` : ce code autorise l'accès aux alertes
 * d'un compte le temps de sa validité, et un générateur prévisible se devine.
 *
 * L'appairage lui-même n'est pas écrit ici : il vit dans `.data/veille/`, que
 * la veille est seule à écrire — voir l'en-tête de `lib/veille.ts`.
 */
export async function startTelegramLink(userId: string): Promise<string | null> {
  const code = Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join("");

  return transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return null;
    user.telegramCode = code;
    user.telegramCodeAt = Date.now();
    return code;
  });
}

/** Retire le code en attente : appairage abouti, ou renoncement. */
export async function clearTelegramCode(userId: string): Promise<void> {
  await transaction((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (user) {
      delete user.telegramCode;
      delete user.telegramCodeAt;
    }
  });
}

/**
 * Compte portant ce code, s'il est encore valide.
 *
 * La comparaison est insensible à la casse et aux espaces : le code arrive
 * recopié à la main depuis un téléphone, souvent avec une majuscule
 * automatique ou une espace collée par le presse-papier.
 */
export async function findUserByTelegramCode(
  code: string,
  now = Date.now(),
): Promise<User | null> {
  const needle = code.trim().toUpperCase();
  if (needle.length !== CODE_LENGTH) return null;

  const db = await read();
  const user = db.users.find(
    (entry) =>
      entry.telegramCode === needle && now - (entry.telegramCodeAt ?? 0) < TELEGRAM_CODE_TTL_MS,
  );
  return user ? clone(user) : null;
}

/**
 * Tous les comptes.
 *
 * Pour la veille, qui notifie compte par compte : `allTrackedCards()` fond les
 * collections en une seule liste, ce qui convient pour balayer mais pas pour
 * savoir *à qui* envoyer quoi.
 */
export async function listUsers(): Promise<User[]> {
  return clone((await read()).users);
}

/** Vide le cache de lecture. Réservé aux tests. */
export function resetStoreCache(): void {
  cache = null;
}
