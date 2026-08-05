/**
 * Flux des lots Pokémon récemment mis en ligne.
 *
 * Un seul paramètre, `force`, posé par le bouton « Actualiser ». Les requêtes
 * sont génériques et l'instantané est partagé par tout le site. La session reste
 * exigée — la route pilote des recherches sortantes, et `proxy.ts` ne protège
 * que du débit, pas de l'usage.
 */

import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { refreshRecentLots } from "@/lib/lots";
import { FORCE_COOLDOWN_MS, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Connectez-vous pour consulter les lots." }, { status: 401 });
  }

  // Par visiteur, et non par instantané comme pour le fil : celui-ci est unique
  // et partagé, donc un clic ne vaut qu'un seul appel ici.
  const force = request.nextUrl.searchParams.get("force") === "1";
  if (force) {
    const gate = rateLimit(`lots:force:${user.id}`, 1, FORCE_COOLDOWN_MS);
    if (!gate.ok) {
      return Response.json(
        { error: `Patientez ${gate.retryAfter} s avant d’actualiser à nouveau.` },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
      );
    }
  }

  try {
    const snapshot = await refreshRecentLots(Date.now(), force);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/lots/recents]", error);
    return Response.json(
      { error: "Impossible de chercher des lots pour le moment." },
      { status: 502 },
    );
  }
}
