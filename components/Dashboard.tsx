"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { clearNewBadges } from "@/app/actions/feed";
import CollectionStrip, { type CardCount } from "@/components/CollectionStrip";
import CardmarketColumn from "@/components/CardmarketColumn";
import HiddenNotice from "@/components/HiddenNotice";
import type { CardmarketRow } from "@/lib/cardmarket";
import OfferRow from "@/components/OfferRow";
import OfferTile from "@/components/OfferTile";
import { useFrenchOnly } from "@/components/useFrenchOnly";
import { useHidden } from "@/components/useHidden";
import { usePersisted } from "@/components/usePersisted";
import RefreshButton from "@/components/RefreshButton";
import ViewSwitch, { LAYOUT, useView } from "@/components/ViewSwitch";
import { FORCE_COOLDOWN_MS } from "@/lib/rate-limit";
import type { FeedCard, FeedItem, Snapshot } from "@/lib/feed";
import { percent, plural } from "@/lib/format";
import { isForeignListing } from "@/lib/language";
import { STRONG_SCORE, WIDE_SCORE } from "@/lib/match";
import type { FavoriteCard } from "@/lib/store";

/**
 * Tableau de bord : collection, filtres et fil unique.
 *
 * Le serveur envoie les instantanés déjà sur le disque, donc la page est
 * complète dès le premier rendu ; ce composant ne rattrape en arrière-plan que
 * les cartes dont l'instantané a expiré. C'est l'inverse de la version
 * précédente, qui n'affichait rien tant que les vingt recherches Vinted
 * n'étaient pas revenues.
 *
 * Il tient aussi l'état partagé entre le bandeau de collection et le fil : le
 * bandeau n'est plus décoratif, il filtre.
 */

type Sort = "deal" | "date" | "price" | "relevance";

const SORTS: { value: Sort; label: string }[] = [
  { value: "deal", label: "Meilleures affaires" },
  { value: "date", label: "Derniers ajouts" },
  { value: "price", label: "Prix croissant" },
  { value: "relevance", label: "Plus pertinentes" },
];

interface Filters {
  sort: Sort;
  /** Descend le seuil de pertinence : le nom de la carte suffit. */
  wide: boolean;
  hideGraded: boolean;
  hideBulk: boolean;
  onlyNew: boolean;
  /** Saisi en texte pour laisser le champ vide, qui n'est pas « 0 ». */
  maxPrice: string;
}

/** Constante de module : c'est la clé de mémoïsation de `usePersisted`. */
const DEFAULT_FILTERS: Filters = {
  sort: "deal",
  wide: false,
  // Une PSA 10 se compare à la cote d'une carte brute : l'écart affiché serait
  // faux dans les deux sens. Masquées par défaut, montrables d'un clic.
  hideGraded: true,
  hideBulk: true,
  onlyNew: false,
  maxPrice: "",
};

const FILTERS_KEY = "pokebroc:filtres";

/**
 * Annonces affichées par carte quand le fil les mélange toutes. Sans ce
 * plafond, une carte très représentée sur Vinted occupe tout l'écran et les
 * autres n'apparaissent jamais. Sélectionner une carte le lève.
 */
const MAX_PER_CARD = 12;
const PAGE_SIZE = 60;

/**
 * Collectes menées de front pendant un rafraîchissement.
 *
 * Le fil lançait une requête **par carte suivie**, toutes en même temps — 48
 * appels simultanés à `/api/feed`. Un navigateur n'ouvre que six connexions par
 * origine : les quarante-deux autres attendaient, et la navigation vers la page
 * Lots attendait derrière elles. Cliquer « Lots » pendant une actualisation ne
 * faisait donc rien pendant une bonne minute.
 *
 * Les brider ne coûte rien en durée, et c'est ce qui rend l'arbitrage facile :
 * `lib/vinted.ts` sérialise **déjà** tous ses appels à 350 ms d'intervalle
 * (`schedule`), et `lib/ebay.ts` fait de même. Quarante-huit cartes, c'est-à-dire
 * quatre-vingt-seize recherches Vinted, prennent une trentaine de secondes quoi
 * qu'il arrive. Les envoyer toutes d'un coup n'accélérait rien : ça ne faisait
 * qu'occuper les connexions du navigateur pour attendre plus longtemps.
 *
 * Quatre suffisent à garder la file du serveur pleine, et laissent de quoi
 * charger une autre page.
 */
const REFRESH_CONCURRENCY = 4;

/**
 * Applique `run` à chaque élément, `limit` à la fois.
 *
 * `Promise.all` sur un `map` lance tout ; ici les ouvriers se partagent une file
 * commune, de sorte qu'un seul d'entre eux avance à la fois par emplacement.
 */
async function pooled<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await run(items[next++]);
    }
  });
  await Promise.all(workers);
}

/** Rythme de rafraîchissement des « il y a 2 h » affichés dans le fil. */
const CLOCK_MS = 60_000;

export default function Dashboard({
  favorites,
  initialSnapshots,
  initialStaleIds,
  initialHidden,
  newSince,
  serverNow,
  cardmarketOffers,
  cardmarketWarning,
}: {
  favorites: FavoriteCard[];
  initialSnapshots: Snapshot[];
  initialStaleIds: string[];
  /** Annonces déjà écartées du fil, lues dans `users.json`. */
  initialHidden: string[];
  /** Les annonces vues après cette date portent la pastille « nouveau ». */
  newSince: number;
  /** Horloge du serveur, pour que le premier rendu client soit identique. */
  serverNow: number;
  /** Dernières offres Cardmarket, pour la colonne de droite. */
  cardmarketOffers: CardmarketRow[];
  /** Pourquoi Cardmarket est vide, quand il l'est — voir `cardmarketWarning`. */
  cardmarketWarning: string | null;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>(() =>
    Object.fromEntries(initialSnapshots.map((snapshot) => [snapshot.card.cardId, snapshot])),
  );
  const [settled, setSettled] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, updateFilters] = usePersisted(FILTERS_KEY, DEFAULT_FILTERS);
  const [view, setView] = useView();
  // Piloté depuis le drapeau de l'en-tête, via le magasin de `usePersisted`.
  const [frenchOnly] = useFrenchOnly();
  const hidden = useHidden(initialHidden);
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [now, setNow] = useState(serverNow);
  const [, startTransition] = useTransition();

  /**
   * Cartes d'un rafraîchissement demandé à la main, `null` le reste du temps.
   *
   * Le rattrapage automatique ne porte que sur les cartes périmées ; « Actualiser »
   * les reprend *toutes*, y compris celles dont l'instantané a deux minutes —
   * c'est précisément pour celles-là qu'on clique.
   */
  const [forced, setForced] = useState<string[] | null>(null);

  /**
   * Secondes restantes avant de pouvoir recliquer. Décomptées en état plutôt
   * que calculées depuis `Date.now()` au rendu, qui rendrait le composant impur.
   */
  const [cooldown, setCooldown] = useState(0);

  /**
   * Le rafraîchissement en cours, pour qu'un second clic remplace le premier
   * au lieu de doubler les collectes.
   *
   * Volontairement **pas** annulé au démontage, à la différence du rattrapage
   * automatique : passer aux Lots pendant une actualisation ne doit pas
   * l'interrompre. La bascule de l'en-tête est un `Link`, donc une navigation
   * côté client — le contexte JavaScript survit, et les collectes en cours
   * poursuivent leur route.
   *
   * Rien n'est perdu en chemin non plus : chaque collecte écrit son instantané
   * sur le disque avant de répondre. Les `setState` qui reviennent après le
   * démontage ne servent plus à rien, mais le travail, lui, est déjà rangé — et
   * la page d'accueil, qui se rend depuis le disque, le retrouve au retour.
   */
  const forcedRun = useRef<AbortController | null>(null);
  /** Idem pour le rattrapage automatique, remplacé quand la liste change. */
  const catchUp = useRef<AbortController | null>(null);

  const staleKey = initialStaleIds.join("|");

  // La liste des cartes à rattraper a changé : on repart d'un avancement neuf.
  // Ajusté pendant le rendu plutôt que dans un effet, pour ne pas afficher une
  // barre de progression périmée le temps d'un aller-retour.
  const [seenStaleKey, setSeenStaleKey] = useState(staleKey);
  if (seenStaleKey !== staleKey) {
    setSeenStaleKey(staleKey);
    setSettled([]);
  }

  const pending = (forced ?? initialStaleIds).filter((cardId) => !settled.includes(cardId));

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    updateFilters({ [key]: value } as Partial<Filters>);
    setLimit(PAGE_SIZE);
  }

  /* ------------------------------------------------------- rafraîchissement */

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  // Une seconde à la fois plutôt qu'une échéance comparée à l'horloge : le
  // bouton affiche le décompte, et `now` ne bat qu'à la minute.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /**
   * Reprend toutes les cartes, sans égard pour la validité des instantanés.
   *
   * Le serveur tient le même délai de son côté (`FORCE_COOLDOWN_MS`) : le
   * décompte affiché ici n'est qu'un confort, pas la garde.
   */
  function refreshAll() {
    const ids = favorites.map((favorite) => favorite.cardId);
    if (ids.length === 0) return;

    setCooldown(Math.round(FORCE_COOLDOWN_MS / 1000));
    setSettled([]);
    setForced(ids);

    forcedRun.current?.abort();
    const controller = new AbortController();
    forcedRun.current = controller;

    let failures = 0;

    void pooled(ids, REFRESH_CONCURRENCY, async (cardId) => {
      if (controller.signal.aborted) return;
      try {
        const res = await fetch(`/api/feed?cardId=${encodeURIComponent(cardId)}&force=1`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as Snapshot & { error?: string };
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(data.error ?? "Recherche d’annonces impossible.");
        setSnapshots((current) => ({ ...current, [cardId]: data }));
      } catch (err) {
        if (controller.signal.aborted || (err as Error).name === "AbortError") return;
        failures += 1;
        setError(err instanceof Error ? err.message : "Recherche d’annonces impossible.");
      } finally {
        if (!controller.signal.aborted) setSettled((current) => [...current, cardId]);
      }
    }).then(() => {
      if (controller.signal.aborted) return;
      if (failures < ids.length) setError(null);
      // Rendre la main au rattrapage automatique : sans ça, une carte ajoutée
      // plus tard resterait hors du décompte d'avancement.
      setForced(null);
      setNow(Date.now());
    });
  }

  /**
   * Rattrapage des cartes périmées, au chargement de la page.
   *
   * L'annulation est posée à l'entrée plutôt qu'en nettoyage d'effet, et c'est
   * la même raison que pour `refreshAll` : le nettoyage se déclenche aussi bien
   * quand la liste change **que lorsqu'on quitte la page**, et les deux ne
   * méritent pas le même sort. Une liste qui change rend le rattrapage en cours
   * caduc ; passer aux Lots, non — la collecte doit poursuivre sa route, son
   * résultat étant de toute façon écrit sur le disque avant de répondre.
   */
  useEffect(() => {
    const ids = staleKey ? staleKey.split("|") : [];
    if (ids.length === 0) return;

    catchUp.current?.abort();
    const controller = new AbortController();
    catchUp.current = controller;

    let failures = 0;

    void pooled(ids, REFRESH_CONCURRENCY, async (cardId) => {
      if (controller.signal.aborted) return;
      try {
        const res = await fetch(`/api/feed?cardId=${encodeURIComponent(cardId)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as Snapshot & { error?: string };
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(data.error ?? "Recherche d’annonces impossible.");
        setSnapshots((current) => ({ ...current, [cardId]: data }));
      } catch (err) {
        if (controller.signal.aborted || (err as Error).name === "AbortError") return;
        failures += 1;
        setError(err instanceof Error ? err.message : "Recherche d’annonces impossible.");
      } finally {
        if (!controller.signal.aborted) {
          setSettled((current) => [...current, cardId]);
        }
      }
    }).then(() => {
      // Une carte en échec sur dix n'est qu'un détail ; tout échouer est un
      // vrai problème, et c'est le seul cas qui mérite de rester affiché.
      if (!controller.signal.aborted && failures < ids.length) setError(null);
    });
  }, [staleKey]);

  /* --------------------------------------------------------------- dérivés */

  const cards = useMemo(() => {
    const byId: Record<string, FeedCard> = {};
    for (const snapshot of Object.values(snapshots)) byId[snapshot.card.cardId] = snapshot.card;
    return byId;
  }, [snapshots]);

  /**
   * Une place de marché muette pendant que l'autre répond. Le fil reste utile,
   * donc ce n'est pas une erreur — mais le taire laisserait croire que les
   * cartes n'ont pas d'annonces là-bas, alors qu'on n'a pas pu regarder.
   */
  const partial = useMemo(() => {
    const messages = new Set<string>();
    for (const snapshot of Object.values(snapshots)) {
      if (snapshot.partial) messages.add(snapshot.partial);
    }
    return [...messages];
  }, [snapshots]);

  const threshold = filters.wide ? WIDE_SCORE : STRONG_SCORE;
  const maxPrice = Number.parseFloat(filters.maxPrice);
  const hasMaxPrice = Number.isFinite(maxPrice) && maxPrice > 0;

  /** Annonces retenues, dédoublonnées et triées. Les compteurs en découlent. */
  const { rows, counts, hiddenByThreshold, hiddenByLanguage, hiddenByHand, stats } = useMemo(() => {
    const followed = new Set(favorites.map((favorite) => favorite.cardId));

    // La même annonce peut remonter sur deux cartes : on garde la meilleure note.
    const best = new Map<string, FeedItem>();
    for (const snapshot of Object.values(snapshots)) {
      if (!followed.has(snapshot.card.cardId)) continue;
      for (const item of snapshot.items) {
        const known = best.get(item.id);
        if (!known || item.score > known.score) best.set(item.id, item);
      }
    }

    let wideOnly = 0;
    let foreign = 0;
    let byHand = 0;
    const kept = [...best.values()].filter((item) => {
      // En premier, et avant même le seuil : une annonce congédiée à la main
      // n'est plus dans le fil à aucun titre, et ne doit donc peser dans aucun
      // des autres compteurs — sans quoi « 3 annonces au titre étranger sont
      // masquées » promettrait un retour qui n'aurait pas lieu.
      if (hidden.ids.has(item.id)) {
        byHand += 1;
        return false;
      }
      if (item.score < threshold) {
        if (item.score >= WIDE_SCORE) wideOnly += 1;
        return false;
      }
      if (filters.hideGraded && item.graded) return false;
      if (filters.hideBulk && item.bulk) return false;
      if (filters.onlyNew && item.firstSeen <= newSince) return false;
      if (hasMaxPrice && (item.totalPrice ?? item.price ?? Infinity) > maxPrice) return false;
      // En dernier, pour que le compteur ne recense que des annonces qui
      // seraient effectivement visibles sans le drapeau.
      if (frenchOnly && isForeignListing(item)) {
        foreign += 1;
        return false;
      }
      return true;
    });

    // Compteurs par carte : calculés avant la sélection, sinon le bandeau
    // afficherait « 0 annonce » sur toutes les cartes non sélectionnées.
    const counts: Record<string, CardCount> = {};
    for (const item of kept) {
      const entry = (counts[item.cardId] ??= { total: 0, fresh: 0 });
      entry.total += 1;
      if (item.firstSeen > newSince) entry.fresh += 1;
    }

    const scoped = selected ? kept.filter((item) => item.cardId === selected) : kept;

    const sorted = [...scoped].sort((a, b) => {
      if (filters.sort === "date") return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      if (filters.sort === "price") {
        return (a.totalPrice ?? a.price ?? Infinity) - (b.totalPrice ?? b.price ?? Infinity);
      }
      if (filters.sort === "relevance") return b.score - a.score;
      // Meilleures affaires : l'écart le plus négatif d'abord, sans cote en dernier.
      return (a.vsMarket ?? Infinity) - (b.vsMarket ?? Infinity);
    });

    // Le plafond par carte s'applique après le tri, pour garder les meilleures
    // annonces de chaque carte plutôt que les premières venues.
    const perCard = new Map<string, number>();
    const rows = selected
      ? sorted
      : sorted.filter((item) => {
          const seen = perCard.get(item.cardId) ?? 0;
          if (seen >= MAX_PER_CARD) return false;
          perCard.set(item.cardId, seen + 1);
          return true;
        });

    const deviations = scoped
      .map((item) => item.vsMarket)
      .filter((value): value is number => value !== null);

    return {
      rows,
      counts,
      hiddenByThreshold: wideOnly,
      hiddenByLanguage: foreign,
      hiddenByHand: byHand,
      stats: {
        total: scoped.length,
        fresh: scoped.filter((item) => item.firstSeen > newSince).length,
        deals: deviations.filter((value) => value <= -15).length,
        bestDeal: deviations.length > 0 ? Math.min(...deviations) : null,
      },
    };
  }, [
    snapshots,
    favorites,
    threshold,
    filters,
    selected,
    newSince,
    hasMaxPrice,
    maxPrice,
    frenchOnly,
    hidden.ids,
  ]);

  const visible = rows.slice(0, limit);
  const loading = pending.length > 0;
  const layout = LAYOUT[view];

  function markSeen() {
    startTransition(async () => {
      await clearNewBadges();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <StatBar stats={stats} cards={favorites.length} />

      <CollectionStrip
        favorites={favorites}
        counts={counts}
        selected={selected}
        onSelect={(cardId) => {
          setSelected(cardId);
          setLimit(PAGE_SIZE);
        }}
      />

      {/* Le fil à gauche (pleine largeur, comme avant), la colonne Cardmarket à
          droite dans l'espace laissé libre — la page s'élargit plutôt que de
          comprimer le fil. Elles s'empilent sous `xl`. */}
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Collée sous l'en-tête : sur un fil de deux cents lignes, retrouver le
            tri imposait sinon de remonter tout en haut. À partir de `sm`
            seulement — sur un téléphone, les filtres s'étalent sur trois ou
            quatre rangées et une barre sticky de cette hauteur mangeait la
            moitié de l'écran. `top-14` suppose l'en-tête sur une rangée, ce qui
            n'est vrai qu'à partir de `sm` aussi. */}
        <div className="z-20 -mx-4 flex flex-wrap items-center gap-2 border-y border-line bg-bg/95 px-4 py-2 backdrop-blur sm:sticky sm:top-14">
          <h2 className="mr-1 w-full text-sm font-bold sm:w-auto">
            {selected ? (cards[selected]?.name ?? "Carte") : "Les offres du moment"}
            <span className="ml-2 text-[11px] font-normal text-faint">
              {plural(rows.length, "annonce")}
            </span>
          </h2>

          <label className="control cursor-pointer">
            <span className="text-faint">Tri</span>
            <select
              value={filters.sort}
              onChange={(event) => update("sort", event.target.value as Sort)}
              aria-label="Trier les annonces"
              className="bg-transparent text-text outline-none"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value} className="bg-panel">
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <Toggle
            pressed={filters.onlyNew}
            onChange={(value) => update("onlyNew", value)}
            disabled={stats.fresh === 0 && !filters.onlyNew}
          >
            Nouveautés
            {stats.fresh > 0 && <span className="font-bold text-new">{stats.fresh}</span>}
          </Toggle>

          <Toggle pressed={filters.hideGraded} onChange={(value) => update("hideGraded", value)}>
            Sans gradées
          </Toggle>

          <Toggle pressed={filters.hideBulk} onChange={(value) => update("hideBulk", value)}>
            Sans lots
          </Toggle>

          <label className="control">
            <span className="text-faint">Max</span>
            <input
              value={filters.maxPrice}
              onChange={(event) => update("maxPrice", event.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="—"
              aria-label="Prix maximum en euros"
              className="w-12 bg-transparent text-text outline-none placeholder:text-faint"
            />
            <span className="text-faint">€</span>
          </label>

          <Toggle pressed={filters.wide} onChange={(value) => update("wide", value)}>
            Élargir
          </Toggle>

          {/* `w-full` sur mobile : le `ml-auto` seul laissait le groupe se
              glisser dans les trous de la rangée précédente, chiffres
              d'avancement pliés à la verticale compris. */}
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <ViewSwitch value={view} onChange={setView} />

            {loading && (
              <span
                className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-faint"
                aria-live="polite"
              >
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent"
                  aria-hidden
                />
                {favorites.length - pending.length} / {favorites.length}
              </span>
            )}
            {/* Le seul geste du site qui interroge les catalogues sur commande.
                Il existe parce que recharger la page ne suffisait pas : tant
                qu'un instantané a moins de dix minutes, le serveur le rend tel
                quel, et une annonce parue entre-temps restait inaccessible. */}
            <RefreshButton
              onClick={refreshAll}
              loading={loading}
              cooldown={cooldown}
              disabled={favorites.length === 0}
            />

            {stats.fresh > 0 && (
              <button type="button" onClick={markSeen} className="control">
                Tout marquer comme vu
              </button>
            )}
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

        {partial.length > 0 && (
          <p className="text-[11px] text-faint">Fil incomplet — {partial.join(" · ")}</p>
        )}

        {!filters.wide && hiddenByThreshold > 0 && rows.length > 0 && (
          <p className="text-[11px] text-faint">
            {plural(hiddenByThreshold, "annonce")} ne citant que le nom{" "}
            {hiddenByThreshold > 1 ? "sont masquées" : "est masquée"} — « Élargir » les affiche.
          </p>
        )}

        <HiddenNotice
          count={hiddenByHand}
          hidden={hidden}
          singular="annonce masquée"
          pluralized="annonces masquées"
        />

        {/* Affiché même quand le fil est vide : sans cette phrase, un filtre
            posé depuis l’en-tête laisserait croire à une panne de collecte. */}
        {frenchOnly && hiddenByLanguage > 0 && (
          <p className="text-[11px] text-faint">
            {plural(hiddenByLanguage, "annonce")} au titre étranger{" "}
            {hiddenByLanguage > 1 ? "sont masquées" : "est masquée"} — le drapeau, en haut, lève le
            filtre.
          </p>
        )}

        {rows.length === 0 && loading && (
          <ul className={layout.list}>
            {Array.from({ length: 8 }).map((_, index) => (
              <li
                key={index}
                className={`skeleton rounded-lg border border-line ${layout.skeleton}`}
              />
            ))}
          </ul>
        )}

        {rows.length === 0 && !loading && (
          <EmptyFeed
            wide={filters.wide}
            hidden={hiddenByThreshold}
            onWiden={() => update("wide", true)}
            onlyNew={filters.onlyNew}
            onShowAll={() => update("onlyNew", false)}
          />
        )}

        {rows.length > 0 && (
          <>
            <ul className={layout.list}>
              {visible.map((item) => {
                const card = cards[item.cardId];
                if (!card) return null;
                const Offer = view === "grid" ? OfferTile : OfferRow;
                return (
                  <Offer
                    key={item.id}
                    item={item}
                    card={card}
                    isNew={item.firstSeen > newSince}
                    now={now}
                    onHide={() => hidden.hide(item.id)}
                  />
                );
              })}
            </ul>

            {rows.length > visible.length && (
              <button
                type="button"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
                className="control mx-auto"
              >
                Afficher {Math.min(PAGE_SIZE, rows.length - visible.length)} annonces de plus
              </button>
            )}
          </>
        )}

        {selected && (
          <Link
            href={`/carte/${encodeURIComponent(selected)}`}
            className="mx-auto text-[11px] text-accent transition hover:underline"
          >
            Ouvrir la fiche complète de {cards[selected]?.name ?? "cette carte"} →
          </Link>
        )}
      </section>

        <CardmarketColumn offers={cardmarketOffers} warning={cardmarketWarning} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- annexes */

function Toggle({
  pressed,
  onChange,
  disabled,
  children,
}: {
  pressed: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
      className="control"
    >
      {children}
    </button>
  );
}

function StatBar({
  stats,
  cards,
}: {
  stats: { total: number; fresh: number; deals: number; bestDeal: number | null };
  cards: number;
}) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Cartes suivies" value={String(cards)} />
      <Stat label="Annonces" value={String(stats.total)} />
      <Stat
        label="Nouvelles"
        value={String(stats.fresh)}
        tone={stats.fresh > 0 ? "new" : undefined}
      />
      <Stat
        label="Meilleur écart"
        value={stats.bestDeal === null ? "—" : percent(stats.bestDeal)}
        hint={stats.deals > 0 ? `${stats.deals} sous −15 %` : undefined}
        tone={stats.bestDeal !== null && stats.bestDeal <= -15 ? "good" : undefined}
      />
    </dl>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "new";
}) {
  const color = tone === "good" ? "text-good" : tone === "new" ? "text-new" : "text-text";
  return (
    <div className="panel px-3 py-2">
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-0.5 text-lg font-bold leading-tight ${color}`}>{value}</dd>
      {hint && <p className="text-[10px] text-faint">{hint}</p>}
    </div>
  );
}

function EmptyFeed({
  wide,
  hidden,
  onWiden,
  onlyNew,
  onShowAll,
}: {
  wide: boolean;
  hidden: number;
  onWiden: () => void;
  onlyNew: boolean;
  onShowAll: () => void;
}) {
  return (
    <div className="panel px-4 py-10 text-center text-sm text-dim">
      {onlyNew ? (
        <>
          <p>Aucune annonce nouvelle depuis votre dernier passage.</p>
          <button type="button" onClick={onShowAll} className="control mt-3">
            Voir toutes les annonces
          </button>
        </>
      ) : !wide && hidden > 0 ? (
        <>
          <p>Aucune annonce ne cite à la fois le nom et le numéro (ou l’extension) de vos cartes.</p>
          <button type="button" onClick={onWiden} className="control mt-3">
            Voir les {hidden} correspondances plus larges
          </button>
        </>
      ) : (
        <p>Aucune annonce Vinted ni eBay pour vos cartes en ce moment. Réessayez plus tard.</p>
      )}
    </div>
  );
}
