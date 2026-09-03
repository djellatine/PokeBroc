import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CardThumb from "@/components/CardThumb";
import FavoriteButton from "@/components/FavoriteButton";
import { JapaneseChip } from "@/components/OfferRow";
import PriceHistory from "@/components/PriceHistory";
import VintedResults from "@/components/VintedResults";
import { getCurrentUser } from "@/lib/auth";
import { euro } from "@/lib/format";
import { suggestedQueries } from "@/lib/match";
import { priceStats } from "@/lib/sightings";
import { cardNumber, getCard } from "@/lib/tcgdex";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const card = await getCard(decodeURIComponent(id));
  if (!card) return { title: "Carte introuvable" };

  const printed = cardNumber(card);
  const description = `Annonces Vinted pour ${card.name}${printed ? ` (${printed})` : ""}${
    card.set?.name ? `, extension ${card.set.name}` : ""
  }, comparées à la cote Cardmarket.`;

  return {
    title: `${card.name}${printed ? ` ${printed}` : ""}`,
    description,
    openGraph: { title: `${card.name} — annonces Vinted`, description },
  };
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-right text-[13px] font-medium">{value}</dd>
    </div>
  );
}

export default async function CardPage({ params }: Params) {
  const { id } = await params;
  const cardId = decodeURIComponent(id);

  const [card, user] = await Promise.all([getCard(cardId), getCurrentUser()]);
  if (!card) notFound();

  const stats = await priceStats(card.id);
  const saved = Boolean(user?.favorites.some((favorite) => favorite.cardId === card.id));
  const market = card.pricing?.cardmarket ?? null;
  const trend = market?.trend ?? market?.avg30 ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/" className="text-[13px] text-dim transition hover:text-accent">
        ← Ma collection
      </Link>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-3">
          <FavoriteButton
            card={{
              cardId: card.id,
              name: card.name,
              image: card.image ?? null,
              localId: card.localId ?? null,
              setName: card.set?.name ?? null,
            }}
            initiallySaved={saved}
            isLoggedIn={Boolean(user)}
          />

          {/* Bornée sur petit écran : à pleine largeur, la carte occupait tout
              l'écran et repoussait la cote et les annonces hors de vue. */}
          <div className="mx-auto w-full max-w-[220px] overflow-hidden rounded-xl border border-line bg-panel sm:max-w-[280px] lg:max-w-none">
            <div className="aspect-[63/88]">
              <CardThumb
                image={card.image}
                name={card.name}
                cardId={card.id}
                quality="high"
                className="relative h-full w-full object-contain"
              />
            </div>
          </div>

          <div className="panel p-3.5">
            <h1 className="flex items-center gap-2 text-lg font-bold leading-tight">
              {card.name}
              <JapaneseChip cardId={card.id} />
            </h1>
            <dl className="mt-2.5">
              <Info label="Nom japonais" value={card.nameJa} />
              <Info label="Nom anglais" value={card.nameEn} />
              <Info label="Extension" value={card.set?.name} />
              <Info label="Numéro" value={cardNumber(card)} />
              <Info label="Rareté" value={card.rarity} />
              <Info label="Type" value={card.types?.join(", ")} />
              <Info label="PV" value={card.hp ? String(card.hp) : null} />
              <Info label="Illustrateur" value={card.illustrator} />
            </dl>
          </div>

          {market && (
            <div className="panel p-3.5">
              <h2 className="eyebrow">Cote Cardmarket</h2>
              <dl className="mt-2">
                <Info label="Tendance" value={euro(market.trend)} />
                <Info label="Moyenne 30 j" value={euro(market.avg30)} />
                <Info label="Plus bas" value={euro(market.low)} />
              </dl>
              <p className="mt-2 text-[10px] leading-relaxed text-faint">
                Référence pour la version standard. Une carte gradée ou 1st edition affichera
                normalement un écart très positif.
              </p>
            </div>
          )}

          <PriceHistory stats={stats} trend={trend} />
        </aside>

        <VintedResults card={card} suggestions={suggestedQueries(card)} />
      </div>
    </div>
  );
}
