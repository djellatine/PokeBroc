import { NextRequest } from "next/server";
import { withFrenchQuote } from "@/lib/cardmarket";
import { getCard } from "@/lib/tcgdex";
import { bestQuery, scoreAll } from "@/lib/match";
import { searchVinted, type VintedOrder } from "@/lib/vinted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDERS: VintedOrder[] = [
  "relevance",
  "newest_first",
  "price_low_to_high",
  "price_high_to_low",
];

function number(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const requested = params.get("q")?.trim() ?? "";
  const cardId = params.get("cardId")?.trim() ?? "";

  if (!requested && !cardId) {
    return Response.json({ error: "Requête vide." }, { status: 400 });
  }

  const orderParam = params.get("order") as VintedOrder | null;
  const order = orderParam && ORDERS.includes(orderParam) ? orderParam : "relevance";

  try {
    // `cardId` sans `q` : le fil d'accueil laisse le serveur choisir la requête la
    // plus ciblée, qui dépend de données (numéro imprimé) qu'il est seul à avoir.
    const found = cardId ? await getCard(cardId) : null;
    // Même cote que le fil : la française quand le collecteur Cardmarket l'a.
    const card = found ? (await withFrenchQuote(found)).card : null;
    const query = requested || (card ? bestQuery(card) : "");

    if (!query) {
      return Response.json({ error: "Carte introuvable." }, { status: 404 });
    }

    const result = await searchVinted({
      query,
      page: Number.parseInt(params.get("page") ?? "1", 10) || 1,
      perPage: 48,
      order,
      priceFrom: number(params.get("priceFrom")),
      priceTo: number(params.get("priceTo")),
    });

    return Response.json({
      ...result,
      items: card ? scoreAll(result.items, card) : result.items,
      query,
    });
  } catch (error) {
    console.error("[api/vinted]", error);
    const message =
      error instanceof Error ? error.message : "Impossible d'interroger Vinted pour le moment.";
    return Response.json({ error: message }, { status: 502 });
  }
}
