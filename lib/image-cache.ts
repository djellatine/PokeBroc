/**
 * Cache disque des visuels de cartes.
 *
 * `assets.tcgdex.net` génère ses images à la demande : mesuré à 15–25 s pour un
 * fichier de 18 Ko, avec des `502` par salves. On ne paie ce prix qu'une fois
 * par visuel, et jamais devant l'utilisateur si le préchauffage a fait son
 * travail.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), ".data", "img-cache");

/**
 * Hôtes que le proxy accepte de relayer. TCGdex, et les deux CDN de TCGplayer
 * qui servent le visuel des cartes japonaises absentes de TCGdex — voir
 * `TCGPLAYER_PREFIX` dans `lib/tcgdex.ts`.
 */
export const ALLOWED_HOSTS = new Set([
  "assets.tcgdex.net",
  "product-images.tcgplayer.com",
  "tcgplayer-cdn.tcgplayer.com",
]);

/** TCGdex met couramment 15 à 25 s ; on lui laisse de la marge en arrière-plan. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_BYTES = 3_000_000;
/**
 * Téléchargements simultanés. Mesuré sur 12 visuels jamais demandés :
 * 3753 ms à 4 en parallèle, 912 ms à 12, sans aucun échec supplémentaire.
 * Au-delà de 12 le gain s'inverse.
 */
const MAX_PARALLEL = 12;

/**
 * URLs pour lesquelles TCGdex a répondu « absent ». Sans cette mémoire, chaque
 * réessai de vignette relance une requête sortante pour une image qui n'existe
 * pas. Durée courte : le catalogue peut se compléter.
 */
const MISSING_TTL_MS = 10 * 60 * 1000;
const missing = new Map<string, number>();

/** Vrai si TCGdex a récemment déclaré ce visuel absent. */
export function knownMissing(url: string): boolean {
  const at = missing.get(url);
  if (at === undefined) return false;
  if (Date.now() - at > MISSING_TTL_MS) {
    missing.delete(url);
    return false;
  }
  return true;
}

/** Téléchargements en cours, pour ne jamais chercher deux fois la même image. */
const inFlight = new Map<string, Promise<Buffer | null>>();

let active = 0;
const queue: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (active < MAX_PARALLEL) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  queue.shift()?.();
}

function cacheFile(url: string): string {
  return path.join(DIR, `${createHash("sha256").update(url).digest("hex")}.bin`);
}

/** URL d'un hôte admis, ou `null`. Empêche d'utiliser le proxy comme relais. */
export function safeImageUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Copie déjà sur disque, ou `null`. */
export async function readCached(url: string): Promise<Buffer | null> {
  try {
    return await readFile(cacheFile(url));
  } catch {
    return null;
  }
}

/**
 * Télécharge l'image et la range sur disque. Les appels concurrents sur la même
 * URL partagent le même téléchargement.
 */
export function download(url: string): Promise<Buffer | null> {
  const running = inFlight.get(url);
  if (running) return running;
  if (knownMissing(url)) return Promise.resolve(null);

  const task = (async () => {
    await acquire();
    try {
      const res = await fetch(url, {
        headers: { Accept: "image/webp,image/png,image/jpeg,image/*" },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        // 404/410 : l'image n'existe pas, inutile d'y revenir. Les autres codes
        // (502, 429…) traduisent un CDN en difficulté, donc un réessai a du sens.
        if (res.status === 404 || res.status === 410) missing.set(url, Date.now());
        return null;
      }

      const body = Buffer.from(await res.arrayBuffer());
      if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return null;

      // Écriture atomique : une lecture concurrente ne voit jamais un fichier partiel.
      const file = cacheFile(url);
      await mkdir(DIR, { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, file);
      maybePurge();
      return body;
    } catch {
      return null;
    } finally {
      release();
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, task);
  return task;
}

/* --------------------------------------------------------------- purge */

/**
 * Taille au-delà de laquelle le cache est élagué. Environ 20 Ko par visuel,
 * soit de l'ordre de quinze mille cartes — largement au-dessus de ce qu'un
 * usage normal accumule, et assez bas pour ne pas remplir un disque en silence.
 */
const MAX_CACHE_BYTES = 300 * 1024 * 1024;
/** On redescend nettement sous le plafond, pour ne pas réélaguer à chaque image. */
const PURGE_TARGET_RATIO = 0.8;
/** Un balayage tous les N téléchargements : `readdir` + `stat` coûtent trop cher à chaque fois. */
const PURGE_EVERY = 250;

let sinceLastPurge = 0;
let purging = false;

function maybePurge(): void {
  sinceLastPurge += 1;
  if (sinceLastPurge < PURGE_EVERY || purging) return;
  sinceLastPurge = 0;
  purging = true;
  void purgeImageCache()
    .catch(() => undefined)
    .finally(() => {
      purging = false;
    });
}

/**
 * Ramène le cache sous son plafond en supprimant les fichiers les plus anciens.
 *
 * L'éviction se fait sur la date d'écriture, pas sur la date de dernier accès :
 * les visuels sont servis avec un `Cache-Control` immuable, donc le navigateur
 * ne les redemande presque jamais et une date d'accès ne voudrait pas dire
 * grand-chose. Supprimer un fichier encore utile est sans conséquence — il sera
 * retéléchargé à la prochaine demande.
 *
 * @returns Nombre d'octets libérés.
 */
export async function purgeImageCache(maxBytes = MAX_CACHE_BYTES): Promise<number> {
  let names: string[];
  try {
    names = await readdir(DIR);
  } catch {
    return 0; // cache jamais créé
  }

  const files = (
    await Promise.all(
      names
        .filter((name) => name.endsWith(".bin"))
        .map(async (name) => {
          const full = path.join(DIR, name);
          try {
            const info = await stat(full);
            return { full, size: info.size, at: info.mtimeMs };
          } catch {
            return null;
          }
        }),
    )
  ).filter((entry): entry is { full: string; size: number; at: number } => entry !== null);

  let total = files.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= maxBytes) return 0;

  files.sort((a, b) => a.at - b.at);

  const target = maxBytes * PURGE_TARGET_RATIO;
  let freed = 0;
  for (const entry of files) {
    if (total <= target) break;
    try {
      await unlink(entry.full);
      total -= entry.size;
      freed += entry.size;
    } catch {
      /* déjà supprimé, ou verrouillé : on passe au suivant */
    }
  }

  return freed;
}

/**
 * Lance le téléchargement des visuels sans rien attendre.
 *
 * Appelé dès la recherche de cartes : le CDN travaille pendant que l'utilisateur
 * lit les noms, au lieu de commencer seulement quand le navigateur réclame les
 * vignettes.
 */
export function warm(urls: (string | null)[]): void {
  for (const url of urls) {
    if (!url) continue;
    const safe = safeImageUrl(url);
    if (!safe) continue;
    void readCached(safe.href).then((cached) => {
      if (!cached) void download(safe.href);
    });
  }
}
