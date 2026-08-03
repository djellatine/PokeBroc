/**
 * Rafraîchissement d'une carte du fil.
 *
 * La page d'accueil se rend depuis les instantanés déjà sur le disque ; le
 * navigateur n'appelle cette route que pour les cartes périmées, une par une,
 * afin que le fil se complète au fur et à mesure au lieu d'attendre la
 * dernière collecte.
 */

import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { refreshCard } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cardId = request.nextUrl.searchParams.get("cardId")?.trim() ?? "";
  if (!cardId) {
    return Response.json({ error: "Carte manquante." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Connectez-vous pour consulter votre fil." }, { status: 401 });
  }

  // La carte doit appartenir à la collection : sans ce contrôle, la route
  // pilote des recherches Vinted arbitraires pour le compte de n'importe qui.
  const favorite = user.favorites.find((entry) => entry.cardId === cardId);
  if (!favorite) {
    return Response.json({ error: "Carte absente de votre collection." }, { status: 404 });
  }

  try {
    const snapshot = await refreshCard(favorite);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/feed]", error);
    return Response.json(
      { error: "Impossible d’interroger Vinted ni eBay pour le moment." },
      { status: 502 },
    );
  }
}
