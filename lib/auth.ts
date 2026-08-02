/**
 * Mots de passe et sessions, sans dépendance externe.
 *
 * - Mot de passe : scrypt (module `node:crypto`) avec sel aléatoire par compte.
 * - Session : cookie `httpOnly` contenant `userId.expiration.signature`. Le
 *   contenu est lisible mais signé en HMAC-SHA256 : impossible à forger sans la
 *   clé, donc inutile d'aller lire une table de sessions à chaque requête.
 */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findUserById, type User } from "./store";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const COOKIE = "pokebroc_session";
const MAX_AGE_S = 30 * 24 * 3600;
const KEY_LEN = 64;
const SALT_LEN = 16;

/* ---------------------------------------------------------- mots de passe */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  if (expected.length !== KEY_LEN) return false;

  const key = await scryptAsync(password, Buffer.from(saltHex, "hex"), KEY_LEN);
  return timingSafeEqual(key, expected);
}

/* ------------------------------------------------------------------- clé */

const SECRET_FILE = path.join(process.cwd(), ".data", "session-secret");
let secretPromise: Promise<string> | null = null;

async function loadSecret(): Promise<string> {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;

  // Sans clé fournie, on en génère une et on la conserve : sinon un redémarrage
  // déconnecterait tout le monde.
  try {
    const existing = (await readFile(SECRET_FILE, "utf8")).trim();
    if (existing) return existing;
  } catch {
    /* première exécution */
  }

  const generated = randomBytes(32).toString("hex");
  await mkdir(path.dirname(SECRET_FILE), { recursive: true });
  await writeFile(SECRET_FILE, generated, "utf8");
  console.warn(
    "[auth] SESSION_SECRET absent : clé générée dans .data/session-secret. " +
      "Définissez SESSION_SECRET en production.",
  );
  return generated;
}

function getSecret(): Promise<string> {
  secretPromise ??= loadSecret();
  return secretPromise;
}

/* ---------------------------------------------------------------- jetons */

async function sign(payload: string): Promise<string> {
  return createHmac("sha256", await getSecret()).update(payload).digest("base64url");
}

async function createToken(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now() + MAX_AGE_S * 1000}`;
  return `${payload}.${await sign(payload)}`;
}

/** Renvoie l'identifiant contenu dans un jeton valide et non expiré, sinon `null`. */
async function readToken(token: string): Promise<string | null> {
  // Les identifiants sont des UUID : ils ne contiennent jamais de point.
  const [userId, expiry, signature] = token.split(".");
  if (!userId || !expiry || !signature) return null;

  const expected = Buffer.from(await sign(`${userId}.${expiry}`));
  const received = Buffer.from(signature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  const expiresAt = Number(expiry);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() ? userId : null;
}

/* -------------------------------------------------------------- sessions */

export async function createSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, await createToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Utilisateur connecté, ou `null`. Mémoïsé sur la durée d'un rendu. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const userId = await readToken(token);
  return userId ? findUserById(userId) : null;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  return user;
}
