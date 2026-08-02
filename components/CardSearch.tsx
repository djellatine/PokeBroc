"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dropFavorite, saveFavorite } from "@/app/actions/favorites";
import CardThumb from "@/components/CardThumb";
import type { CardListItem } from "@/lib/tcgdex";

/**
 * Barre de recherche de l'en-tête, avec aperçu cliquable.
 *
 * L'aperçu est un vrai `listbox` : chaque carte est une option, activable au
 * clavier comme à la souris, et l'activation ajoute ou retire la carte de la
 * collection. C'est la seule action possible ici — consulter une fiche se fait
 * depuis la collection ou depuis le fil. Cette règle évite d'imbriquer un lien
 * dans une option, ce qu'aucun lecteur d'écran n'annonce correctement, et rend
 * la touche Entrée sans ambiguïté.
 */

/**
 * Nombre de vignettes montrées d'emblée. Une recherche large en renvoie jusqu'à
 * 60, soit autant de visuels à télécharger avant que l'aperçu paraisse rempli.
 * Le classement place déjà les correspondances exactes en tête ; le reste est à
 * un clic.
 */
const PREVIEW_LIMIT = 18;

/** Ciblé par la page d'accueil pour amener le curseur ici depuis son appel à l'action. */
export const SEARCH_INPUT_ID = "recherche-carte";

export default function CardSearch({
  favoriteIds,
  isLoggedIn,
}: {
  favoriteIds: string[];
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(-1);

  /**
   * Le serveur est la référence, mais un aller-retour dure le temps d'un
   * `refresh()` : on affiche le résultat attendu immédiatement, quitte à
   * revenir en arrière si l'action échoue.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const serverFavorites = new Set(favoriteIds);
  const isFavorite = (cardId: string) => overrides[cardId] ?? serverFavorites.has(cardId);

  // Quand la liste du serveur change, on oublie les affichages anticipés qu'elle
  // confirme. Ajusté pendant le rendu plutôt que dans un effet : pas de passage
  // par un état intermédiaire visible.
  const serverKey = favoriteIds.join("|");
  const [seenKey, setSeenKey] = useState(serverKey);
  if (seenKey !== serverKey) {
    setSeenKey(serverKey);
    setOverrides((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id, wanted]) => serverFavorites.has(id) !== wanted),
      ),
    );
  }

  const run = useCallback(async (raw: string) => {
    const q = raw.trim();
    abortRef.current?.abort();
    setShowAll(false);
    setActive(-1);

    if (q.length < 2) {
      setCards([]);
      setStatus("idle");
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);

    try {
      const res = await fetch(`/api/cards?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });
      const data = (await res.json()) as { cards?: CardListItem[]; error?: string };
      if (controller.signal.aborted) return;

      if (!res.ok) throw new Error(data.error ?? "Recherche impossible.");
      setCards(data.cards ?? []);
      setStatus("done");
    } catch (err) {
      if (controller.signal.aborted || (err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Recherche impossible.");
      setStatus("error");
    }
  }, []);

  // Recherche différée pendant la frappe.
  useEffect(() => {
    const timer = setTimeout(() => void run(query), 250);
    return () => clearTimeout(timer);
  }, [query, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Fermeture au clic extérieur.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle(card: CardListItem) {
    if (!isLoggedIn) {
      router.push("/connexion");
      return;
    }

    const wanted = !isFavorite(card.id);
    setOverrides((current) => ({ ...current, [card.id]: wanted }));

    startTransition(async () => {
      const result = wanted
        ? await saveFavorite({
            cardId: card.id,
            name: card.name,
            image: card.image ?? null,
            localId: card.localId ?? null,
            setName: card.setName,
          })
        : await dropFavorite(card.id);

      if (!result.ok) {
        setOverrides((current) => {
          const next = { ...current };
          delete next[card.id];
          return next;
        });
        setError(result.error ?? "Action impossible.");
      }
    });
  }

  const trimmed = query.trim();
  const showPanel = open && trimmed.length >= 2;
  const visible = showAll ? cards : cards.slice(0, PREVIEW_LIMIT);
  const hidden = cards.length - visible.length;

  /**
   * Déplace l'option active, en passant par une position « aucune sélection »
   * pour qu'on puisse revenir au champ de saisie en remontant depuis la
   * première carte.
   */
  function move(delta: number) {
    if (visible.length === 0) return;
    setOpen(true);
    setActive((current) => {
      const slots = visible.length + 1;
      const next = (current + delta + slots + 1) % slots;
      const index = next === visible.length ? -1 : next;
      if (index >= 0) {
        requestAnimationFrame(() =>
          listRef.current
            ?.querySelector(`#carte-option-${index}`)
            ?.scrollIntoView({ block: "nearest" }),
        );
      }
      return index;
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter" && active >= 0 && visible[active]) {
      event.preventDefault();
      toggle(visible[active]);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div className="relative max-w-xl">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          id={SEARCH_INPUT_ID}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Ajouter une carte…"
          aria-label="Rechercher une carte Pokémon à ajouter à la collection"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="apercu-cartes"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `carte-option-${active}` : undefined}
          autoComplete="off"
          className="h-9 w-full rounded-lg border border-line bg-panel-2 pl-9 pr-9 text-sm outline-none transition placeholder:text-faint focus:border-line-strong"
        />
        {status === "loading" && (
          <span
            className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-line border-t-accent"
            aria-hidden
          />
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(46rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_28px_70px_-24px_rgba(0,0,0,0.95)]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
            <p className="text-[11px] text-dim" aria-live="polite">
              {status === "loading"
                ? "Recherche…"
                : cards.length > 0
                  ? `${visible.length}${hidden > 0 ? ` sur ${cards.length}` : ""} carte${
                      cards.length > 1 ? "s" : ""
                    } — cliquez pour ajouter à votre collection`
                  : "Aucun résultat"}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="-mr-1 shrink-0 px-2 py-1 text-[11px] text-faint transition hover:text-text"
            >
              Fermer
            </button>
          </div>

          {error && (
            <p className="border-b border-line px-3 py-2 text-xs text-bad" role="alert">
              {error}
            </p>
          )}

          {status === "done" && cards.length === 0 && !error && (
            <p className="px-3 py-8 text-center text-sm text-dim">
              Aucune carte ne correspond à « {trimmed} ».
              <span className="mt-1 block text-xs text-faint">
                Vérifiez l’orthographe française du Pokémon.
              </span>
            </p>
          )}

          {/* Hauteur réduite sur mobile : le clavier virtuel mange la moitié
              basse de l'écran, et l'aperçu passait dessous. */}
          {cards.length > 0 && (
            <ul
              ref={listRef}
              id="apercu-cartes"
              role="listbox"
              aria-label="Cartes correspondantes"
              className="grid max-h-[17rem] grid-cols-3 gap-2 overflow-y-auto p-2 sm:max-h-[24rem] sm:grid-cols-5 md:grid-cols-6"
            >
              {visible.map((card, index) => {
                const added = isFavorite(card.id);
                return (
                  <li
                    key={card.id}
                    id={`carte-option-${index}`}
                    role="option"
                    aria-selected={added}
                    onClick={() => toggle(card)}
                    onMouseEnter={() => setActive(index)}
                    title={
                      isLoggedIn
                        ? added
                          ? "Retirer de ma collection"
                          : "Ajouter à ma collection"
                        : "Connectez-vous pour ajouter cette carte"
                    }
                    className={`animate-rise group cursor-pointer overflow-hidden rounded-lg border bg-panel-2 transition ${
                      added
                        ? "border-accent/70"
                        : index === active
                          ? "border-line-strong"
                          : "border-line"
                    }`}
                  >
                    <div className="relative aspect-[63/88]">
                      <CardThumb image={card.image} name={card.name} cardId={card.id} />
                      <span
                        className={`absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full text-sm font-bold transition ${
                          added
                            ? "bg-accent text-accent-ink"
                            : "reveal-on-hover bg-black/70 text-white"
                        }`}
                        aria-hidden
                      >
                        {added ? "✓" : "+"}
                      </span>
                    </div>

                    <div className="px-1.5 py-1.5">
                      <p className="truncate text-[11px] font-semibold" title={card.name}>
                        {card.name}
                      </p>
                      <p className="truncate text-[10px] text-faint" title={card.setName ?? ""}>
                        {card.setName ?? card.setId ?? "Extension inconnue"}
                        {card.localId && ` · n°${card.localId}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="block w-full border-t border-line px-3 py-2 text-center text-[11px] text-dim transition hover:text-accent"
            >
              Afficher les {hidden} autre{hidden > 1 ? "s" : ""} carte{hidden > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
