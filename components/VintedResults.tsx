"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { age, euro, percent, plural } from "@/lib/format";
import { CONDITION_LABELS, STRONG_SCORE, condition, type ScoredItem } from "@/lib/match";
import type { CardDetail } from "@/lib/tcgdex";
import type { VintedOrder } from "@/lib/vinted";

/**
 * Panneau de recherche libre de la fiche carte.
 *
 * Le fil d'accueil compose lui-même la requête la plus discriminante ; ici on
 * laisse au contraire la main, parce que c'est la page où l'on vient creuser :
 * changer les mots, ouvrir une fourchette de prix, aller au-delà de la première
 * page. Les résultats ne passent donc pas par les instantanés du fil.
 */

const ORDER_LABELS: { value: VintedOrder; label: string }[] = [
  { value: "relevance", label: "Pertinence" },
  { value: "newest_first", label: "Plus récentes" },
  { value: "price_low_to_high", label: "Prix croissant" },
  { value: "price_high_to_low", label: "Prix décroissant" },
];

const FIELD =
  "rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none transition focus:border-line-strong";

interface ApiResponse {
  items?: ScoredItem[];
  total?: number;
  page?: number;
  totalPages?: number;
  error?: string;
}

export default function VintedResults({
  card,
  suggestions,
}: {
  card: CardDetail;
  suggestions: { label: string; query: string }[];
}) {
  const [query, setQuery] = useState(suggestions[0]?.query ?? card.name);
  const [draft, setDraft] = useState(suggestions[0]?.query ?? card.name);
  const [order, setOrder] = useState<VintedOrder>("relevance");
  const [priceFrom, setPriceFrom] = useState("");
  const [priceTo, setPriceTo] = useState("");
  const [onlyStrong, setOnlyStrong] = useState(false);

  const [items, setItems] = useState<ScoredItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(
    async (targetPage: number, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        q: query,
        cardId: card.id,
        order,
        page: String(targetPage),
      });
      if (priceFrom) params.set("priceFrom", priceFrom);
      if (priceTo) params.set("priceTo", priceTo);

      try {
        const res = await fetch(`/api/vinted?${params}`, { signal: controller.signal });
        const data = (await res.json()) as ApiResponse;
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(data.error ?? "Recherche Vinted impossible.");

        const fetched = data.items ?? [];
        setItems((previous) => (append ? [...previous, ...fetched] : fetched));
        setPage(data.page ?? targetPage);
        setTotalPages(data.totalPages ?? 0);
        setTotal(data.total ?? 0);
      } catch (err) {
        if (controller.signal.aborted || (err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Recherche Vinted impossible.");
        if (!append) setItems([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [card.id, order, priceFrom, priceTo, query],
  );

  // Toute modification des critères relance la recherche depuis la première page.
  useEffect(() => {
    const timer = setTimeout(() => void load(1, false), 350);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const visible = onlyStrong ? items.filter((item) => item.match.score >= STRONG_SCORE) : items;
  const sorted =
    order === "relevance" ? [...visible].sort((a, b) => b.match.score - a.match.score) : visible;
  const hiddenByFilter = items.length - visible.length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">Annonces Vinted</h2>
        {total > 0 && (
          <span className="text-[11px] text-faint">
            {total.toLocaleString("fr-FR")} résultat{total > 1 ? "s" : ""} pour « {query} »
          </span>
        )}
      </div>

      {/* Requêtes pré-construites à partir des données de la carte. */}
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.query}
            type="button"
            data-active={suggestion.query === query}
            onClick={() => {
              setDraft(suggestion.query);
              setQuery(suggestion.query);
            }}
            className="control"
          >
            {suggestion.label}
          </button>
        ))}
      </div>

      <div className="panel flex flex-col gap-2.5 p-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(draft.trim() || card.name);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Termes recherchés sur Vinted"
            className={`flex-1 ${FIELD}`}
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong"
          >
            Rechercher
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <label className="control cursor-pointer">
            <span className="text-faint">Tri</span>
            <select
              value={order}
              onChange={(event) => setOrder(event.target.value as VintedOrder)}
              aria-label="Ordre des résultats Vinted"
              className="bg-transparent text-text outline-none"
            >
              {ORDER_LABELS.map((option) => (
                <option key={option.value} value={option.value} className="bg-panel">
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="control">
            <span className="text-faint">Prix</span>
            <input
              value={priceFrom}
              onChange={(event) => setPriceFrom(event.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="min"
              aria-label="Prix minimum"
              className="w-12 bg-transparent text-text outline-none placeholder:text-faint"
            />
            <span className="text-faint">–</span>
            <input
              value={priceTo}
              onChange={(event) => setPriceTo(event.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="max"
              aria-label="Prix maximum"
              className="w-12 bg-transparent text-text outline-none placeholder:text-faint"
            />
          </label>

          <button
            type="button"
            aria-pressed={onlyStrong}
            onClick={() => setOnlyStrong((value) => !value)}
            className="control"
            title="Ne garder que les annonces citant le nom et le numéro ou l’extension"
          >
            Correspondances fortes
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad"
        >
          {error}
        </p>
      )}

      {onlyStrong && hiddenByFilter > 0 && (
        <p className="text-[11px] text-faint">
          {plural(hiddenByFilter, "annonce")} masquée{hiddenByFilter > 1 ? "s" : ""} par le filtre.
        </p>
      )}

      {loading && (
        <ul className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <li key={index} className="skeleton h-[4.5rem] rounded-lg border border-line" />
          ))}
        </ul>
      )}

      {!loading && sorted.length === 0 && !error && (
        <p className="panel px-4 py-10 text-center text-sm text-dim">
          Aucune annonce pour ces critères.
        </p>
      )}

      {!loading && sorted.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sorted.map((item) => (
            <ResultRow key={item.id} item={item} now={now} />
          ))}
        </ul>
      )}

      {!loading && page < totalPages && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void load(page + 1, true)}
          className="control mx-auto"
        >
          {loadingMore ? "Chargement…" : `Page suivante (${page} / ${totalPages})`}
        </button>
      )}
    </section>
  );
}

function ResultRow({ item, now }: { item: ScoredItem; now: number }) {
  const state = condition(item.status);
  const posted = age(item.createdAt, now);
  const total = item.totalPrice ?? item.price;

  return (
    <li className="animate-rise">
      <div className="grid grid-cols-[2.75rem_1fr] items-start gap-3 rounded-lg border border-line bg-panel p-2 transition hover:border-line-strong sm:grid-cols-[3.25rem_1fr_auto]">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          aria-hidden
          className="block aspect-[3/4] overflow-hidden rounded bg-panel-2"
        >
          {item.thumbnail ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={item.thumbnail}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="grid h-full place-items-center text-[9px] text-faint">sans photo</span>
          )}
        </a>

        <div className="min-w-0">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium transition hover:text-accent"
            title={item.title}
          >
            {item.title}
          </a>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
            {state && <span>{CONDITION_LABELS[state]}</span>}
            {posted && <span>{posted}</span>}
            {item.seller.login && <span className="truncate">@{item.seller.login}</span>}
            {item.match.graded && <span className="chip border-sky-400/30 text-sky-300">gradée</span>}
            {item.match.bulk && <span className="chip">lot</span>}
            {item.match.score < STRONG_SCORE && (
              <span className="chip" title="Le titre ne cite pas le numéro ni l’extension">
                correspondance faible
              </span>
            )}
          </div>
        </div>

        <div className="col-span-2 flex items-center justify-end gap-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start sm:gap-1">
          {item.vsMarket !== null && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                item.vsMarket <= -15
                  ? "border-good/40 bg-good/15 text-good"
                  : item.vsMarket >= 20
                    ? "border-bad/30 bg-bad/10 text-bad"
                    : "border-line bg-panel-2 text-dim"
              }`}
              title="Écart avec la tendance Cardmarket"
            >
              {percent(item.vsMarket)}
            </span>
          )}
          <span className="text-[15px] font-bold leading-tight">{euro(total)}</span>
        </div>
      </div>
    </li>
  );
}
