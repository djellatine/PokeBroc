"use client";

import Link from "next/link";
import { feesLabel, postedHint, SourceChip } from "@/components/OfferRow";
import type { FeedCard } from "@/lib/feed";
import { age, countdown, euro, plural } from "@/lib/format";
import type { LotItem } from "@/lib/lots";
import { CONDITION_LABELS } from "@/lib/match";

/**
 * Un lot, en vignette. Le pendant de `LotRow`, comme `OfferTile` l'est
 * d'`OfferRow`.
 *
 * La photo compte davantage ici que partout ailleurs sur le site : le titre d'un
 * lot ment par omission — « Lot de 300 cartes Pokémon » ne dit rien de ce qu'il
 * y a dedans, et c'est la photo du tas qui laisse deviner l'époque, l'état, la
 * présence de holos. La miniature de 3 rem d'une ligne ne le permet pas.
 *
 * L'étiquette posée en bas de la photo est le **prix par carte**, et non l'écart
 * à la cote qu'affiche `OfferTile` : un lot n'a pas de cote, et c'est le seul
 * chiffre qui rende deux lots comparables. Il manque quand le titre n'annonce
 * aucune quantité — un lot muet ne reçoit pas de prix par carte inventé.
 */

/** Étiquette posée sur la photo : elle doit tenir sur n'importe quel fond. */
const OVERLAY = "rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide backdrop-blur";

export default function LotTile({
  item,
  card,
  now,
}: {
  item: LotItem;
  card: FeedCard | undefined;
  now: number;
}) {
  const posted = age(item.createdAt, now);
  const remaining = item.auction ? countdown(item.endsAt, now) : null;
  const total = item.totalPrice ?? item.price;
  const fees =
    item.totalPrice !== null && item.price !== null ? item.totalPrice - item.price : null;

  return (
    <li className="animate-rise">
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-panel transition hover:border-line-strong">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          aria-hidden
          className="relative block aspect-[3/4] overflow-hidden bg-panel-2"
        >
          {item.thumbnail ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={item.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full place-items-center text-[10px] text-faint">sans photo</span>
          )}

          <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
            {item.quantity !== null && (
              <span className={`${OVERLAY} bg-black/65 text-dim`}>
                {plural(item.quantity, "carte")}
              </span>
            )}
            {item.auction && <span className={`${OVERLAY} bg-black/65 text-dim`}>enchère</span>}
          </span>

          {item.perCard !== null && (
            <span
              className="absolute bottom-1.5 right-1.5 rounded border border-line bg-panel/85 px-1.5 py-0.5 text-[11px] font-bold text-dim backdrop-blur"
              title="Prix total divisé par la quantité annoncée dans le titre"
            >
              {euro(item.perCard)} / carte
            </span>
          )}
        </a>

        <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-bold leading-tight">{euro(total)}</span>
            {fees !== null && fees > 0 && (
              <span className="shrink-0 text-[10px] text-faint">
                dont {euro(fees)} {feesLabel(item.source)}
              </span>
            )}
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-xs font-medium leading-snug transition hover:text-accent"
            title={item.title}
          >
            {item.title}
          </a>

          {/* `mt-auto` colle le pied en bas : sans lui, des titres de une et de
              deux lignes décalent le pied d'une vignette à l'autre. L'onglet
              « Récents » ne part d'aucune carte, d'où la réserve vide plutôt
              qu'un lien — sans quoi ses vignettes seraient plus courtes d'une
              ligne que celles de l'autre onglet. */}
          <div className="mt-auto pt-1">
            {card && (
              <Link
                href={`/carte/${encodeURIComponent(card.cardId)}`}
                className="block truncate text-[11px] font-semibold text-accent transition hover:underline"
                title="Carte de votre collection à laquelle ce lot a été rattaché"
              >
                {card.name}
                {card.localId && <span className="font-normal opacity-70"> n°{card.localId}</span>}
              </Link>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-faint">
            <SourceChip source={item.source} />
            {item.condition && <span>{CONDITION_LABELS[item.condition]}</span>}
            {posted && <span title={postedHint(item.source)}>{posted}</span>}
            {item.favourites > 0 && <span>♥ {item.favourites}</span>}
            {item.auction && (
              <span title="Enchère en cours : le prix affiché n’est pas un prix demandé, et ne donne donc pas de prix par carte.">
                {plural(item.bids, "offre")}
                {remaining && ` · ${remaining}`}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
