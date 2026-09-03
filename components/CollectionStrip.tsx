"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { dropFavorite, toggleCardmarketWatch } from "@/app/actions/favorites";
import CardThumb from "@/components/CardThumb";
import { JapaneseChip } from "@/components/OfferRow";
import { plural } from "@/lib/format";
import type { FavoriteCard } from "@/lib/store";
import { isJapaneseId } from "@/lib/tcgdex";

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

  // État optimiste de la surveillance Cardmarket : cartes cochées et leurs
  // critères. Amorcé sur ce que le serveur a rendu, il bascule aussitôt au clic
  // pour que le menu réponde sans attendre l'aller-retour, et se rétablit si
  // l'action échoue.
  const [watched, setWatched] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(favorites.map((f) => [f.cardId, Boolean(f.cardmarket)])),
  );
  const [prefs, setPrefs] = useState<Record<string, { reverse?: boolean; firstEd?: boolean }>>(
    () => Object.fromEntries(favorites.map((f) => [f.cardId, { ...f.cardmarketPrefs }])),
  );
  // Lien Cardmarket collé, par carte. Édité localement, envoyé à la validation
  // du champ (Entrée ou perte du focus), pas à chaque frappe.
  const [urls, setUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(favorites.map((f) => [f.cardId, f.cardmarketUrl ?? ""])),
  );
  const [urlError, setUrlError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string[]>([]);

  // Menu ouvert : la carte concernée et où l'ancrer. Positionné en coordonnées
  // fixes plutôt qu'en absolu dans la vignette, car le bandeau a `overflow-x`
  // et rognerait un menu débordant vers le bas.
  const [menu, setMenu] = useState<{ cardId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", () => setMenu(null));
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  /** Applique un nouvel état de surveillance et le persiste. */
  function apply(
    cardId: string,
    on: boolean,
    next: { reverse?: boolean; firstEd?: boolean },
    url?: string,
  ) {
    const before = { watched: watched[cardId], prefs: prefs[cardId] };
    setWatched((current) => ({ ...current, [cardId]: on }));
    setPrefs((current) => ({ ...current, [cardId]: next }));
    setToggling((current) => [...current, cardId]);
    setUrlError(null);

    startTransition(async () => {
      const result = await toggleCardmarketWatch(cardId, on, next, url);
      if (!result.ok) {
        setWatched((current) => ({ ...current, [cardId]: Boolean(before.watched) }));
        setPrefs((current) => ({ ...current, [cardId]: before.prefs ?? {} }));
        if (url !== undefined) setUrlError(result.error ?? "Lien refusé.");
      }
      setToggling((current) => current.filter((id) => id !== cardId));
    });
  }

  /** Enregistre le lien collé, si sa valeur a changé. */
  function commitUrl(cardId: string) {
    const value = urls[cardId] ?? "";
    const saved = favorites.find((f) => f.cardId === cardId)?.cardmarketUrl ?? "";
    if (value.trim() === saved) return;
    // Coller un lien vaut activer la surveillance : sans cela, il faudrait deux
    // gestes pour une seule intention.
    apply(cardId, true, prefs[cardId] ?? {}, value.trim());
  }

  function openMenu(cardId: string, event: React.MouseEvent) {
    if (menu?.cardId === cardId) {
      setMenu(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ cardId, x: rect.left, y: rect.bottom + 6 });
  }

  // Recherche dans la collection : avec des dizaines de cartes, retrouver celle
  // à (dé)cocher au défilé était pénible. Le filtre est accent-insensible et
  // porte sur le nom, l'extension et le numéro.
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const norm = (value: string | null) =>
      (value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const needle = norm(query).trim();
    if (!needle) return favorites;
    return favorites.filter(
      (favorite) =>
        norm(favorite.name).includes(needle) ||
        norm(favorite.setName).includes(needle) ||
        norm(favorite.localId).includes(needle),
    );
  }, [favorites, query]);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">Ma collection · {plural(favorites.length, "carte")}</h2>

        <div className="flex items-center gap-2">
          {selected && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="text-[11px] text-accent transition hover:underline"
            >
              Voir toutes les cartes
            </button>
          )}

          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher une carte…"
              aria-label="Rechercher une carte de ma collection"
              className="h-7 w-44 rounded-md border border-line bg-panel-2 pl-7 pr-2 text-xs outline-none transition focus:border-accent"
            />
          </div>
        </div>
      </div>

      <ul
        className="flex gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label="Filtrer le fil par carte"
      >
        {shown.length === 0 && (
          <li className="px-1 py-4 text-xs text-faint">Aucune carte ne correspond.</li>
        )}
        {shown.map((favorite) => {
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
                    <JapaneseChip cardId={favorite.cardId} />
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

              {/* Surveiller aussi cette carte sur Cardmarket. Ouvre un menu pour
                  cocher reverse / 1ère édition. Toujours visible quand c'est
                  actif — un état à retrouver d'un coup d'œil — et révélé au
                  survol sinon, comme la croix. Pas pour une carte japonaise :
                  le collecteur Cardmarket résout ses pages depuis la base
                  française, et impose la langue française à ses recherches. */}
              {!isJapaneseId(favorite.cardId) && (
              <button
                type="button"
                onClick={(event) => openMenu(favorite.cardId, event)}
                disabled={pending}
                aria-haspopup="dialog"
                aria-expanded={menu?.cardId === favorite.cardId}
                aria-label={`Surveiller ${favorite.name} sur Cardmarket`}
                title="Surveiller sur Cardmarket (carte précieuse)"
                className={`absolute -left-1 -top-1 grid h-6 w-8 place-items-center rounded-full border text-[9px] font-bold leading-none transition ${
                  watched[favorite.cardId]
                    ? "border-accent/70 bg-accent/20 text-accent"
                    : "reveal-on-hover border-line-strong bg-panel-3 text-dim hover:border-accent hover:text-accent"
                }`}
              >
                CM
              </button>
              )}
            </li>
          );
        })}
      </ul>

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Surveillance Cardmarket"
            className="fixed z-50 w-72 overflow-hidden rounded-xl border border-line-strong bg-panel-3 text-xs shadow-2xl"
            style={{ top: menu.y, left: menu.x }}
          >
            {(() => {
              const id = menu.cardId;
              const on = Boolean(watched[id]);
              const pref = prefs[id] ?? {};
              const busy = toggling.includes(id);
              const name = favorites.find((f) => f.cardId === id)?.name ?? "cette carte";

              return (
                <>
                  {/* En-tête : la carte, et l'interrupteur de surveillance. */}
                  <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold" title={name}>
                        {name}
                      </p>
                      <p className="text-[10px] text-faint">Surveiller sur Cardmarket</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      disabled={busy}
                      onClick={() => apply(id, !on, on ? {} : pref)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                        on ? "bg-accent" : "bg-line-strong"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                          on ? "left-[1.15rem]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Corps : tirage recherché, puis lien de secours. */}
                  <div className={`flex flex-col gap-3 px-3.5 py-3 ${on ? "" : "opacity-45"}`}>
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                        Tirage
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <PillToggle
                          active={Boolean(pref.reverse)}
                          disabled={busy || !on}
                          onClick={() => apply(id, true, { ...pref, reverse: !pref.reverse })}
                        >
                          Reverse
                        </PillToggle>
                        <PillToggle
                          active={Boolean(pref.firstEd)}
                          disabled={busy || !on}
                          onClick={() => apply(id, true, { ...pref, firstEd: !pref.firstEd })}
                        >
                          1ère édition
                        </PillToggle>
                      </div>
                    </div>

                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                        Lien Cardmarket
                        <span className="ml-1 font-normal normal-case text-faint/80">
                          si la carte n’apparaît pas
                        </span>
                      </p>
                      <input
                        type="url"
                        inputMode="url"
                        placeholder="coller l’adresse de la page…"
                        value={urls[id] ?? ""}
                        disabled={busy}
                        onChange={(event) =>
                          setUrls((current) => ({ ...current, [id]: event.target.value }))
                        }
                        onBlur={() => commitUrl(id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitUrl(id);
                          }
                        }}
                        className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11px] outline-none transition focus:border-accent"
                      />
                      {urlError && menu.cardId === id && (
                        <p className="mt-1 text-[10px] text-bad">{urlError}</p>
                      )}
                    </div>
                  </div>

                  <p className="border-t border-line bg-panel-2 px-3.5 py-2 text-[10px] text-faint">
                    Toujours en français · offres au prochain relevé
                  </p>
                </>
              );
            })()}
          </div>,
          document.body,
        )}
    </section>
  );
}

/** Bouton-pastille à deux états, pour les critères de tirage du menu CM. */
function PillToggle({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2 py-1.5 text-[11px] font-medium transition ${
        active
          ? "border-accent/70 bg-accent/20 text-accent"
          : "border-line bg-panel text-dim hover:border-line-strong"
      } disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
