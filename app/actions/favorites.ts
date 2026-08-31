"use server";

import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { refreshCardmarketLive, writeCardmarketWatched } from "@/lib/cardmarket";
import { refreshCard } from "@/lib/feed";
import { addFavorite, allTrackedCards, removeFavorite, setCardmarketWatch } from "@/lib/store";

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

/**
 * Coche une carte comme « précieuse, à surveiller sur Cardmarket », avec ses
 * critères (reverse, première édition). La langue reste le français, imposée
 * plus bas par le collecteur — elle ne se choisit pas.
 *
 * On ne relance pas la collecte ici, à la différence de `saveFavorite` : sonder
 * Cardmarket passe par le navigateur piloté de `collect/cardmarket.py`, hors du
 * site. Le prochain balayage de la veille reprendra la case cochée et ses
 * critères, et la carte apparaîtra dans la liste de chasse — le clic ne fait que
 * poser l'intention.
 */
/**
 * Ramène un lien Cardmarket collé à un chemin de page produit sûr, ou `null`
 * si ce n'en est pas un. On ne garde que le chemin — sans le domaine ni les
 * paramètres — et on force la langue d'affichage sur `fr` : le collecteur y
 * rajoute lui-même `language=2` et les critères. Rejeter ce qui n'est pas une
 * page `/Products/Singles/…` évite de sonder une URL arbitraire.
 */
function cardmarketPath(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined; // champ absent : ne pas toucher
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return ""; // vidé : effacer le lien

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  }
  const marker = pathname.indexOf("/Pokemon/Products/Singles/");
  if (marker === -1) return null;
  const path = "/fr" + pathname.slice(marker).split("?")[0];
  return path.length > MAX_LENGTH ? null : path;
}

export async function toggleCardmarketWatch(
  cardId: string,
  on: boolean,
  prefs: { reverse?: boolean; firstEd?: boolean } = {},
  url?: string,
): Promise<FavoriteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous pour modifier votre collection." };

  const id = text(cardId);
  if (!id) return { ok: false, error: "Carte invalide." };

  const path = cardmarketPath(url);
  if (path === null && url !== undefined && url.trim() !== "") {
    return { ok: false, error: "Ce lien n'est pas une page carte Cardmarket." };
  }

  const kept = { reverse: Boolean(prefs?.reverse), firstEd: Boolean(prefs?.firstEd) };
  const done = await setCardmarketWatch(user.id, id, on, kept, path ?? null);
  if (!done) return { ok: false, error: "Carte introuvable dans votre collection." };

  // La liste de chasse est réécrite tout de suite, pour que le collecteur qu'on
  // relance juste après y lise le critère qu'on vient de cocher — et non celui
  // du dernier passage de la minuterie.
  await writeCardmarketWatched(await allTrackedCards());

  // Puis on met le fil à jour, sans faire attendre le clic. La collecte pilote
  // un navigateur (quelques secondes) : on la lance, et une fois finie on
  // réécrit l'instantané de la carte. Décocher n'a rien à collecter — on réécrit
  // seulement l'instantané, désormais sans Cardmarket. Rien de tout cela ne doit
  // faire échouer le geste, d'où le `void` et les `catch`.
  const favorite = user.favorites.find((entry) => entry.cardId === id);
  if (favorite) {
    const updated = {
      ...favorite,
      cardmarket: on || undefined,
      cardmarketPrefs: on && (kept.reverse || kept.firstEd) ? kept : undefined,
    };
    const rewrite = () => refreshCard(updated, Date.now(), true).catch(() => undefined);
    if (on) void refreshCardmarketLive(id).then(rewrite).catch(rewrite);
    else void rewrite();
  }

  refresh();
  return { ok: true };
}
