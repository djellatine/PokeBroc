"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Préférences d'affichage conservées d'une visite à l'autre.
 *
 * `localStorage` est une source extérieure à React : la lire dans un effet pour
 * la recopier dans un état provoque un rendu en cascade et un premier affichage
 * avec les mauvaises valeurs. `useSyncExternalStore` est fait exactement pour
 * ça — il fournit aussi l'instantané du serveur, ce qui garde l'hydratation
 * cohérente puisque le serveur, lui, ne connaît aucune préférence.
 */

const listeners = new Set<() => void>();

/**
 * Dernière valeur écrite, indépendamment du stockage.
 *
 * En navigation privée, `setItem` lève : sans ce repli, les filtres seraient
 * non seulement oubliés à la prochaine visite, mais figés pendant celle-ci.
 */
const memory = new Map<string, string>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage refusé : la valeur ne survivra pas à la visite, sans plus */
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Un autre onglet a changé les préférences : on s'aligne.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * @param defaults Doit être stable d'un rendu à l'autre (constante de module) :
 *                 c'est la clé de mémoïsation de la valeur renvoyée.
 */
export function usePersisted<T extends object>(
  key: string,
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    // Le serveur n'a pas de préférences : il rend toujours les valeurs par défaut.
    () => null,
  );

  const value = useMemo(() => {
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw) as Partial<T>;
      // Fusion avec les défauts : une préférence ajoutée après coup ne doit pas
      // rester indéfinie chez ceux qui ont déjà une valeur enregistrée.
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }, [raw, defaults]);

  const update = useCallback(
    (patch: Partial<T>) => {
      write(key, JSON.stringify({ ...value, ...patch }));
      for (const listener of listeners) listener();
    },
    [key, value],
  );

  return [value, update];
}
