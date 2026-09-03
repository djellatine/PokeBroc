"use client";

import Link from "next/link";
import HideButton from "@/components/HideButton";
import {
  deviationStyle,
  feesLabel,
  JapaneseChip,
  postedHint,
  SourceChip,
} from "@/components/OfferRow";
import { CONDITION_LABELS } from "@/lib/match";
import { age, countdown, euro, percent, plural } from "@/lib/format";
import type { FeedCard, FeedItem } from "@/lib/feed";

/**
 * Une annonce du fil, en vignette.
 *
 * Le pendant d'`OfferRow` : mêmes données, autre question. La ligne sert à
 * comparer des prix ; la vignette sert à juger un état, un centrage, une photo
 * floue — ce que la miniature de 3 rem d'une ligne ne permet pas.
 *
 * D'où l'ordre inversé : la photo prend toute la largeur, et les deux chiffres
 * qui décident du clic (le prix, l'écart à la cote) se posent dessus plutôt que
 * de la repousser plus bas. Le reste — état, cote, ancienneté — descend en
 * pied de vignette, à lire seulement une fois la photo retenue.
 */

/** Étiquette posée sur la photo : elle doit tenir sur n'importe quel fond. */
const OVERLAY = "rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide backdrop-blur";

export default function OfferTile({
  item,
  card,
  isNew,
  now,
  onHide,
}: {
  item: FeedItem;
  card: FeedCard;
  isNew: boolean;
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
      <div className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-panel transition hover:border-line-strong">
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
            <img
              src={item.thumbnail}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="grid h-full place-items-center text-[10px] text-faint">sans photo</span>
          )}

          <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
            {isNew && <span className={`${OVERLAY} bg-new/90 text-white`}>nouveau</span>}
            {item.graded && <span className={`${OVERLAY} bg-black/65 text-sky-300`}>gradée</span>}
            {item.bulk && <span className={`${OVERLAY} bg-black/65 text-dim`}>lot</span>}
          </span>

          {item.vsMarket !== null && (
            <span
              className={`absolute bottom-1.5 right-1.5 rounded border px-1.5 py-0.5 text-[11px] font-bold backdrop-blur ${deviationStyle(item.vsMarket)}`}
              title="Écart avec la tendance Cardmarket"
            >
              {percent(item.vsMarket)}
            </span>
          )}
        </a>

        {/* Frère du lien et non son enfant : un bouton ne s'imbrique pas dans
            une ancre. Posé en haut à droite, le seul coin de la photo que les
            étiquettes et l'écart à la cote laissent libre. */}
        <HideButton onClick={onHide} className="absolute right-1.5 top-1.5 h-6 w-6 text-sm" />

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
              deux lignes décalent la carte suivie d'une vignette à l'autre. */}
          <Link
            href={`/carte/${encodeURIComponent(card.cardId)}`}
            className="mt-auto truncate pt-1 text-[11px] font-semibold text-accent transition hover:underline"
          >
            {card.name}
            {card.localId && <span className="font-normal opacity-70"> n°{card.localId}</span>}
          </Link>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-faint">
            <JapaneseChip cardId={card.cardId} />
            <SourceChip source={item.source} />
            {item.condition && <span>{CONDITION_LABELS[item.condition]}</span>}
            {item.trend !== null && (
              <span title="Tendance Cardmarket pour la version standard">
                cote {euro(item.trend)}
              </span>
            )}
            {posted && <span title={postedHint(item.source)}>{posted}</span>}
            {item.auction && (
              <span title="Enchère en cours : le prix affiché n’est pas un prix demandé, et n’est donc pas comparé à la cote.">
                enchère · {plural(item.bids, "offre")}
                {remaining && ` · ${remaining}`}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
