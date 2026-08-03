"use client";

import { usePersisted } from "@/components/usePersisted";

/**
 * Filtre « annonces en français », partagé entre l'en-tête et le fil.
 *
 * Le drapeau vit dans l'en-tête, le filtrage dans le tableau de bord : deux
 * arbres React que rien ne relie. Plutôt que de remonter l'état jusqu'au layout
 * — qui est un composant serveur, et le resterait mal — on s'appuie sur le
 * magasin de `usePersisted` : ses abonnés sont un ensemble de portée module,
 * donc écrire depuis l'en-tête réveille le fil. La préférence survit à la
 * visite par la même occasion.
 */

const KEY = "pokebroc:langue";

/** Constante de module : c'est la clé de mémoïsation de `usePersisted`. */
const DEFAULTS = { frenchOnly: false };

export function useFrenchOnly(): [boolean, (value: boolean) => void] {
  const [value, update] = usePersisted(KEY, DEFAULTS);
  return [value.frenchOnly, (next) => update({ frenchOnly: next })];
}
