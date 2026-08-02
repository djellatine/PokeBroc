/**
 * Lecture et écriture de fichiers JSON dans `.data/`.
 *
 * Mutualisé par `store.ts`, `sightings.ts` et `feed.ts`, qui partagent tous le
 * même besoin : un fichier par entité, écrit sans jamais laisser de version
 * tronquée sur le disque.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), ".data");

/** Contenu parsé, ou `null` si le fichier est absent ou illisible. */
export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    // Absent au premier démarrage, ou corrompu par un arrêt brutal : dans les
    // deux cas l'appelant repart d'un état vide plutôt que de planter.
    return null;
  }
}

/**
 * Écriture atomique : fichier temporaire puis renommage. Un plantage en cours
 * d'écriture laisse l'ancienne version intacte au lieu d'un fichier à moitié
 * écrit qu'aucune lecture ne saurait parser.
 */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value), "utf8");
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/**
 * Sérialise des opérations partageant une même ressource.
 *
 * Deux mutations simultanées liraient sinon la même version du fichier, et la
 * seconde écraserait la première. Une chaîne par clé : deux cartes différentes
 * n'ont aucune raison de s'attendre.
 */
const chains = new Map<string, Promise<unknown>>();

export function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  // Une erreur ne doit pas empoisonner la chaîne des opérations suivantes.
  const settled = run.catch(() => undefined);
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}

/** Nom de fichier sûr dérivé d'un identifiant venu de l'extérieur. */
export function safeFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
