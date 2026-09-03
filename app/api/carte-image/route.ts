/**
 * Sert un visuel de carte depuis le cache disque (voir `lib/image-cache.ts`).
 *
 * Le navigateur n'attend jamais plus que `RESPONSE_BUDGET_MS`. Passé ce délai il
 * reçoit un échec net, mais le téléchargement continue en arrière-plan et
 * remplit le cache : la vignette se réessaie et l'image finit par apparaître.
 * Sans ce garde-fou, dix-huit requêtes bloquées 20 s épuisent les connexions du
 * navigateur et figent le reste du site.
 */

import { NextRequest } from "next/server";
import { download, knownMissing, readCached, safeImageUrl } from "@/lib/image-cache";
import { cardImage, resolveCardImage } from "@/lib/tcgdex";

export const runtime = "nodejs";

/** Ce que le navigateur attend avant de recevoir un échec. */
const RESPONSE_BUDGET_MS = 3_000;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cardId = params.get("cardId")?.trim();

  // `cardId` sans `src` : la base française n'a pas d'illustration pour cette
  // carte, on laisse le serveur chercher un équivalent (voir `resolveCardImage`).
  let src = params.get("src") ?? "";
  let lang: "fr" | "en" | "ja" = "fr";
  if (!src && cardId) {
    const resolved = await resolveCardImage(cardId);
    if (!resolved) {
      return new Response("Aucun visuel connu pour cette carte.", {
        status: 404,
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    }
    src = cardImage(resolved.image, params.get("q") === "high" ? "high" : "low") ?? "";
    lang = resolved.lang;
  }

  const url = safeImageUrl(src);
  if (!url) {
    return new Response("Source d’image non autorisée.", { status: 400 });
  }

  const cached = await readCached(url.href);

  let body = cached;
  if (!body) {
    // Le téléchargement n'est pas interrompu s'il dépasse le budget : il poursuit
    // sa route et remplira le cache pour la tentative suivante.
    body = await Promise.race([
      download(url.href),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RESPONSE_BUDGET_MS)),
    ]);
  }

  if (!body) {
    // 404 quand TCGdex a déclaré l'image absente, 502 quand elle est seulement
    // lente : la vignette n'insiste que dans le second cas.
    const absent = knownMissing(url.href);
    return new Response(absent ? "Visuel inexistant." : "Visuel pas encore disponible.", {
      status: absent ? 404 : 502,
      // Surtout pas de mise en cache d'un échec passager : la vignette doit
      // pouvoir redemander l'image quelques secondes plus tard et l'obtenir.
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": url.pathname.endsWith(".png") ? "image/png" : "image/webp",
      "Content-Length": String(body.byteLength),
      // Une URL TCGdex désigne toujours le même visuel : on peut la garder longtemps.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Cache": cached ? "HIT" : "MISS",
      "X-Image-Lang": lang,
    },
  });
}
