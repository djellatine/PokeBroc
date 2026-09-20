/**
 * Client du catalogue Vinted.
 *
 * Vinted n'expose pas d'API publique documentée. Son catalogue
 * (`api.vinted.fr/svc-catalogue/items`, depuis septembre 2026) exige le cookie
 * de session anonyme `access_token_web` — et depuis le 13 septembre 2026, ce
 * cookie ne s'obtient plus par un simple `fetch` de la page d'accueil : Vinted
 * a mis Cloudflare devant `www.vinted.fr`, dont le défi JavaScript ne se
 * franchit qu'en vrai navigateur. C'est `collect/vinted_session.py` qui
 * l'ouvre (voir son en-tête pour la mesure) et le dépose dans
 * `.data/vinted/session.json` ; ici on le lit, on l'utilise vingt-quatre
 * heures — sa durée de vie — et on demande à l'amorceur de le renouveler quand
 * il manque, expire ou se fait refuser. Le catalogue lui-même n'est pas
 * derrière le défi : le `fetch` de Node y passe avec le seul cookie.
 *
 * Les appels sortants sont sérialisés avec un délai minimum pour rester dans
 * un usage raisonnable, et les résultats mis en cache un court instant.
 */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR, readJson } from "./json-file";

const HOST = "https://www.vinted.fr";
const CATALOGUE = "https://api.vinted.fr/svc-catalogue/items";

/**
 * Délai maximal d'une requête. Sans lui, une connexion muette bloque la veille
 * jusqu'à ce que le lanceur la tue — et un passage tué n'écrit ni instantané
 * ni journal. Vingt secondes : Vinted répond d'ordinaire en une.
 */
const REQUEST_TIMEOUT_MS = 20_000;

const MIN_INTERVAL_MS = 350;
const CACHE_TTL_MS = 90 * 1000;
const CACHE_MAX_ENTRIES = 200;

export type VintedOrder =
  | "relevance"
  | "newest_first"
  | "price_low_to_high"
  | "price_high_to_low";

export interface VintedSearchParams {
  query: string;
  page?: number;
  perPage?: number;
  order?: VintedOrder;
  priceFrom?: number;
  priceTo?: number;
  /**
   * Ignorer le cache de réponses, sans cesser de l'alimenter.
   *
   * Réservé au bouton « Actualiser ». Sans ce drapeau, forcer la collecte ne
   * servait à rien pendant quatre-vingt-dix secondes : `refreshCard` relançait
   * bien la recherche, mais elle ressortait d'ici inchangée — et l'annonce
   * qu'on venait voir restait invisible. Le délai entre deux forçages borne le
   * contournement à un par carte et par trente secondes.
   */
  fresh?: boolean;
}

export interface VintedItem {
  id: number;
  title: string;
  url: string;
  photo: string | null;
  thumbnail: string | null;
  price: number | null;
  totalPrice: number | null;
  serviceFee: number | null;
  currency: string;
  brand: string | null;
  status: string | null;
  favourites: number;
  views: number;
  promoted: boolean;
  /**
   * Mise en ligne, en millisecondes epoch. Vinted n'expose pas de date de
   * création dans son catalogue ; l'ancien en donnait une par l'horodatage de
   * la photo, le nouveau (septembre 2026) ne le porte plus. On la lit si elle
   * revient, et l'on s'en passe sinon : le tri « nouveautés » repose sur
   * `newest_first` côté Vinted et sur `firstSeen` côté fil.
   */
  createdAt: number | null;
  seller: { login: string | null; url: string | null; business: boolean };
}

export interface VintedSearchResult {
  items: VintedItem[];
  total: number;
  page: number;
  totalPages: number;
  perPage: number;
}

/* ------------------------------------------------------------------ session */

/** Ce que `collect/vinted_session.py` dépose. */
interface SessionFile {
  at: number;
  expiresAt: number;
  userAgent: string;
  cookies: Record<string, string>;
}

interface Session {
  at: number;
  userAgent: string;
  cookie: string;
  anonId: string | null;
}

const SESSION_FILE = path.join(DATA_DIR, "vinted", "session.json");
const AMORCEUR = path.join(process.cwd(), "collect", "vinted_session.py");

/** En deçà de l'expiration, on renouvelle avant plutôt qu'après. */
const SESSION_MARGIN_MS = 5 * 60_000;

/** On relit le fichier au plus toutes les trente secondes, pas à chaque appel. */
const SESSION_RECHECK_MS = 30_000;

/**
 * Un amorçage lance un navigateur : quelques secondes d'ordinaire, davantage
 * si Cloudflare défie. Au-delà, on rend la main.
 */
const AMORCAGE_TIMEOUT_MS = 150_000;

/**
 * Après un amorçage raté, on n'en relance pas un à chaque recherche — la
 * veille en ferait deux cents en un passage. Cinq minutes de répit.
 */
const AMORCAGE_COOLDOWN_MS = 5 * 60_000;

const exec = promisify(execFile);

let session: Session | null = null;
let sessionCheckedAt = 0;
/** `at` de la session que Vinted a refusée : ne pas la relire comme valable. */
let rejectedAt = 0;
let lastFailedAmorcage = 0;
let pending: Promise<Session> | null = null;

/** Interpréteur Python de l'amorceur. Absent, on se contente du fichier. */
function python(): string | null {
  return process.env.VINTED_PYTHON?.trim() || null;
}

function toSession(file: SessionFile): Session {
  const cookies = file.cookies;
  return {
    at: file.at,
    userAgent: file.userAgent,
    cookie: Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; "),
    anonId: cookies.anon_id ?? null,
  };
}

async function readSessionFile(now: number): Promise<Session | null> {
  const file = await readJson<SessionFile>(SESSION_FILE);
  if (
    !file ||
    typeof file.at !== "number" ||
    typeof file.expiresAt !== "number" ||
    typeof file.userAgent !== "string" ||
    !file.cookies ||
    typeof file.cookies.access_token_web !== "string"
  ) {
    return null;
  }
  if (file.at === rejectedAt) return null;
  if (file.expiresAt - now < SESSION_MARGIN_MS) return null;
  return toSession(file);
}

/**
 * Lance l'amorceur et attend qu'il ait déposé une session.
 *
 * `force` quand Vinted vient de refuser la session en place : sans lui,
 * l'amorceur la trouverait valable sur sa date et n'en ouvrirait pas d'autre.
 */
async function amorcer(force: boolean): Promise<void> {
  const interpreter = python();
  if (!interpreter) {
    throw new Error(
      "Session Vinted absente ou expirée : lancez `python collect/vinted_session.py` " +
        "(ou renseignez VINTED_PYTHON pour que le site s'en charge).",
    );
  }
  const now = Date.now();
  if (now - lastFailedAmorcage < AMORCAGE_COOLDOWN_MS) {
    throw new Error("Session Vinted à renouveler ; nouvel essai dans quelques minutes.");
  }
  try {
    await exec(interpreter, [AMORCEUR, "--quiet", ...(force ? ["--force"] : [])], {
      timeout: AMORCAGE_TIMEOUT_MS,
      cwd: process.cwd(),
      windowsHide: true,
    });
  } catch (error) {
    lastFailedAmorcage = Date.now();
    console.error("[vinted] amorçage", error);
    throw new Error(
      "Impossible d'ouvrir une session Vinted (défi Cloudflare ou navigateur absent). Réessayez dans quelques minutes.",
    );
  }
}

async function openSession(force: boolean): Promise<Session> {
  const now = Date.now();
  let found = force ? null : await readSessionFile(now);
  if (!found) {
    await amorcer(force);
    found = await readSessionFile(Date.now());
    if (!found) {
      lastFailedAmorcage = Date.now();
      throw new Error("L'amorceur Vinted n'a déposé aucune session valable.");
    }
  }
  session = found;
  sessionCheckedAt = Date.now();
  return found;
}

async function getSession(force = false): Promise<Session> {
  const now = Date.now();
  if (!force && session && now - sessionCheckedAt < SESSION_RECHECK_MS) {
    return session;
  }
  if (!force && session) {
    // Le fichier a-t-il changé sous nos pieds (amorçage lancé par un autre
    // processus — la veille, le site) ? On le relit s'il est plus récent.
    const fresh = await stat(SESSION_FILE)
      .then((s) => s.mtimeMs > sessionCheckedAt)
      .catch(() => true);
    if (!fresh) {
      sessionCheckedAt = now;
      return session;
    }
  }
  if (!pending) {
    pending = openSession(force).finally(() => {
      pending = null;
    });
  }
  return pending;
}

/* ----------------------------------------------------------------- throttle */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

/** Sérialise les appels sortants avec un délai minimum entre deux requêtes. */
function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return task();
  });
  chain = run.catch(() => undefined);
  return run;
}

/* -------------------------------------------------------------------- cache */

const cache = new Map<string, { at: number; value: VintedSearchResult }>();

function cacheGet(key: string): VintedSearchResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // rafraîchit la position LRU
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key: string, value: VintedSearchResult): void {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/* ------------------------------------------------------------------ mapping */

interface RawAmount {
  amount?: string;
  currency_code?: string;
}
interface RawPhoto {
  url?: string;
  thumbnails?: { type: string; url: string }[];
  high_resolution?: { timestamp?: number } | null;
}
/**
 * Un article tel que le catalogue de septembre 2026 le rend. La marque et
 * l'état ne sont plus des champs à part : ils font les deux lignes de la
 * vignette (`item_box`). Les anciens champs sont lus s'ils reviennent.
 */
export interface RawVintedItem {
  id: number;
  title?: string;
  url?: string;
  path?: string;
  photo?: RawPhoto | null;
  photos?: RawPhoto[] | null;
  price?: RawAmount | null;
  total_item_price?: RawAmount | null;
  service_fee?: RawAmount | null;
  brand_title?: string | null;
  status?: string | null;
  item_box?: { first_line?: string | null; second_line?: string | null } | null;
  favourite_count?: number;
  view_count?: number;
  promoted?: boolean;
  user?: { id?: number; login?: string; profile_url?: string; business?: boolean } | null;
}

function amount(value: RawAmount | null | undefined): number | null {
  const n = Number.parseFloat(value?.amount ?? "");
  return Number.isFinite(n) ? n : null;
}

/** Horodatage de la photo principale, à défaut de la première photo disponible. */
function uploadedAt(raw: RawVintedItem): number | null {
  const seconds =
    raw.photo?.high_resolution?.timestamp ??
    raw.photos?.find((photo) => photo?.high_resolution?.timestamp)?.high_resolution?.timestamp;
  return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : null;
}

/** Les liens du catalogue sont désormais relatifs (`/items/123-titre`). */
function absolute(link: string | undefined): string | null {
  if (!link) return null;
  return link.startsWith("/") ? `${HOST}${link}` : link;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function mapVintedItem(raw: RawVintedItem): VintedItem {
  const thumbs = raw.photo?.thumbnails ?? [];
  const thumb =
    thumbs.find((t) => t.type === "thumb310x430")?.url ??
    thumbs.find((t) => t.type === "thumb150x210")?.url ??
    raw.photo?.url ??
    null;
  const userId = raw.user?.id;

  return {
    id: raw.id,
    title: raw.title ?? "Annonce sans titre",
    url: absolute(raw.url) ?? absolute(raw.path) ?? `${HOST}/items/${raw.id}`,
    photo: raw.photo?.url ?? null,
    thumbnail: thumb,
    price: amount(raw.price),
    totalPrice: amount(raw.total_item_price),
    serviceFee: amount(raw.service_fee),
    currency: raw.price?.currency_code ?? "EUR",
    brand: text(raw.brand_title) ?? text(raw.item_box?.first_line),
    status: text(raw.status) ?? text(raw.item_box?.second_line),
    favourites: raw.favourite_count ?? 0,
    views: raw.view_count ?? 0,
    promoted: Boolean(raw.promoted),
    createdAt: uploadedAt(raw),
    seller: {
      login: raw.user?.login ?? null,
      url:
        absolute(raw.user?.profile_url) ??
        (typeof userId === "number" ? `${HOST}/member/${userId}` : null),
      business: Boolean(raw.user?.business),
    },
  };
}

/* ------------------------------------------------------------------ requête */

function buildUrl(params: VintedSearchParams): string {
  const url = new URL(CATALOGUE);
  url.searchParams.set("search_text", params.query);
  url.searchParams.set("page", String(Math.max(1, params.page ?? 1)));
  url.searchParams.set("per_page", String(Math.min(96, Math.max(1, params.perPage ?? 48))));
  url.searchParams.set("order", params.order ?? "relevance");
  url.searchParams.set("currency", "EUR");
  if (params.priceFrom !== undefined) url.searchParams.set("price_from", String(params.priceFrom));
  if (params.priceTo !== undefined) url.searchParams.set("price_to", String(params.priceTo));
  return url.toString();
}

async function call(url: string, current: Session): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": current.userAgent,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "fr-FR,fr;q=0.9",
      Cookie: current.cookie,
      Origin: HOST,
      Referer: `${HOST}/catalog`,
      ...(current.anonId ? { "X-Anon-Id": current.anonId } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function searchVinted(params: VintedSearchParams): Promise<VintedSearchResult> {
  const query = params.query.trim();
  if (!query) {
    return { items: [], total: 0, page: 1, totalPages: 0, perPage: params.perPage ?? 48 };
  }

  const url = buildUrl({ ...params, query });
  // Le résultat sera écrit dans le cache dans tous les cas : `fresh` court-circuite
  // la lecture, pas l'alimentation. Le visiteur qui force paie l'aller-retour,
  // les suivants en profitent.
  const cached = params.fresh ? null : cacheGet(url);
  if (cached) return cached;

  const result = await schedule(async () => {
    let current = await getSession();
    let res = await call(url, current);

    // Session expirée ou rejetée : on en fait ouvrir une nouvelle et on retente
    // une fois. La session refusée est marquée pour ne pas être relue.
    if (res.status === 401 || res.status === 403) {
      rejectedAt = current.at;
      current = await getSession(true);
      res = await call(url, current);
    }

    if (!res.ok) {
      throw new Error(
        res.status === 429
          ? "Vinted limite temporairement les requêtes. Patientez quelques secondes."
          : `Vinted a répondu ${res.status}.`,
      );
    }

    const json = (await res.json()) as {
      items?: RawVintedItem[];
      pagination?: {
        current_page?: number;
        total_pages?: number;
        total_entries?: number;
        per_page?: number;
      };
    };

    const pagination = json.pagination ?? {};
    return {
      items: (json.items ?? []).map(mapVintedItem),
      total: pagination.total_entries ?? 0,
      page: pagination.current_page ?? 1,
      totalPages: pagination.total_pages ?? 0,
      perPage: pagination.per_page ?? params.perPage ?? 48,
    } satisfies VintedSearchResult;
  });

  cacheSet(url, result);
  return result;
}
