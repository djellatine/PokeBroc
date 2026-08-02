/**
 * Limitation de débit en mémoire, sans dépendance ni service externe.
 *
 * Algorithme du seau à jetons : chaque clé dispose de `limit` jetons qui se
 * régénèrent linéairement sur `windowMs`. Une rafale courte passe donc (les
 * jetons accumulés sont dépensés d'un coup) mais le débit moyen reste borné —
 * ce qu'un simple compteur par fenêtre ne garantit pas, puisqu'il autorise
 * `2 × limit` requêtes à cheval sur deux fenêtres.
 *
 * Limite assumée : le compteur vit dans le processus. Sur plusieurs instances,
 * chacune applique la sienne. C'est cohérent avec `lib/store.ts`, qui suppose
 * déjà un processus unique.
 */

interface Bucket {
  tokens: number;
  /** Dernier réapprovisionnement, en ms epoch. */
  at: number;
}

const buckets = new Map<string, Bucket>();

/** Au-delà, on purge les clés inactives pour ne pas fuir de la mémoire. */
const SWEEP_THRESHOLD = 5_000;

export interface RateLimitResult {
  ok: boolean;
  /** Jetons restants après cet appel. */
  remaining: number;
  /** Secondes à attendre avant qu'un jeton soit de nouveau disponible. */
  retryAfter: number;
}

/**
 * Consomme un jeton pour `key`.
 *
 * @param limit    Jetons disponibles à plein.
 * @param windowMs Durée de reconstitution complète du seau.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const perMs = limit / windowMs;

  const bucket = buckets.get(key);
  const tokens = bucket ? Math.min(limit, bucket.tokens + (now - bucket.at) * perMs) : limit;

  if (tokens < 1) {
    buckets.set(key, { tokens, at: now });
    return { ok: false, remaining: 0, retryAfter: Math.ceil((1 - tokens) / perMs / 1000) };
  }

  buckets.set(key, { tokens: tokens - 1, at: now });
  if (buckets.size > SWEEP_THRESHOLD) sweep(now, windowMs);

  return { ok: true, remaining: Math.floor(tokens - 1), retryAfter: 0 };
}

/** Oublie les seaux revenus à plein : ils sont équivalents à une clé inconnue. */
function sweep(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.at > windowMs) buckets.delete(key);
  }
}

/** Rend ses jetons à une clé — après une tentative qu'on ne veut pas facturer. */
export function refund(key: string): void {
  buckets.delete(key);
}

/** Réinitialise tout l'état. Réservé aux tests. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Adresse de l'appelant. Derrière un proxy de confiance, `x-forwarded-for` porte
 * la chaîne complète : le premier élément est le client d'origine.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "inconnu";
}
