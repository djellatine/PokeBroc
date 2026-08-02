"use client";

import { useState, useTransition } from "react";
import { dropFavorite } from "@/app/actions/favorites";
import CardThumb from "@/components/CardThumb";
import { plural } from "@/lib/format";
import type { FavoriteCard } from "@/lib/store";

/**
 * Bandeau de la collection.
 *
 * Ce n'est plus une simple vitrine : cliquer sur une carte filtre le fil sur
 * ses annonces. C'est le geste qu'on faisait naturellement en survolant les
 * vignettes, et il évitait jusqu'ici de changer de page pour ne voir qu'une
 * carte. Le compteur par carte rend au passage visible ce que chacune rapporte.
 */

export interface CardCount {
  /** Annonces retenues pour cette carte, filtres courants appliqués. */
  total: number;
  /** Parmi elles, celles apparues depuis la dernière visite. */
  fresh: number;
}

export default function CollectionStrip({
  favorites,
  counts,
  selected,
  onSelect,
}: {
  favorites: FavoriteCard[];
  counts: Record<string, CardCount>;
  selected: string | null;
  onSelect: (cardId: string | null) => void;
}) {
  const [removing, setRemoving] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  function remove(cardId: string) {
    setRemoving((current) => [...current, cardId]);
    if (selected === cardId) onSelect(null);

    startTransition(async () => {
      const result = await dropFavorite(cardId);
      // En cas d'échec on rétablit la carte : `refresh()` n'a rien changé.
      if (!result.ok) setRemoving((current) => current.filter((id) => id !== cardId));
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Ma collection · {plural(favorites.length, "carte")}</h2>
        {selected && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-[11px] text-accent transition hover:underline"
          >
            Voir toutes les cartes
          </button>
        )}
      </div>

      <ul
        className="flex gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label="Filtrer le fil par carte"
      >
        {favorites.map((favorite) => {
          const pending = removing.includes(favorite.cardId);
          const count = counts[favorite.cardId];
          const active = selected === favorite.cardId;

          return (
            <li key={favorite.cardId} className={`group relative ${pending ? "opacity-40" : ""}`}>
              <button
                type="button"
                onClick={() => onSelect(active ? null : favorite.cardId)}
                aria-pressed={active}
                disabled={pending}
                className={`flex w-[13.5rem] items-center gap-2.5 rounded-lg border p-1.5 text-left transition ${
                  active
                    ? "border-accent/70 bg-accent/10"
                    : "border-line bg-panel hover:border-line-strong"
                }`}
              >
                <span className="block h-[3.1rem] w-[2.2rem] shrink-0 overflow-hidden rounded">
                  <CardThumb
                    image={favorite.image}
                    name={favorite.name}
                    cardId={favorite.cardId}
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold" title={favorite.name}>
                      {favorite.name}
                    </span>
                    {favorite.localId && (
                      <span className="shrink-0 text-[10px] text-faint">n°{favorite.localId}</span>
                    )}
                  </span>

                  <span
                    className="mt-0.5 block truncate text-[10px] text-faint"
                    title={favorite.setName ?? ""}
                  >
                    {favorite.setName ?? "Extension inconnue"}
                  </span>

                  <span className="mt-1 flex items-center gap-1.5">
                    <span className="text-[10px] text-dim">
                      {count ? plural(count.total, "annonce") : "—"}
                    </span>
                    {count && count.fresh > 0 && (
                      <span className="rounded-full bg-new/20 px-1.5 text-[9px] font-bold text-new">
                        +{count.fresh}
                      </span>
                    )}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => remove(favorite.cardId)}
                disabled={pending}
                aria-label={`Retirer ${favorite.name} de ma collection`}
                title="Retirer de ma collection"
                className="reveal-on-hover absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full border border-line-strong bg-panel-3 text-sm leading-none text-dim transition hover:border-bad hover:text-bad"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
