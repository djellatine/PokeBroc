import { NextRequest } from "next/server";
import { warm } from "@/lib/image-cache";
import { cardImage, searchCards } from "@/lib/tcgdex";

export const runtime = "nodejs";

/**
 * Visuels dont on lance le téléchargement dès la recherche. Correspond à ce que
 * l'aperçu montre d'emblée (`PREVIEW_LIMIT` dans `components/CardSearch.tsx`).
 */
const WARM_COUNT = 18;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  // `lang=ja` : la base japonaise, depuis la même saisie française.
  const lang = request.nextUrl.searchParams.get("lang") === "ja" ? "ja" : "fr";

  if (query.length < 2) {
    return Response.json({ cards: [], query });
  }

  try {
    const cards = await searchCards(query, undefined, lang);

    // Sans attendre : le CDN travaille pendant que l'utilisateur lit les noms,
    // au lieu de démarrer seulement quand le navigateur réclame les vignettes.
    warm(cards.slice(0, WARM_COUNT).map((card) => cardImage(card.image, "low")));

    return Response.json({ cards, query });
  } catch (error) {
    console.error("[api/cards]", error);
    return Response.json(
      { cards: [], query, error: "La base de cartes est momentanément injoignable." },
      { status: 502 },
    );
  }
}
