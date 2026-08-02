/**
 * Client de l'API catalogue publique de Vinted.
 *
 * Vinted n'expose pas d'API publique documentée : les endpoints /api/v2 exigent
 * des cookies de session anonyme, obtenus en visitant la page d'accueil. On garde
 * cette session en mémoire, on la renouvelle en cas de 401, et on sérialise les
 * appels avec un délai minimum pour rester dans un usage raisonnable.
 */

const HOST = "https://www.vinted.fr";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SESSION_TTL_MS = 9 * 60 * 1000;
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
   * création dans ce catalogue : on utilise l'horodatage de la photo, qui en est
   * le meilleur équivalent disponible.
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

let session: { cookie: string; createdAt: number } | null = null;
let pending: Promise<string> | null = null;

async function openSession(): Promise<string> {
  const res = await fetch(`${HOST}/`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    },
    redirect: "follow",
    cache: "no-store",
  });

  const jar = new Map<string, string>();
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value) jar.set(name, value);
  }

  if (!jar.has("access_token_web")) {
    throw new Error(
      "Impossible d'ouvrir une session Vinted (aucun jeton reçu). Réessayez dans un instant.",
    );
  }

  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  session = { cookie, createdAt: Date.now() };
  return cookie;
}

async function getCookie(force = false): Promise<string> {
  if (force) session = null;
  if (session && Date.now() - session.createdAt < SESSION_TTL_MS) {
    return session.cookie;
  }
  if (!pending) {
    pending = openSession().finally(() => {
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
interface RawItem {
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
  favourite_count?: number;
  view_count?: number;
  promoted?: boolean;
  user?: { login?: string; profile_url?: string; business?: boolean } | null;
}

function amount(value: RawAmount | null | undefined): number | null {
  const n = Number.parseFloat(value?.amount ?? "");
  return Number.isFinite(n) ? n : null;
}

/** Horodatage de la photo principale, à défaut de la première photo disponible. */
function uploadedAt(raw: RawItem): number | null {
  const seconds =
    raw.photo?.high_resolution?.timestamp ??
    raw.photos?.find((photo) => photo?.high_resolution?.timestamp)?.high_resolution?.timestamp;
  return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : null;
}

function mapItem(raw: RawItem): VintedItem {
  const thumbs = raw.photo?.thumbnails ?? [];
  const thumb =
    thumbs.find((t) => t.type === "thumb310x430")?.url ??
    thumbs.find((t) => t.type === "thumb150x210")?.url ??
    raw.photo?.url ??
    null;

  return {
    id: raw.id,
    title: raw.title ?? "Annonce sans titre",
    url: raw.url ?? (raw.path ? `${HOST}${raw.path}` : `${HOST}/items/${raw.id}`),
    photo: raw.photo?.url ?? null,
    thumbnail: thumb,
    price: amount(raw.price),
    totalPrice: amount(raw.total_item_price),
    serviceFee: amount(raw.service_fee),
    currency: raw.price?.currency_code ?? "EUR",
    brand: raw.brand_title ?? null,
    status: raw.status ?? null,
    favourites: raw.favourite_count ?? 0,
    views: raw.view_count ?? 0,
    promoted: Boolean(raw.promoted),
    createdAt: uploadedAt(raw),
    seller: {
      login: raw.user?.login ?? null,
      url: raw.user?.profile_url ?? null,
      business: Boolean(raw.user?.business),
    },
  };
}

/* ------------------------------------------------------------------ requête */

function buildUrl(params: VintedSearchParams): string {
  const url = new URL(`${HOST}/api/v2/catalog/items`);
  url.searchParams.set("search_text", params.query);
  url.searchParams.set("page", String(Math.max(1, params.page ?? 1)));
  url.searchParams.set("per_page", String(Math.min(96, Math.max(1, params.perPage ?? 48))));
  url.searchParams.set("order", params.order ?? "relevance");
  url.searchParams.set("currency", "EUR");
  if (params.priceFrom !== undefined) url.searchParams.set("price_from", String(params.priceFrom));
  if (params.priceTo !== undefined) url.searchParams.set("price_to", String(params.priceTo));
  return url.toString();
}

async function call(url: string, cookie: string): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "fr-FR,fr;q=0.9",
      Cookie: cookie,
      Referer: `${HOST}/catalog`,
      "X-Requested-With": "XMLHttpRequest",
    },
    cache: "no-store",
  });
}

export async function searchVinted(params: VintedSearchParams): Promise<VintedSearchResult> {
  const query = params.query.trim();
  if (!query) {
    return { items: [], total: 0, page: 1, totalPages: 0, perPage: params.perPage ?? 48 };
  }

  const url = buildUrl({ ...params, query });
  const cached = cacheGet(url);
  if (cached) return cached;

  const result = await schedule(async () => {
    let res = await call(url, await getCookie());

    // Session expirée ou rejetée : on en ouvre une nouvelle et on retente une fois.
    if (res.status === 401 || res.status === 403) {
      res = await call(url, await getCookie(true));
    }

    if (!res.ok) {
      throw new Error(
        res.status === 429
          ? "Vinted limite temporairement les requêtes. Patientez quelques secondes."
          : `Vinted a répondu ${res.status}.`,
      );
    }

    const json = (await res.json()) as {
      items?: RawItem[];
      pagination?: {
        current_page?: number;
        total_pages?: number;
        total_entries?: number;
        per_page?: number;
      };
    };

    const pagination = json.pagination ?? {};
    return {
      items: (json.items ?? []).map(mapItem),
      total: pagination.total_entries ?? 0,
      page: pagination.current_page ?? 1,
      totalPages: pagination.total_pages ?? 0,
      perPage: pagination.per_page ?? params.perPage ?? 48,
    } satisfies VintedSearchResult;
  });

  cacheSet(url, result);
  return result;
}
