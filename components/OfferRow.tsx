"use client";

import Link from "next/link";
import { CONDITION_LABELS } from "@/lib/match";
import { age, euro, percent } from "@/lib/format";
import type { FeedCard, FeedItem } from "@/lib/feed";

/**
 * Une annonce du fil, en ligne plutôt qu'en vignette.
 *
 * La grille de cartes obligeait à comparer de tête des prix dispersés sur cinq
 * colonnes. En ligne, les prix et les écarts s'alignent verticalement — et
 * comme le corps du texte est en chiffres tabulaires, la colonne se lit d'un
 * seul balayage.
 */

/**
 * Trois paliers seulement. Un dégradé continu se lirait mal à cette taille, et
 * la question posée est binaire : est-ce que ça vaut le coup de cliquer ?
 */
function deviationStyle(vsMarket: number): string {
  if (vsMarket <= -15) return "border-good/40 bg-good/15 text-good";
  if (vsMarket >= 20) return "border-bad/30 bg-bad/10 text-bad";
  return "border-line bg-panel-2 text-dim";
}

export default function OfferRow({
  item,
  card,
  isNew,
  now,
}: {
  item: FeedItem;
  card: FeedCard;
  isNew: boolean;
  now: number;
}) {
  const posted = age(item.createdAt, now);
  const total = item.totalPrice ?? item.price;
  const fees =
    item.totalPrice !== null && item.price !== null ? item.totalPrice - item.price : null;

  return (
    <li className="animate-rise">
      <div className="group grid grid-cols-[2.75rem_1fr] items-start gap-3 rounded-lg border border-line bg-panel p-2 transition hover:border-line-strong sm:grid-cols-[3.25rem_1fr_auto]">
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/carte/${encodeURIComponent(card.cardId)}`}
              className="text-[11px] font-semibold text-accent transition hover:underline"
            >
              {card.name}
              {card.localId && <span className="font-normal opacity-70"> n°{card.localId}</span>}
            </Link>

            {isNew && (
              <span className="rounded bg-new/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-new">
                nouveau
              </span>
            )}
            {item.graded && <span className="chip border-sky-400/30 text-sky-300">gradée</span>}
            {item.bulk && <span className="chip">lot</span>}
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
            {item.trend !== null && (
              <span title="Tendance Cardmarket pour la version standard">
                cote {euro(item.trend)}
              </span>
            )}
            {posted && <span title="Mise en ligne (horodatage de la photo)">{posted}</span>}
            {item.favourites > 0 && <span>♥ {item.favourites}</span>}
            {item.promoted && <span>sponsorisée</span>}
          </div>
        </div>

        {/* Sur mobile, le prix passe sous le titre en occupant les deux colonnes :
            en le gardant à droite, il ne restait plus rien pour le titre. */}
        <div className="col-span-2 flex items-center justify-end gap-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start sm:gap-1">
          {item.vsMarket !== null && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${deviationStyle(item.vsMarket)}`}
              title="Écart avec la tendance Cardmarket"
            >
              {percent(item.vsMarket)}
            </span>
          )}

          <span className="text-right">
            <span className="block text-[15px] font-bold leading-tight">{euro(total)}</span>
            {fees !== null && fees > 0 && (
              <span className="block text-[10px] leading-tight text-faint">
                dont {euro(fees)} de frais
              </span>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}
