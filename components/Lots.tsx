"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SourceChip, feesLabel, postedHint } from "@/components/OfferRow";
import { useFrenchOnly } from "@/components/useFrenchOnly";
import { usePersisted } from "@/components/usePersisted";
import type { FeedCard } from "@/lib/feed";
import { age, countdown, euro, plural } from "@/lib/format";
import { isForeignListing } from "@/lib/language";
import type { LotItem, LotSnapshot, RecentLots } from "@/lib/lots";
import { CONDITION_LABELS } from "@/lib/match";
import type { FavoriteCard } from "@/lib/store";

/**
 * Section « Lots », en deux onglets qui répondent à deux questions opposées.
 *
 * **Récents** — les lots Pokémon qui viennent d'être mis en ligne, toutes
 * cartes confondues. C'est là que se font les affaires : un gros lot ne dit pas
 * ce qu'il contient, et le vendeur qui liquide un classeur au poids ne le sait
 * pas toujours lui-même. La seule chose qui compte est d'arriver tôt, d'où le
 * tri par date et non par pertinence.
 *
 * **Vos cartes** — les lots dont le titre cite une carte de la collection. Plus
 * ciblé, mais forcément plus étroit : un lot de trois cents cartes ne nomme
 * personne.
 *
 * La section est repliée par défaut, et ne cherche qu'une fois dépliée. Les
 * deux onglets ne coûtent d'ailleurs pas la même chose : le flux récent vaut
 * huit recherches pour tout le site, les lots par carte quatre **par carte
 * suivie**. Ce qui est déjà sur le disque s'affiche sans rien coûter.
 */

type Tab = "recents" | "cards";
type LotSort = "date" | "perCard" | "price";

const SORTS: { value: LotSort; label: string }[] = [
  { value: "date", label: "Plus récents" },
  { value: "perCard", label: "Prix par carte" },
  { value: "price", label: "Prix total" },
];

interface LotPrefs {
  open: boolean;
  tab: Tab;
  /** Un tri par onglet : « récents » veut une date, « vos cartes » un prix. */
  sortRecent: LotSort;
  sortCards: LotSort;
  /** N'afficher que les lots dont le titre annonce un nombre de cartes. */
  sized: boolean;
}

/**
 * Constante de module : c'est la clé de mémoïsation de `usePersisted`.
 *
 * Dépliée par défaut. La première version ne l'était pas, pour épargner des
 * requêtes aux catalogues — le résultat était une ligne de texte de dix pixels
 * en bas d'un fil de deux cents annonces, que personne ne voyait. L'économie
 * n'en était pas une : l'onglet par défaut coûte huit recherches par quart
 * d'heure **pour tout le site**, puisque son instantané ne dépend d'aucune
 * collection. C'est l'onglet « Vos cartes » qui est cher, et lui ne cherche
 * qu'une fois ouvert.
 */
const DEFAULT_PREFS: LotPrefs = {
  open: true,
  tab: "recents",
  sortRecent: "date",
  sortCards: "perCard",
  sized: false,
};

/**
 * Le suffixe de version n'est pas décoratif : `usePersisted` fusionne la valeur
 * enregistrée **par-dessus** les défauts, si bien qu'un `open: false` mémorisé
 * du temps où la section était repliée survivait au changement de défaut. Ceux
 * qui avaient déjà ouvert le site — les seuls à avoir un avis sur la question —
 * étaient précisément ceux à qui la section restait invisible. Changer de clé
 * les remet sur le défaut courant, au prix d'un tri à repositionner une fois.
 */
const PREFS_KEY = "pokebroc:lots:v2";

const PAGE_SIZE = 24;

export default function Lots({
  favorites,
  initialSnapshots,
  initialStaleIds,
  initialRecent,
  recentIsStale,
  serverNow,
}: {
  favorites: FavoriteCard[];
  initialSnapshots: LotSnapshot[];
  initialStaleIds: string[];
  initialRecent: RecentLots | null;
  recentIsStale: boolean;
  serverNow: number;
}) {
  const [prefs, updatePrefs] = usePersisted(PREFS_KEY, DEFAULT_PREFS);

  // Normalisés plutôt que lus tels quels : les valeurs viennent de
  // `localStorage`, où une clé inconnue est toujours possible.
  const tab: Tab = prefs.tab === "cards" ? "cards" : "recents";

  return (
    /* La bordure haute sépare les lots du fil : ce sont deux marchandises
       différentes, et sans elle la section se lisait comme la suite des
       annonces à l'unité. */
    <section className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-sm font-bold">
          Lots
          <span className="ml-2 text-[11px] font-normal text-faint">
            {tab === "recents"
              ? "les derniers mis en ligne, toutes cartes confondues"
              : "ceux dont le titre cite une de vos cartes"}
          </span>
        </h2>

        {prefs.open && (
          <div
            role="group"
            aria-label="Onglets des lots"
            className="flex h-8 items-center gap-0.5 rounded-lg border border-line bg-panel-2 p-0.5"
          >
            <TabButton
              active={tab === "recents"}
              onClick={() => updatePrefs({ tab: "recents" })}
              hint="Les lots Pokémon qui viennent d’être mis en ligne, toutes cartes confondues"
            >
              Récents
            </TabButton>
            <TabButton
              active={tab === "cards"}
              onClick={() => updatePrefs({ tab: "cards" })}
              hint="Les lots dont le titre cite une carte de votre collection"
            >
              Vos cartes
            </TabButton>
          </div>
        )}

        <button
          type="button"
          onClick={() => updatePrefs({ open: !prefs.open })}
          aria-expanded={prefs.open}
          className="control ml-auto"
        >
          {prefs.open ? "Replier" : "Déplier"}
        </button>
      </div>

      {prefs.open && tab === "recents" && (
        <RecentPanel
          initial={initialRecent}
          isStale={recentIsStale}
          sort={prefs.sortRecent}
          onSort={(value) => updatePrefs({ sortRecent: value })}
          sized={prefs.sized}
          onSized={(value) => updatePrefs({ sized: value })}
          serverNow={serverNow}
        />
      )}

      {prefs.open && tab === "cards" && (
        <CardsPanel
          favorites={favorites}
          initialSnapshots={initialSnapshots}
          initialStaleIds={initialStaleIds}
          sort={prefs.sortCards}
          onSort={(value) => updatePrefs({ sortCards: value })}
          sized={prefs.sized}
          onSized={(value) => updatePrefs({ sized: value })}
          serverNow={serverNow}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------ lots récents */

function RecentPanel({
  initial,
  isStale,
  sort,
  onSort,
  sized,
  onSized,
  serverNow,
}: {
  initial: RecentLots | null;
  isStale: boolean;
  sort: LotSort;
  onSort: (value: LotSort) => void;
  sized: boolean;
  onSized: (value: boolean) => void;
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

  /**
   * L'onglet n'est monté que déplié : la collecte peut donc partir d'un effet
   * sans condition d'ouverture. Elle ne part qu'une fois — replier puis
   * déplier remonte le composant, mais l'instantané reçu est alors frais et
   * `isStale` reflète l'état du serveur au chargement de la page, pas celui
   * d'après collecte. D'où le garde-fou sur `snapshot`.
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

  const { rows, hiddenByLanguage, hiddenBySize } = useFiltered(
    snapshot?.items ?? [],
    { frenchOnly, sized, sort },
  );

  const visible = rows.slice(0, limit);
  const collected = snapshot ? age(snapshot.at, serverNow) : null;

  return (
    <>
      <p className="text-[11px] leading-relaxed text-faint">
        Les lots Pokémon qui viennent d’être mis en ligne, sans rapport avec votre collection —
        c’est le principe&nbsp;: un lot ne dit pas ce qu’il contient, et le vendeur qui liquide un
        classeur au poids ne le sait pas toujours. Vinted et eBay sont interrogés par leur tri
        « plus récentes », et seules les annonces qui parlent à la fois de Pokémon et d’un lot sont
        gardées.
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
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {snapshot?.partial && <p className="text-[11px] text-faint">Flux incomplet — {snapshot.partial}</p>}

      <Notices
        frenchOnly={frenchOnly}
        hiddenByLanguage={hiddenByLanguage}
        sized={sized}
        hiddenBySize={hiddenBySize}
      />

      {loading && rows.length === 0 && <Skeletons />}

      {rows.length > 0 && (
        <Rows
          items={visible}
          total={rows.length}
          cards={{}}
          now={serverNow}
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

/* ------------------------------------------------------- lots de vos cartes */

function CardsPanel({
  favorites,
  initialSnapshots,
  initialStaleIds,
  sort,
  onSort,
  sized,
  onSized,
  serverNow,
}: {
  favorites: FavoriteCard[];
  initialSnapshots: LotSnapshot[];
  initialStaleIds: string[];
  sort: LotSort;
  onSort: (value: LotSort) => void;
  sized: boolean;
  onSized: (value: boolean) => void;
  serverNow: number;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, LotSnapshot>>(() =>
    Object.fromEntries(initialSnapshots.map((snapshot) => [snapshot.card.cardId, snapshot])),
  );
  const [settled, setSettled] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [frenchOnly] = useFrenchOnly();

  const staleKey = initialStaleIds.join("|");
  const fetching = initialStaleIds.filter((id) => !settled.includes(id)).length > 0;

  useEffect(() => {
    const ids = staleKey ? staleKey.split("|") : [];
    if (ids.length === 0) return;

    const controller = new AbortController();
    let failures = 0;

    void Promise.all(
      ids.map(async (cardId) => {
        try {
          const res = await fetch(`/api/lots?cardId=${encodeURIComponent(cardId)}`, {
            signal: controller.signal,
          });
          const data = (await res.json()) as LotSnapshot & { error?: string };
          if (controller.signal.aborted) return;
          if (!res.ok) throw new Error(data.error ?? "Recherche de lots impossible.");
          setSnapshots((current) => ({ ...current, [cardId]: data }));
        } catch (err) {
          if (controller.signal.aborted || (err as Error).name === "AbortError") return;
          failures += 1;
          setError(err instanceof Error ? err.message : "Recherche de lots impossible.");
        } finally {
          if (!controller.signal.aborted) setSettled((current) => [...current, cardId]);
        }
      }),
    ).then(() => {
      // Une carte en échec sur dix n'est qu'un détail ; tout échouer est un
      // vrai problème, et c'est le seul cas qui mérite de rester affiché.
      if (!controller.signal.aborted && failures < ids.length) setError(null);
    });

    return () => controller.abort();
  }, [staleKey]);

  const cards = useMemo(() => {
    const byId: Record<string, FeedCard> = {};
    for (const snapshot of Object.values(snapshots)) byId[snapshot.card.cardId] = snapshot.card;
    return byId;
  }, [snapshots]);

  const partial = useMemo(() => {
    const messages = new Set<string>();
    for (const snapshot of Object.values(snapshots)) {
      if (snapshot.partial) messages.add(snapshot.partial);
    }
    return [...messages];
  }, [snapshots]);

  const items = useMemo(() => {
    const followed = new Set(favorites.map((favorite) => favorite.cardId));

    // Un gros lot remonte sur plusieurs cartes de la collection à la fois —
    // c'est même sa raison d'être. On ne le montre qu'une fois, rattaché à la
    // carte pour laquelle il a obtenu la meilleure note.
    const best = new Map<string, LotItem>();
    for (const snapshot of Object.values(snapshots)) {
      if (!followed.has(snapshot.card.cardId)) continue;
      for (const item of snapshot.items) {
        const known = best.get(item.id);
        if (!known || item.score > known.score) best.set(item.id, item);
      }
    }
    return [...best.values()];
  }, [snapshots, favorites]);

  const { rows, hiddenByLanguage, hiddenBySize } = useFiltered(items, {
    frenchOnly,
    sized,
    sort,
  });

  const visible = rows.slice(0, limit);

  return (
    <>
      <p className="text-[11px] leading-relaxed text-faint">
        Les lots dont le titre cite une de vos cartes ou son extension — cherchés à part du fil,
        avec leurs propres requêtes («&nbsp;lot Dracaufeu&nbsp;», «&nbsp;lot cartes Set de
        Base&nbsp;»), parce qu’un gros lot ne cite jamais le numéro d’une carte. Leur prix n’est pas
        comparé à la cote&nbsp;: un lot ne contient pas deux cents fois la même carte, et l’écart
        affiché serait faux.
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
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {partial.length > 0 && (
        <p className="text-[11px] text-faint">Flux incomplet — {partial.join(" · ")}</p>
      )}

      <Notices
        frenchOnly={frenchOnly}
        hiddenByLanguage={hiddenByLanguage}
        sized={sized}
        hiddenBySize={hiddenBySize}
      />

      {fetching && rows.length === 0 && <Skeletons />}

      {rows.length > 0 && (
        <Rows
          items={visible}
          total={rows.length}
          cards={cards}
          now={serverNow}
          onMore={() => setLimit((current) => current + PAGE_SIZE)}
        />
      )}

      {rows.length === 0 && !fetching && (
        <p className="panel px-4 py-8 text-center text-sm text-dim">
          Aucun lot ne cite vos cartes ni leurs extensions en ce moment.
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------- filtrage partagé */

/** Filtres et tri, identiques dans les deux onglets. */
function useFiltered(
  items: LotItem[],
  { frenchOnly, sized, sort }: { frenchOnly: boolean; sized: boolean; sort: LotSort },
) {
  return useMemo(() => {
    // Deux passes plutôt qu'un filtre à compteurs : les compteurs se mutaient
    // depuis une closure, ce que React interdit dans un rendu. L'ordre compte —
    // la quantité d'abord — pour que le compteur de langue ne recense que des
    // lots qui seraient effectivement visibles sans le drapeau.
    const withSize = sized ? items.filter((item) => item.quantity !== null) : items;
    const unsized = items.length - withSize.length;

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

    return { rows: sorted, hiddenByLanguage: foreign, hiddenBySize: unsized };
  }, [items, frenchOnly, sized, sort]);
}

/* ---------------------------------------------------------------- annexes */

function TabButton({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={`rounded-md px-2.5 py-1 text-[13px] leading-none transition ${
        active ? "bg-accent/15 font-medium text-accent" : "text-faint hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Controls({
  sort,
  onSort,
  sized,
  onSized,
  count,
}: {
  sort: LotSort;
  onSort: (value: LotSort) => void;
  sized: boolean;
  onSized: (value: boolean) => void;
  count: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-faint">{count > 0 ? plural(count, "lot") : "aucun lot"}</span>

      <label className="control ml-auto cursor-pointer">
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

function Skeletons() {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index} className="skeleton h-[4.75rem] rounded-lg border border-line" />
      ))}
    </ul>
  );
}

function Rows({
  items,
  total,
  cards,
  now,
  onMore,
}: {
  items: LotItem[];
  total: number;
  cards: Record<string, FeedCard>;
  now: number;
  onMore: () => void;
}) {
  return (
    <>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <LotRow
            key={item.id}
            item={item}
            card={item.cardId ? cards[item.cardId] : undefined}
            now={now}
          />
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

function LotRow({ item, card, now }: { item: LotItem; card: FeedCard | undefined; now: number }) {
  const posted = age(item.createdAt, now);
  const remaining = item.auction ? countdown(item.endsAt, now) : null;
  const total = item.totalPrice ?? item.price;
  const fees =
    item.totalPrice !== null && item.price !== null ? item.totalPrice - item.price : null;

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
            <img src={item.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full place-items-center text-[9px] text-faint">sans photo</span>
          )}
        </a>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {card && (
              <Link
                href={`/carte/${encodeURIComponent(card.cardId)}`}
                className="text-[11px] font-semibold text-accent transition hover:underline"
                title="Carte de votre collection à laquelle ce lot a été rattaché"
              >
                {card.name}
                {card.localId && <span className="font-normal opacity-70"> n°{card.localId}</span>}
              </Link>
            )}
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
