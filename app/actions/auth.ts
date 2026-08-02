"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { clientIp, rateLimit, refund } from "@/lib/rate-limit";
import { findUserByEmail, insertUser, normalizeEmail } from "@/lib/store";

export interface AuthState {
  error?: string;
  /** Réinjecté dans le formulaire pour ne pas refaire saisir l'adresse. */
  email?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const MAX_LENGTH = 200;

/**
 * Hash jetable, structurellement valide mais qui ne correspond à aucun mot de
 * passe. On l'utilise quand l'adresse est inconnue afin que la connexion prenne
 * le même temps qu'avec un compte existant — sinon le délai de réponse révèle
 * quelles adresses sont inscrites.
 */
const DUMMY_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

/* ------------------------------------------------------------ plafonnement */

const QUARTER_HOUR = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Tentatives de connexion tolérées par quart d'heure.
 *
 * Deux compteurs, parce qu'ils protègent de deux choses différentes : la limite
 * par adresse IP arrête le balayage d'un dictionnaire depuis une machine, celle
 * par e-mail protège un compte précis d'une attaque distribuée. Le second
 * plafond est plus bas — personne ne se trompe huit fois sur son propre mot de
 * passe en un quart d'heure.
 */
const LOGIN_PER_IP = 20;
const LOGIN_PER_EMAIL = 8;
const REGISTER_PER_IP = 5;

async function ip(): Promise<string> {
  return clientIp(await headers());
}

function credentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").slice(0, MAX_LENGTH),
    password: String(formData.get("password") ?? "").slice(0, MAX_LENGTH),
  };
}

function tooMany(retryAfter: number): AuthState {
  const minutes = Math.ceil(retryAfter / 60);
  return {
    error:
      minutes > 1
        ? `Trop de tentatives. Réessayez dans ${minutes} minutes.`
        : "Trop de tentatives. Réessayez dans une minute.",
  };
}

/* --------------------------------------------------------------- actions */

export async function register(
  _state: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = credentials(formData);
  const normalized = normalizeEmail(email);

  const quota = rateLimit(`register:${await ip()}`, REGISTER_PER_IP, HOUR);
  if (!quota.ok) return { ...tooMany(quota.retryAfter), email };

  if (!EMAIL_RE.test(normalized)) {
    return { error: "Adresse e-mail invalide.", email };
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`, email };
  }

  const user = await insertUser(normalized, await hashPassword(password));
  if (!user) {
    return { error: "Un compte existe déjà avec cette adresse.", email };
  }

  await createSession(user.id);
  redirect("/");
}

export async function login(
  _state: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = credentials(formData);
  const normalized = normalizeEmail(email);
  const address = await ip();

  const byIp = rateLimit(`login:ip:${address}`, LOGIN_PER_IP, QUARTER_HOUR);
  if (!byIp.ok) return { ...tooMany(byIp.retryAfter), email };

  const byEmail = rateLimit(`login:email:${normalized}`, LOGIN_PER_EMAIL, QUARTER_HOUR);
  if (!byEmail.ok) return { ...tooMany(byEmail.retryAfter), email };

  const user = await findUserByEmail(normalized);
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  // Message volontairement identique dans les deux cas.
  if (!user || !valid) {
    return { error: "Adresse e-mail ou mot de passe incorrect.", email };
  }

  // Une connexion réussie ne doit rien coûter : sans cette remise à zéro, se
  // reconnecter huit fois dans la journée depuis le même poste finirait par
  // verrouiller son propre compte.
  refund(`login:ip:${address}`);
  refund(`login:email:${normalized}`);

  await createSession(user.id);
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
}
