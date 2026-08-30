"use server";

import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hideListing, markFeedSeen, unhideAllListings, unhideListing } from "@/lib/store";

/**
 * Les gestes qui portent sur le *fil*, et non sur la collection.
 *
 * Masquer une annonce ne retire aucune carte : c'est un réglage d'affichage, et
 * il est rangé à part de `favorites.ts` pour cette raison. Le fil des cartes et
 * la page Lots s'en servent tous deux — les identifiants d'annonce partagent le
 * même espace de noms (`vinted:123`, `ebay:v1|456|0`, `lbc:789`), donc une
 * annonce écartée d'un fil l'est aussi de l'autre, ce qui est bien ce qu'on veut
 * : c'est la même annonce.
 *
 * Aucune de ces actions n'appelle `refresh()`, sauf celle qui touche au badge
 * « nouveau ». Les deux fils retirent la ligne de leur propre état avant même
 * que la réponse revienne ; reconstruire la page depuis le disque n'y changerait
 * rien et coûterait la relecture de tous les instantanés.
 */

export interface FeedResult {
  ok: boolean;
  error?: string;
}

/**
 * Un identifiant d'annonce tient en quelques dizaines de caractères — le plus
 * long est celui d'eBay, de la forme `ebay:v1|123456789012|0`. La borne est là
 * parce qu'une Server Action est joignable en POST direct : sans elle, on
 * écrirait dans `users.json` ce que l'appelant voudrait bien y mettre.
 */
const MAX_ID_LENGTH = 120;

function listingId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, MAX_ID_LENGTH) || null;
}

export async function hideOffer(itemId: string): Promise<FeedResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous pour masquer une annonce." };

  const id = listingId(itemId);
  if (!id) return { ok: false, error: "Annonce invalide." };

  await hideListing(user.id, id);
  return { ok: true };
}

export async function unhideOffer(itemId: string): Promise<FeedResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous pour modifier votre fil." };

  const id = listingId(itemId);
  if (!id) return { ok: false, error: "Annonce invalide." };

  await unhideListing(user.id, id);
  return { ok: true };
}

/** « Tout réafficher » : le fil repart sans aucun masquage. */
export async function unhideAllOffers(): Promise<FeedResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous pour modifier votre fil." };

  await unhideAllListings(user.id);
  return { ok: true };
}

/**
 * « Tout marquer comme vu » : remet le repère des pastilles à maintenant.
 *
 * Celle-ci rafraîchit, contrairement aux autres : le repère est calculé côté
 * serveur et redescendu en propriété, le client n'en tient pas de copie.
 */
export async function clearNewBadges(): Promise<FeedResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous d’abord." };

  await markFeedSeen(user.id);
  refresh();
  return { ok: true };
}
