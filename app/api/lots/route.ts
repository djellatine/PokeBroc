/**
 * Rafraîchissement des lots d'une carte.
 *
 * Route jumelle de `/api/feed`, et séparée pour la même raison que
 * `lib/lots.ts` l'est de `lib/feed.ts` : les deux collectes n'ont ni les mêmes
 * requêtes ni la même durée de validité. Les fusionner obligerait à rejouer la
 * recherche de lots à chaque expiration du fil, six fois plus souvent que
 * nécessaire.
 */

import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { refreshLots } from "@/lib/lots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cardId = request.nextUrl.searchParams.get("cardId")?.trim() ?? "";
  if (!cardId) {
    return Response.json({ error: "Carte manquante." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Connectez-vous pour consulter vos lots." }, { status: 401 });
  }

  // Même contrôle que pour le fil : sans lui, la route pilote des recherches
  // arbitraires sur les catalogues pour le compte de n'importe qui.
  const favorite = user.favorites.find((entry) => entry.cardId === cardId);
  if (!favorite) {
    return Response.json({ error: "Carte absente de votre collection." }, { status: 404 });
  }

  try {
    const snapshot = await refreshLots(favorite);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/lots]", error);
    return Response.json(
      { error: "Impossible de chercher des lots pour le moment." },
      { status: 502 },
    );
  }
}
