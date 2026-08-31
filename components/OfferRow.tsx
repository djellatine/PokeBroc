"use client";

import Link from "next/link";
import HideButton from "@/components/HideButton";
import { CONDITION_LABELS } from "@/lib/match";
import { age, countdown, euro, percent, plural } from "@/lib/format";
import type { FeedCard, FeedItem } from "@/lib/feed";
// Depuis `lib/source` et non `lib/feed` : c'est une valeur, donc un import qui
// survit à la compilation et entraîne tout le module dans le paquet client.
import { SOURCE_NAMES, type Source } from "@/lib/source";

/**
 * Une annonce du fil, en ligne.
 *
 * C'est l'affichage par défaut, parce qu'il répond à la question du fil : où
 * est la bonne affaire ? Les prix et les écarts s'alignent verticalement, et
 * comme le corps du texte est en chiffres tabulaires, la colonne se lit d'un
 * seul balayage. `OfferTile` est l'autre moitié de la bascule, pour quand on
 * cherche un état plutôt qu'un prix : là, c'est la photo qui compte.
 */

/**
 * Trois paliers seulement. Un dégradé continu se lirait mal à cette taille, et
 * la question posée est binaire : est-ce que ça vaut le coup de cliquer ?
 *
 * Exporté : la vignette pose le même écart sur la photo, et deux échelles de
 * couleur pour une même donnée se désynchroniseraient à la première retouche.
 */
export function deviationStyle(vsMarket: number): string {
  if (vsMarket <= -15) return "border-good/40 bg-good/15 text-good";
  if (vsMarket >= 20) return "border-bad/30 bg-bad/10 text-bad";
  return "border-line bg-panel-2 text-dim";
}

/**
 * Provenance de l'annonce.
 *
 * Un point de couleur et du texte gris, plutôt qu'une pastille teintée : le
 * vert et le rouge sont réservés à l'écart à la cote, et une troisième couleur
 * pleine dans la même ligne entrerait en concurrence avec la seule information
 * qui décide du clic. La provenance se consulte, elle ne s'annonce pas — mais
 * elle doit se repérer sans lire, d'où le point.
 *
 * Exportée : la ligne et la vignette la posent toutes deux, et deux définitions
 * pour une même donnée divergeraient à la première retouche.
 */
export const SOURCE_LABELS = SOURCE_NAMES;

const SOURCE_DOTS: Record<Source, string> = {
  vinted: "bg-teal-400",
  ebay: "bg-blue-400",
  lbc: "bg-orange-400",
  cardmarket: "bg-indigo-400",
};

/**
 * Les places de marché ne datent pas leurs annonces de la même façon : eBay et
 * leboncoin publient une vraie date de mise en ligne, Vinted n'expose que
 * l'horodatage de la photo. Le libellé le dit, plutôt que d'afficher une
 * précision qu'on n'a pas.
 */
export function postedHint(source: Source): string {
  return source === "vinted" ? "Mise en ligne (horodatage de la photo)" : "Mise en ligne";
}

/**
 * Le supplément n'est pas de même nature : frais de service chez Vinted, port
 * ailleurs. Leboncoin ne chiffre ni l'un ni l'autre en recherche — le mode de
 * remise se choisit à l'achat — donc le libellé n'y sert jamais.
 */
export function feesLabel(source: Source): string {
  return source === "vinted" ? "de frais" : "de port";
}

export function SourceChip({ source }: { source: Source }) {
  return (
    <span className="chip" title={`Annonce ${SOURCE_LABELS[source]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${SOURCE_DOTS[source]}`} aria-hidden />
      {SOURCE_LABELS[source]}
    </span>
  );
}

export default function OfferRow({
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
      <div className="group grid grid-cols-[2.75rem_1fr] items-start gap-3 rounded-lg border border-line bg-panel p-2 transition hover:border-line-strong sm:grid-cols-[3.25rem_1fr_auto]">
        {/* La croix se pose au coin de la miniature, comme sur la vignette.
            Elle déborde dans l'écart des colonnes plutôt que sur la photo : à
            3 rem de large, une croix centrée dedans la recouvrirait. */}
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

          <HideButton onClick={onHide} className="absolute -right-1.5 -top-1.5 h-5 w-5 text-xs" />
        </div>

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
            <SourceChip source={item.source} />
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
            {posted && <span title={postedHint(item.source)}>{posted}</span>}
            {item.favourites > 0 && <span>♥ {item.favourites}</span>}
            {item.promoted && <span>sponsorisée</span>}
            {item.auction && (
              <span
                className="text-dim"
                title="Enchère en cours : le prix affiché n’est pas un prix demandé, et n’est donc pas comparé à la cote."
              >
                enchère · {plural(item.bids, "offre")}
                {remaining && ` · fin dans ${remaining}`}
              </span>
            )}
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
                dont {euro(fees)} {feesLabel(item.source)}
              </span>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}
