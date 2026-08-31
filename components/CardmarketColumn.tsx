"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { hideOffer } from "@/app/actions/feed";
import CardThumb from "@/components/CardThumb";
import type { CardmarketRow } from "@/lib/cardmarket";
import { age, euro, percent } from "@/lib/format";

type Sort = "recent" | "price" | "deal";

/**
 * Les états Cardmarket, avec leur couleur — du vert « Mint » au rouge « Poor »,
 * comme sur le site. On garde le sigle brut (`NM`, `LP`…), que les acheteurs
 * connaissent, plutôt que de le replier sur un libellé français plus flou.
 */
const CM_CONDITION: Record<string, { label: string; cls: string }> = {
  MT: { label: "Mint", cls: "bg-emerald-500/20 text-emerald-300" },
  NM: { label: "Near Mint", cls: "bg-green-500/20 text-green-300" },
  EX: { label: "Excellent", cls: "bg-lime-500/20 text-lime-300" },
  GD: { label: "Good", cls: "bg-yellow-500/20 text-yellow-300" },
  LP: { label: "Light Played", cls: "bg-amber-500/20 text-amber-300" },
  PL: { label: "Played", cls: "bg-orange-500/20 text-orange-300" },
  PO: { label: "Poor", cls: "bg-red-500/20 text-red-300" },
};

/**
 * La colonne Cardmarket : les dernières offres des cartes surveillées.
 *
 * Cardmarket n'a ni fil de nouveautés ni photo par offre — l'y fondre cassait la
 * grille du fil. On en fait donc un flux à part, sobre et textuel : la carte, le
 * prix, l'écart à la cote, l'état, et depuis quand on la voit.
 *
 * Le tri est laissé au lecteur : « récentes » suit la date d'ajout (le flux de
 * nouveautés), mais une carte à beaucoup d'offres noie alors les autres — d'où
 * « prix » et « écart », qui font remonter l'affaire quelle que soit la carte.
 */
export default function CardmarketColumn({
  offers,
  warning,
}: {
  offers: CardmarketRow[];
  warning: string | null;
}) {
  const [sort, setSort] = useState<Sort>("recent");

  // Le relevé du serveur au chargement (les props), puis rafraîchi tout seul :
  // cocher « reverse » lance une collecte de ~15 s (navigateur), et l'on veut
  // que la colonne se mette à jour dès qu'elle est finie, sans recharger la
  // page. Le polling ci-dessous est la seule source de mises à jour ensuite.
  const [data, setData] = useState(offers);
  const [warn, setWarn] = useState(warning);
  const [, startTransition] = useTransition();

  // Écarter une offre : elle disparaît aussitôt, et la suivante de la carte
  // prend sa place au prochain rafraîchissement (le serveur la filtre alors,
  // sous le plafond par carte). Même stockage que les masquages du fil.
  function hide(idArticle: string) {
    setData((current) => current.filter((offer) => offer.idArticle !== idArticle));
    startTransition(async () => {
      await hideOffer(`cardmarket:${idArticle}`);
    });
  }

  useEffect(() => {
    let alive = true;
    async function pull() {
      try {
        const res = await fetch("/api/cardmarket", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { offers?: CardmarketRow[]; warning?: string | null };
        if (alive && Array.isArray(body.offers)) {
          setData(body.offers);
          setWarn(body.warning ?? null);
        }
      } catch {
        /* un rafraîchissement raté n'a rien de grave : le suivant réessaiera */
      }
    }
    const timer = setInterval(pull, 12_000);
    window.addEventListener("focus", pull);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", pull);
    };
  }, []);

  const sorted = useMemo(() => {
    const rows = [...data];
    if (sort === "price") {
      rows.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    } else if (sort === "deal") {
      // L'écart le plus négatif d'abord ; sans écart en dernier.
      rows.sort((a, b) => (a.vsMarket ?? Infinity) - (b.vsMarket ?? Infinity));
    } else {
      rows.sort(
        (a, b) => b.firstSeen - a.firstSeen || Number(b.idArticle) - Number(a.idArticle),
      );
    }
    return rows;
  }, [data, sort]);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 xl:sticky xl:top-14 xl:max-h-[calc(100vh-5rem)] xl:w-80">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <span className="h-2 w-2 rounded-full bg-indigo-400" />
          Cardmarket
          {data.length > 0 && (
            <span className="text-[11px] font-normal text-faint">{data.length}</span>
          )}
        </h2>
        <Link href="/cardmarket" className="text-[11px] text-accent transition hover:underline">
          Gérer
        </Link>
      </div>

      {warn && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300"
        >
          {warn}{" "}
          <Link href="/cardmarket" className="font-semibold underline">
            Aide
          </Link>
        </p>
      )}

      {data.length === 0 ? (
        !warn && (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs leading-relaxed text-faint">
            Cochez <span className="font-bold text-accent">CM</span> sur une carte précieuse pour
            voir ici ses dernières offres Cardmarket.
          </p>
        )
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-faint">Trier</span>
            {(
              [
                ["recent", "Récentes"],
                ["price", "Prix"],
                ["deal", "Écart"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSort(value)}
                aria-pressed={sort === value}
                className={`rounded-md border px-2 py-0.5 font-medium transition ${
                  sort === value
                    ? "border-accent/70 bg-accent/15 text-accent"
                    : "border-line text-dim hover:border-line-strong"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <ul className="flex flex-col gap-1.5 overflow-y-auto pr-0.5">
            {sorted.map((offer) => (
              <li key={`${offer.cardId}:${offer.idArticle}`} className="group relative">
                <button
                  type="button"
                  onClick={() => hide(offer.idArticle)}
                  aria-label="Écarter cette offre"
                  title="Écarter cette offre"
                  className="reveal-on-hover absolute -right-1 -top-1 z-10 grid h-5 w-5 place-items-center rounded-full border border-line-strong bg-panel-3 text-xs leading-none text-dim transition hover:border-bad hover:text-bad"
                >
                  ×
                </button>
                <a
                  href={offer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-2.5 rounded-lg border border-line bg-panel p-2 transition hover:border-line-strong"
                >
                  <span className="block h-14 w-10 shrink-0 overflow-hidden rounded">
                    <CardThumb image={offer.image} name={offer.name} cardId={offer.cardId} />
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold" title={offer.name}>
                        {offer.name}
                      </span>
                      {offer.localId && (
                        <span className="shrink-0 text-[10px] text-faint">n°{offer.localId}</span>
                      )}
                    </span>

                    <span className="flex items-baseline gap-1.5">
                      <span className="text-sm font-bold">{euro(offer.price)}</span>
                      {offer.vsMarket !== null && (
                        <span
                          className={`text-[11px] font-semibold ${
                            offer.vsMarket <= -15
                              ? "text-good"
                              : offer.vsMarket <= 0
                                ? "text-dim"
                                : "text-faint"
                          }`}
                        >
                          {percent(offer.vsMarket)}
                        </span>
                      )}
                    </span>

                    <span className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-faint">
                      {offer.condition && CM_CONDITION[offer.condition] && (
                        <span
                          className={`rounded px-1 py-px text-[9px] font-bold ${CM_CONDITION[offer.condition].cls}`}
                          title={CM_CONDITION[offer.condition].label}
                        >
                          {offer.condition}
                        </span>
                      )}
                      {offer.country && <span>{offer.country}</span>}
                      {age(offer.firstSeen) && <span>· vu {age(offer.firstSeen)}</span>}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
