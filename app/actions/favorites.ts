"use server";

import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { refreshCard } from "@/lib/feed";
import { addFavorite, removeFavorite } from "@/lib/store";

export interface FavoriteResult {
  ok: boolean;
  error?: string;
}

/** Carte telle qu'envoyée par le client — rien n'y est digne de confiance. */
export interface FavoriteInput {
  cardId: string;
  name: string;
  image?: string | null;
  localId?: string | null;
  setName?: string | null;
}

const MAX_LENGTH = 300;
/** Au-delà, le fil met plus d'une minute à se remplir et n'est plus lisible. */
const MAX_FAVORITES = 60;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_LENGTH);
  return trimmed || null;
}

export async function saveFavorite(input: FavoriteInput): Promise<FavoriteResult> {
  // Une Server Action est joignable en POST direct : on revérifie tout ici.
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous pour ajouter une carte." };

  const cardId = text(input?.cardId);
  const name = text(input?.name);
  if (!cardId || !name) return { ok: false, error: "Carte invalide." };

  const already = user.favorites.some((favorite) => favorite.cardId === cardId);
  if (!already && user.favorites.length >= MAX_FAVORITES) {
    return { ok: false, error: `Collection pleine (${MAX_FAVORITES} cartes maximum).` };
  }

  const card = {
    cardId,
    name,
    image: text(input.image),
    localId: text(input.localId),
    setName: text(input.setName),
  };

  const saved = await addFavorite(user.id, card);
  if (!saved) return { ok: false, error: "Compte introuvable." };

  // Collecte lancée sans l'attendre : le fil se remplit pendant que
  // l'utilisateur continue de chercher d'autres cartes.
  if (!already) {
    void refreshCard({ ...card, addedAt: new Date().toISOString() }).catch(() => undefined);
  }

  refresh();
  return { ok: true };
}

export async function dropFavorite(cardId: string): Promise<FavoriteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous pour modifier votre collection." };

  const id = text(cardId);
  if (!id) return { ok: false, error: "Carte invalide." };

  await removeFavorite(user.id, id);
  refresh();
  return { ok: true };
}
