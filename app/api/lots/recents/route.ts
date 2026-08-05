/**
 * Flux des lots Pokémon récemment mis en ligne.
 *
 * Aucun paramètre : les requêtes sont génériques et l'instantané est partagé
 * par tout le site. La session reste exigée — la route pilote des recherches
 * sortantes, et `proxy.ts` ne protège que du débit, pas de l'usage.
 */

import { getCurrentUser } from "@/lib/auth";
import { refreshRecentLots } from "@/lib/lots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Connectez-vous pour consulter les lots." }, { status: 401 });
  }

  try {
    const snapshot = await refreshRecentLots();
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/lots/recents]", error);
    return Response.json(
      { error: "Impossible de chercher des lots pour le moment." },
      { status: 502 },
    );
  }
}
