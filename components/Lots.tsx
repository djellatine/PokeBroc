"use client";

import { useEffect, useMemo, useState } from "react";
import HiddenNotice from "@/components/HiddenNotice";
import HideButton from "@/components/HideButton";
import LotTile from "@/components/LotTile";
import { SourceChip, feesLabel, postedHint } from "@/components/OfferRow";
import RefreshButton from "@/components/RefreshButton";
import { useFrenchOnly } from "@/components/useFrenchOnly";
import { useHidden } from "@/components/useHidden";
import { usePersisted } from "@/components/usePersisted";
import ViewSwitch, { LAYOUT, type View, useView } from "@/components/ViewSwitch";
import { age, countdown, euro, plural } from "@/lib/format";
import { isForeignListing } from "@/lib/language";
import { FORCE_COOLDOWN_MS } from "@/lib/rate-limit";
import type { LotItem, RecentLots } from "@/lib/lots";
import { CONDITION_LABELS } from "@/lib/match";

/**
 * La page « Lots » : tous les lots Pokémon des trois places de marché.
 *
 * On ne part d'aucune carte, et c'est le principe même de la page. Un gros lot
 * ne dit pas ce qu'il contient — le vendeur qui liquide un classeur au poids ne
 * le sait pas toujours lui-même — donc filtrer sur une carte de la collection
 * ne retiendrait que les lots assez petits pour se nommer, c'est-à-dire les
 * moins intéressants. La seule chose qui compte est d'arriver tôt, d'où un tri
 * par date de mise en ligne et non par pertinence.
 *
 * Un onglet « Ma collection » a existé ici, qui rassemblait les lots dont le
 * titre citait une carte suivie. Il a été retiré : le fil de la page d'accueil
 * fait déjà exactement cela, et mieux — un lot qui nomme une carte suivie y
 * remonte par la notation ordinaire, et le bouton « Sans lots » sert à les
 * masquer. Deux chemins pour une même question, dont l'un coûtait quatre
 * recherches **par carte suivie**.
 */

type LotSort = "date" | "perCard" | "price";

const SORTS: { value: LotSort; label: string }[] = [
  { value: "date", label: "Plus récents" },
  { value: "perCard", label: "Prix par carte" },
  { value: "price", label: "Prix total" },
];

interface LotPrefs {
  sort: LotSort;
  /** N'afficher que les lots dont le titre annonce un nombre de cartes. */
  sized: boolean;
}

/** Constante de module : c'est la clé de mémoïsation de `usePersisted`. */
const DEFAULT_PREFS: LotPrefs = {
  // La date, parce que c'est ce que la page promet : les derniers mis en ligne.
  sort: "date",
  sized: false,
};

/**
 * Le suffixe de version n'est pas décoratif : `usePersisted` fusionne la valeur
 * enregistrée **par-dessus** les défauts. Un `tab: "cards"` mémorisé du temps
 * des onglets survivrait donc au retrait de l'onglet, et `sortRecent` ne
 * s'appelle plus ainsi. Changer de clé remet tout le monde sur le défaut
 * courant, au prix d'un tri à repositionner une fois.
 */
const PREFS_KEY = "pokebroc:lots:v3";

const PAGE_SIZE = 24;

export default function Lots({
  initialRecent,
  recentIsStale,
  initialHidden,
  serverNow,
}: {
  initialRecent: RecentLots | null;
  recentIsStale: boolean;
  /** Annonces déjà écartées, fil des cartes compris : c'est le même stockage. */
  initialHidden: string[];
  serverNow: number;
}) {
  const [prefs, updatePrefs] = usePersisted(PREFS_KEY, DEFAULT_PREFS);

  return (
    <section className="flex flex-col gap-3">
      {/* Collé sous l'en-tête, comme la barre d'outils du fil : sur une page de
          cent lots, le titre disparaîtrait sinon dès le premier défilement.
          À partir de `sm` seulement — même arbitrage que le fil : sur mobile
          l'en-tête fait deux rangées et `top-14` ne colle plus. */}
      <div className="z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur sm:sticky sm:top-14">
        <h1 className="mr-1 text-sm font-bold">
          Lots
          <span className="ml-2 text-[11px] font-normal text-faint">
            les derniers mis en ligne sur Vinted, eBay et leboncoin
          </span>
        </h1>
      </div>

      <LotsPanel
        initial={initialRecent}
        isStale={recentIsStale}
        sort={prefs.sort}
        onSort={(value) => updatePrefs({ sort: value })}
        sized={prefs.sized}
        onSized={(value) => updatePrefs({ sized: value })}
        initialHidden={initialHidden}
        serverNow={serverNow}
      />
    </section>
  );
}

/* -------------------------------------------------------------------- liste */

function LotsPanel({
  initial,
  isStale,
  sort,
  onSort,
  sized,
  onSized,
  initialHidden,
  serverNow,
}: {
  initial: RecentLots | null;
  isStale: boolean;
  sort: LotSort;
  onSort: (value: LotSort) => void;
  sized: boolean;
  onSized: (value: boolean) => void;
  initialHidden: string[];
  serverNow: number;
}) {
  const [snapshot, setSnapshot] = useState<RecentLots | null>(initial);
  // Vrai dès le montage quand une collecte va partir, plutôt que posé au début
  // de l'effet : l'allumer là déclencherait un rendu en cascade, et afficherait
  // un premier passage sans indicateur.
  const [loading, setLoading] = useState(isStale);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [frenchOnly] = useFrenchOnly();
  const [view, setView] = useView();
  const hidden = useHidden(initialHidden);
  /** Secondes restantes avant de pouvoir relancer une collecte à la main. */
  const [cooldown, setCooldown] = useState(0);

  /**
   * La mise à jour part au montage, donc à chaque chargement de la page — et
   * seulement si le serveur a jugé son instantané périmé. C'est tout ce que la
   * page promet : on recharge, les derniers lots arrivent.
   */
  useEffect(() => {
    if (!isStale) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/lots/recents", { signal: controller.signal });
        const data = (await res.json()) as RecentLots & { error?: string };
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(data.error ?? "Recherche de lots impossible.");
        setSnapshot(data);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted || (err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Recherche de lots impossible.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [isStale]);

  // Une seconde à la fois plutôt qu'une échéance comparée à l'horloge : le
  // bouton affiche le décompte, et lire `Date.now()` au rendu rendrait le
  // composant impur.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /**
   * Relance la collecte sans égard pour la validité du quart d'heure.
   *
   * Contrairement au fil des cartes, un seul appel suffit : l'instantané des
   * lots est unique et partagé par tout le site.
   */
  async function refreshNow() {
    setCooldown(Math.round(FORCE_COOLDOWN_MS / 1000));
    setLoading(true);
    try {
      const res = await fetch("/api/lots/recents?force=1");
      const data = (await res.json()) as RecentLots & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Recherche de lots impossible.");
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recherche de lots impossible.");
    } finally {
      setLoading(false);
    }
  }

  const { rows, hiddenByLanguage, hiddenBySize, hiddenByHand } = useFiltered(
    snapshot?.items ?? [],
    { frenchOnly, sized, sort, hidden: hidden.ids },
  );

  const visible = rows.slice(0, limit);
  const collected = snapshot ? age(snapshot.at, serverNow) : null;

  return (
    <>
      <p className="text-[11px] leading-relaxed text-faint">
        Tous les lots Pokémon des trois places de marché, sans rapport avec votre collection —
        c’est le principe&nbsp;: un lot ne dit pas ce qu’il contient, et le vendeur qui liquide un
        classeur au poids ne le sait pas toujours. Vinted et eBay sont interrogés par leur tri
        « plus récentes », leboncoin par un collecteur séparé, et seules les annonces qui parlent à
        la fois de Pokémon et d’un lot sont gardées.
        {collected && <span> Dernière collecte&nbsp;: il y a {collected}.</span>}
      </p>

      <Controls
        sort={sort}
        onSort={(value) => {
          onSort(value);
          setLimit(PAGE_SIZE);
        }}
        sized={sized}
        onSized={(value) => {
          onSized(value);
          setLimit(PAGE_SIZE);
        }}
        count={rows.length}
        view={view}
        onView={setView}
        onRefresh={refreshNow}
        loading={loading}
        cooldown={cooldown}
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {snapshot?.partial && <p className="text-[11px] text-faint">Flux incomplet — {snapshot.partial}</p>}

      <Notices
        frenchOnly={frenchOnly}
        hiddenByLanguage={hiddenByLanguage}
        sized={sized}
        hiddenBySize={hiddenBySize}
      />

      <HiddenNotice
        count={hiddenByHand}
        hidden={hidden}
        singular="lot masqué"
        pluralized="lots masqués"
      />

      {loading && rows.length === 0 && <Skeletons view={view} />}

      {rows.length > 0 && (
        <Rows
          items={visible}
          total={rows.length}
          now={serverNow}
          view={view}
          onHide={hidden.hide}
          onMore={() => setLimit((current) => current + PAGE_SIZE)}
        />
      )}

      {rows.length === 0 && !loading && (
        <p className="panel px-4 py-8 text-center text-sm text-dim">
          Aucun lot Pokémon récent pour le moment. Réessayez dans un quart d’heure.
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------- filtrage partagé */

/** Filtres et tri, identiques dans les deux onglets. */
function useFiltered(
  items: LotItem[],
  {
    frenchOnly,
    sized,
    sort,
    hidden,
  }: {
    frenchOnly: boolean;
    sized: boolean;
    sort: LotSort;
    hidden: ReadonlySet<string>;
  },
) {
  return useMemo(() => {
    // Deux passes plutôt qu'un filtre à compteurs : les compteurs se mutaient
    // depuis une closure, ce que React interdit dans un rendu. L'ordre compte —
    // les masquages d'abord, la quantité ensuite — pour qu'aucun compteur ne
    // recense un lot qui ne reviendrait pas même en levant son filtre.
    const shown = hidden.size > 0 ? items.filter((item) => !hidden.has(item.id)) : items;
    const byHand = items.length - shown.length;

    const withSize = sized ? shown.filter((item) => item.quantity !== null) : shown;
    const unsized = shown.length - withSize.length;

    const kept = frenchOnly ? withSize.filter((item) => !isForeignListing(item)) : withSize;
    const foreign = withSize.length - kept.length;

    const sorted = [...kept].sort((a, b) => {
      if (sort === "date") return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      if (sort === "price") {
        return (a.totalPrice ?? a.price ?? Infinity) - (b.totalPrice ?? b.price ?? Infinity);
      }
      // Prix par carte : les lots muets sur leur quantité n'en ont pas, et
      // passent en queue plutôt que de valoir zéro et rafler la tête.
      return (a.perCard ?? Infinity) - (b.perCard ?? Infinity);
    });

    return {
      rows: sorted,
      hiddenByLanguage: foreign,
      hiddenBySize: unsized,
      hiddenByHand: byHand,
    };
  }, [items, frenchOnly, sized, sort, hidden]);
}

/* ---------------------------------------------------------------- annexes */

function Controls({
  sort,
  onSort,
  sized,
  onSized,
  count,
  view,
  onView,
  onRefresh,
  loading,
  cooldown,
}: {
  sort: LotSort;
  onSort: (value: LotSort) => void;
  sized: boolean;
  onSized: (value: boolean) => void;
  count: number;
  view: View;
  onView: (value: View) => void;
  onRefresh: () => void;
  loading: boolean;
  cooldown: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-faint">{count > 0 ? plural(count, "lot") : "aucun lot"}</span>

      <label className="control cursor-pointer sm:ml-auto">
        <span className="text-faint">Tri</span>
        <select
          value={sort}
          onChange={(event) => onSort(event.target.value as LotSort)}
          aria-label="Trier les lots"
          className="bg-transparent text-text outline-none"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value} className="bg-panel">
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        aria-pressed={sized}
        onClick={() => onSized(!sized)}
        className="control"
        title="Ne garder que les lots dont le titre annonce un nombre de cartes"
      >
        Quantité connue
      </button>

      <ViewSwitch value={view} onChange={onView} label="Affichage des lots" />

      <RefreshButton onClick={onRefresh} loading={loading} cooldown={cooldown} />
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
      {children}
    </p>
  );
}

function Notices({
  frenchOnly,
  hiddenByLanguage,
  sized,
  hiddenBySize,
}: {
  frenchOnly: boolean;
  hiddenByLanguage: number;
  sized: boolean;
  hiddenBySize: number;
}) {
  return (
    <>
      {frenchOnly && hiddenByLanguage > 0 && (
        <p className="text-[11px] text-faint">
          {plural(hiddenByLanguage, "lot")} au titre étranger{" "}
          {hiddenByLanguage > 1 ? "sont masqués" : "est masqué"} — le drapeau, en haut, lève le
          filtre.
        </p>
      )}
      {sized && hiddenBySize > 0 && (
        <p className="text-[11px] text-faint">
          {plural(hiddenBySize, "lot")} sans quantité annoncée{" "}
          {hiddenBySize > 1 ? "sont masqués" : "est masqué"}.
        </p>
      )}
    </>
  );
}

function Skeletons({ view }: { view: View }) {
  const layout = LAYOUT[view];
  return (
    <ul className={layout.list}>
      {Array.from({ length: view === "grid" ? 10 : 4 }).map((_, index) => (
        <li key={index} className={`skeleton rounded-lg border border-line ${layout.skeleton}`} />
      ))}
    </ul>
  );
}

function Rows({
  items,
  total,
  now,
  view,
  onHide,
  onMore,
}: {
  items: LotItem[];
  total: number;
  now: number;
  view: View;
  onHide: (itemId: string) => void;
  onMore: () => void;
}) {
  const Lot = view === "grid" ? LotTile : LotRow;

  return (
    <>
      <ul className={LAYOUT[view].list}>
        {items.map((item) => (
          <Lot key={item.id} item={item} now={now} onHide={() => onHide(item.id)} />
        ))}
      </ul>

      {total > items.length && (
        <button type="button" onClick={onMore} className="control mx-auto">
          Afficher {Math.min(PAGE_SIZE, total - items.length)} lots de plus
        </button>
      )}
    </>
  );
}

function LotRow({
  item,
  now,
  onHide,
}: {
  item: LotItem;
  now: number;
  onHide: () => void;
}) {
  const posted = age(item.createdAt, now);
  const remaining = item.auction ? countdown(item.endsAt, now) : null;
  const total = item.totalPrice ?? item.price;
  const fees =
    item.totalPrice !== null && item.price !== null ? item.totalPrice - item.price : null;

  return (
    <li className="animate-rise">
      <div className="group grid grid-cols-[2.75rem_1fr] items-start gap-3 rounded-lg border border-line bg-panel p-2 transition hover:border-line-strong sm:grid-cols-[3.25rem_1fr_auto]">
        {/* Comme dans le fil des cartes : la croix se pose au coin de la
            miniature et déborde dans l'écart des colonnes, faute de place
            dessus. */}
        <div className="relative">
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
              <span className="grid h-full place-items-center text-[9px] text-faint">
                sans photo
              </span>
            )}
          </a>

          <HideButton
            onClick={onHide}
            label="Masquer ce lot"
            className="absolute -right-1.5 -top-1.5 h-5 w-5 text-xs"
          />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <SourceChip source={item.source} />
            {item.quantity !== null && (
              <span className="chip" title="Quantité annoncée par le titre">
                {plural(item.quantity, "carte")}
              </span>
            )}
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate text-sm font-medium transition hover:text-accent"
            title={item.title}
          >
            {item.title}
          </a>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
            {item.condition && <span>{CONDITION_LABELS[item.condition]}</span>}
            {posted && <span title={postedHint(item.source)}>{posted}</span>}
            {item.favourites > 0 && <span>♥ {item.favourites}</span>}
            {item.promoted && <span>sponsorisée</span>}
            {item.auction && (
              <span
                className="text-dim"
                title="Enchère en cours : le prix affiché n’est pas un prix demandé, et ne donne donc pas de prix par carte."
              >
                enchère · {plural(item.bids, "offre")}
                {remaining && ` · fin dans ${remaining}`}
              </span>
            )}
          </div>
        </div>

        <div className="col-span-2 flex items-center justify-end gap-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start sm:gap-1">
          {item.perCard !== null && (
            <span
              className="rounded border border-line bg-panel-2 px-1.5 py-0.5 text-[11px] font-bold text-dim"
              title="Prix total divisé par la quantité annoncée dans le titre"
            >
              {euro(item.perCard)} / carte
            </span>
          )}

          <span className="text-right">
            <span className="block text-[15px] font-bold leading-tight">{euro(total)}</span>
            {fees !== null && fees > 0 && (
              <span className="block text-[10px] leading-tight text-faint">
                dont {euro(fees)} {feesLabel(item.source)}
              </span>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}
