/**
 * Requête HTTP par le `curl` du système, pour les hôtes qui refusent Node.
 *
 * Depuis octobre 2026, Cloudflare répond par un défi « Just a moment… » à une
 * bonne part des requêtes `fetch` vers Bulbagarden (API comme images), quand
 * `curl` passe à chaque fois avec les mêmes en-têtes — mesuré le 24 octobre :
 * 7 sur 7 pour `curl`, de 0 à 2 sur 5 pour Node, sur le PC comme sur la
 * tablette. C'est la poignée de main de Node qui est notée, pas nos en-têtes.
 * `curl` est présent sur Windows comme dans le Debian de la tablette.
 */

import type * as ChildProcess from "node:child_process";

export interface CurlResponse {
  status: number;
  body: Buffer;
}

/** Repère de fin de corps, pour isoler le code HTTP que `--write-out` ajoute. */
const STATUS_MARK = "\n@@curl-status@@";

/**
 * `GET` par `curl`, redirections suivies. `null` si `curl` est absent, échoue
 * ou dépasse le délai — l'appelant retombe alors sur `fetch`.
 */
export function curlGet(
  url: string,
  headers: Record<string, string>,
  { timeoutMs = 20_000, maxBytes = 5_000_000 }: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<CurlResponse | null> {
  const args = ["-sS", "-L", "--compressed", "--max-time", String(Math.ceil(timeoutMs / 1000))];
  for (const [name, value] of Object.entries(headers)) args.push("-H", `${name}: ${value}`);
  args.push("--write-out", `${STATUS_MARK}%{http_code}`, url);

  // Chargé à l'exécution, pas importé : `lib/tcgdex.ts`, que le navigateur
  // charge aussi, entraîne ce module par `bulbapedia.ts`, et un import de
  // `node:child_process` casserait le paquet client.
  const childProcess =
    typeof process !== "undefined" && typeof process.getBuiltinModule === "function"
      ? (process.getBuiltinModule("node:child_process") as typeof ChildProcess | undefined)
      : undefined;
  if (!childProcess) return Promise.resolve(null);

  return new Promise((resolve) => {
    childProcess.execFile(
      "curl",
      args,
      { encoding: "buffer", maxBuffer: maxBytes + 1024, timeout: timeoutMs + 5_000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null);
        const at = stdout.lastIndexOf(STATUS_MARK);
        if (at < 0) return resolve(null);
        const status = Number(stdout.subarray(at + STATUS_MARK.length).toString());
        resolve(Number.isFinite(status) ? { status, body: stdout.subarray(0, at) } : null);
      },
    );
  });
}
