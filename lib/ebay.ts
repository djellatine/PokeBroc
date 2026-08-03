/**
 * Client de la Browse API d'eBay.
 *
 * Contrairement à Vinted, eBay documente son API — mais exige un jeton OAuth
 * applicatif (client credentials) dérivé du keyset de production. Le jeton vaut
 * deux heures : on le garde en mémoire et on le renouvelle sur un 401, comme la
 * session Vinted. Le throttle et le cache reprennent la même mécanique, pour la
 * même raison : le quota par défaut est de 5 000 appels par jour, partagé par
 * tous les visiteurs du site.
 *
 * La Finding API (findItemsByKeywords) est décommissionnée depuis février 2025 ;
 * tout passe désormais par /buy/browse/v1.
 */

const AUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const API = "https://api.ebay.com/buy/browse/v1";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

/** Marge de sécurité : on renouvelle avant l'expiration annoncée. */
const TOKEN_SKEW_MS = 60 * 1000;
const MIN_INTERVAL_MS = 350;
const CACHE_TTL_MS = 90 * 1000;
const CACHE_MAX_ENTRIES = 200;

/** Valeurs acceptées par le paramètre `sort` de la Browse API. */
export type EbayOrder = "best_match" | "newly_listed" | "price_low_to_high" | "price_high_to_low";

const SORT_PARAM: Record<EbayOrder, string | null> = {
  best_match: null, // défaut de l'API : pas de paramètre
  newly_listed: "newlyListed",
  price_low_to_high: "price",
  price_high_to_low: "-price",
};

export interface EbaySearchParams {
  query: string;
  page?: number;
  perPage?: number;
  order?: EbayOrder;
  priceFrom?: number;
  priceTo?: number;
  /** Restreint aux objets situés dans ce pays (« FR »). */
  country?: string;
  marketplace?: string;
}

/**
 * Même forme que `VintedItem`, à un détail près : l'identifiant eBay est une
 * chaîne (`v1|123456789|0`), pas un entier. Le reste du site ne s'en sert que
 * comme clé, donc la notation et le fil peuvent consommer les deux.
 */
export interface EbayItem {
  id: string;
  title: string;
  url: string;
  photo: string | null;
  thumbnail: string | null;
  /** Prix affiché, hors livraison. */
  price: number | null;
  /** Prix + livraison, l'équivalent du prix « tout compris » de Vinted. */
  totalPrice: number | null;
  /** Frais de port, quand ils sont connus (`0` = gratuit). */
  shipping: number | null;
  currency: string;
  brand: string | null;
  status: string | null;
  favourites: number;
  views: number;
  promoted: boolean;
  createdAt: number | null;
  seller: { login: string | null; url: string | null; business: boolean };
  /** Achat immédiat, enchère, ou les deux. */
  buying: string[];
  /**
   * Gradation déclarée par le vendeur via la catégorie eBay (`conditionId`
   * 2750). Plus fiable que la lecture du titre, sur laquelle `match.ts` se rabat
   * pour Vinted : une gradée sans « PSA » dans le titre passe autrement pour une
   * carte brute, et son prix fausse la comparaison à la cote.
   */
  graded: boolean;
  /**
   * Enchère en cours. Le prix affiché est alors l'enchère courante, pas un prix
   * demandé : à une heure de la fin, un Dracaufeu à 1 € n'est pas une affaire à
   * −99 %, c'est une vente qui n'a pas encore eu lieu.
   */
  auction: boolean;
  bids: number;
  /** Fin de l'enchère, en millisecondes epoch. */
  endsAt: number | null;
  /** Pays de l'objet, pour distinguer une annonce française d'un envoi lointain. */
  country: string | null;
}

export interface EbaySearchResult {
  items: EbayItem[];
  total: number;
  page: number;
  totalPages: number;
  perPage: number;
}

/* -------------------------------------------------------------------- jeton */

let token: { value: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

/**
 * Le site doit rester utilisable sans clés eBay : le fil se rabat alors sur
 * Vinted seul, silencieusement, plutôt que d'afficher une erreur de collecte à
 * chaque carte.
 */
export function isConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID?.trim() && process.env.EBAY_CLIENT_SECRET?.trim());
}

function credentials(): { id: string; secret: string } {
  const id = process.env.EBAY_CLIENT_ID?.trim();
  const secret = process.env.EBAY_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new Error(
      "Clés eBay absentes : renseignez EBAY_CLIENT_ID et EBAY_CLIENT_SECRET dans .env.local.",
    );
  }
  return { id, secret };
}

async function fetchToken(): Promise<string> {
  const { id, secret } = credentials();

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
    cache: "no-store",
  });

  if (!res.ok) {
    // Le corps porte le motif exact (invalid_client, unsupported_grant_type…),
    // sans lequel un échec d'authentification est indevinable.
    const detail = await res.text().catch(() => "");
    throw new Error(
      `eBay a refusé les identifiants (${res.status}). ${detail.slice(0, 300)}`.trim(),
    );
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("eBay n'a pas renvoyé de jeton d'accès.");

  token = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000 - TOKEN_SKEW_MS,
  };
  return token.value;
}

async function getToken(force = false): Promise<string> {
  if (force) token = null;
  if (token && Date.now() < token.expiresAt) return token.value;
  if (!pending) {
    pending = fetchToken().finally(() => {
      pending = null;
    });
  }
  return pending;
}

/* ----------------------------------------------------------------- throttle */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

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

const cache = new Map<string, { at: number; value: EbaySearchResult }>();

function cacheGet(key: string): EbaySearchResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key: string, value: EbaySearchResult): void {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/* ------------------------------------------------------------------ mapping */

interface RawAmount {
  value?: string;
  currency?: string;
}
interface RawImage {
  imageUrl?: string;
}
interface RawShipping {
  shippingCost?: RawAmount | null;
  shippingCostType?: string;
}
interface RawSummary {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  itemWebUrl?: string;
  itemHref?: string;
  image?: RawImage | null;
  thumbnailImages?: RawImage[] | null;
  additionalImages?: RawImage[] | null;
  price?: RawAmount | null;
  condition?: string | null;
  conditionId?: string | null;
  seller?: {
    username?: string;
    feedbackScore?: number;
    sellerAccountType?: string;
  } | null;
  shippingOptions?: RawShipping[] | null;
  buyingOptions?: string[] | null;
  itemLocation?: { country?: string } | null;
  itemCreationDate?: string | null;
  currentBidPrice?: RawAmount | null;
  bidCount?: number;
  itemEndDate?: string | null;
  /** Mise en avant payante : l'équivalent eBay d'une annonce sponsorisée. */
  priorityListing?: boolean;
  watchCount?: number;
}

/** `2750` = gradée dans la catégorie « cartes à collectionner » d'eBay. */
const GRADED_CONDITION_ID = "2750";

function epoch(value: string | null | undefined): number | null {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function amount(value: RawAmount | null | undefined): number | null {
  const n = Number.parseFloat(value?.value ?? "");
  return Number.isFinite(n) ? n : null;
}

/**
 * Frais de port les moins chers annoncés. Une annonce sans `shippingOptions`
 * (livraison à calculer, retrait sur place) rend `null` plutôt que zéro : dire
 * « port gratuit » à tort fausserait l'écart à la cote.
 */
function shippingCost(raw: RawSummary): number | null {
  const options = raw.shippingOptions ?? [];
  const costs = options.map((option) => amount(option.shippingCost)).filter((n) => n !== null);
  return costs.length > 0 ? Math.min(...costs) : null;
}

function mapItem(raw: RawSummary): EbayItem {
  const buying = raw.buyingOptions ?? [];
  const auction = buying.includes("AUCTION");
  // Sur une enchère, `price` porte déjà l'enchère courante ; `currentBidPrice`
  // ne sert que de repli quand elle manque.
  const price = amount(raw.price) ?? (auction ? amount(raw.currentBidPrice) : null);
  const shipping = shippingCost(raw);

  return {
    id: raw.itemId ?? raw.legacyItemId ?? "",
    title: raw.title ?? "Annonce sans titre",
    url: raw.itemWebUrl ?? (raw.legacyItemId ? `https://www.ebay.fr/itm/${raw.legacyItemId}` : ""),
    // Contre-intuitif mais vérifié sur les réponses d'eBay FR : `image` sert la
    // vignette basse définition (s-l225) et `thumbnailImages` la grande (s-l1600).
    photo: raw.thumbnailImages?.[0]?.imageUrl ?? raw.image?.imageUrl ?? null,
    thumbnail: raw.image?.imageUrl ?? raw.thumbnailImages?.[0]?.imageUrl ?? null,
    price,
    totalPrice: price !== null && shipping !== null ? price + shipping : price,
    shipping,
    currency: raw.price?.currency ?? "EUR",
    brand: null, // la Browse API ne renvoie pas la marque dans un résumé
    status: raw.condition ?? null,
    favourites: raw.watchCount ?? 0,
    views: 0, // non exposé par la Browse API
    promoted: Boolean(raw.priorityListing),
    createdAt: epoch(raw.itemCreationDate),
    seller: {
      login: raw.seller?.username ?? null,
      url: raw.seller?.username
        ? `https://www.ebay.fr/usr/${encodeURIComponent(raw.seller.username)}`
        : null,
      business: raw.seller?.sellerAccountType === "BUSINESS",
    },
    buying,
    graded: raw.conditionId === GRADED_CONDITION_ID,
    auction,
    bids: raw.bidCount ?? 0,
    endsAt: epoch(raw.itemEndDate),
    country: raw.itemLocation?.country ?? null,
  };
}

/* ------------------------------------------------------------------ requête */

function buildUrl(params: EbaySearchParams): string {
  const url = new URL(`${API}/item_summary/search`);
  const perPage = Math.min(200, Math.max(1, params.perPage ?? 50));
  const page = Math.max(1, params.page ?? 1);

  url.searchParams.set("q", params.query);
  url.searchParams.set("limit", String(perPage));
  url.searchParams.set("offset", String((page - 1) * perPage));

  const sort = SORT_PARAM[params.order ?? "best_match"];
  if (sort) url.searchParams.set("sort", sort);

  // Les filtres partagent un même paramètre, en `nom:{valeur}` séparés par des virgules.
  const filters: string[] = [];
  if (params.priceFrom !== undefined || params.priceTo !== undefined) {
    const from = params.priceFrom ?? "";
    const to = params.priceTo ?? "";
    filters.push(`price:[${from}..${to}]`, "priceCurrency:EUR");
  }
  if (params.country) filters.push(`itemLocationCountry:${params.country}`);
  if (filters.length > 0) url.searchParams.set("filter", filters.join(","));

  return url.toString();
}

async function call(url: string, token: string, marketplace: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      Accept: "application/json",
      "Accept-Language": "fr-FR",
    },
    cache: "no-store",
  });
}

export async function searchEbay(params: EbaySearchParams): Promise<EbaySearchResult> {
  const query = params.query.trim();
  const perPage = Math.min(200, Math.max(1, params.perPage ?? 50));
  if (!query) {
    return { items: [], total: 0, page: 1, totalPages: 0, perPage };
  }

  const marketplace = params.marketplace ?? process.env.EBAY_MARKETPLACE?.trim() ?? "EBAY_FR";
  const url = buildUrl({ ...params, query });
  const key = `${marketplace} ${url}`;

  const cached = cacheGet(key);
  if (cached) return cached;

  const result = await schedule(async () => {
    let res = await call(url, await getToken(), marketplace);

    // Jeton expiré ou révoqué : on en redemande un et on retente une fois.
    if (res.status === 401) {
      res = await call(url, await getToken(true), marketplace);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        res.status === 429
          ? "Quota eBay atteint. Réessayez plus tard."
          : `eBay a répondu ${res.status}. ${detail.slice(0, 300)}`.trim(),
      );
    }

    const json = (await res.json()) as {
      itemSummaries?: RawSummary[];
      total?: number;
      limit?: number;
      offset?: number;
    };

    const total = json.total ?? 0;
    const limit = json.limit ?? perPage;
    return {
      items: (json.itemSummaries ?? []).map(mapItem),
      total,
      page: Math.floor((json.offset ?? 0) / Math.max(1, limit)) + 1,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      perPage: limit,
    } satisfies EbaySearchResult;
  });

  cacheSet(key, result);
  return result;
}
