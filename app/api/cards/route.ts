import { NextRequest } from "next/server";
import { warm } from "@/lib/image-cache";
import { cardImage, resolveCardImage, searchCards } from "@/lib/tcgdex";

export const runtime = "nodejs";

/**
 * Visuels dont on lance le téléchargement dès la recherche. Correspond à ce que
 * l'aperçu montre d'emblée (`PREVIEW_LIMIT` dans `components/CardSearch.tsx`).
 */
const WARM_COUNT = 24;

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
    const shown = cards.slice(0, WARM_COUNT);
    warm(shown.map((card) => cardImage(card.image, "low")));
    // Les cartes sans visuel TCGdex — japonaises surtout, servies par TCGplayer,
    // Cardmarket ou Bulbagarden — se résolvent carte par carte, toujours sans
    // attendre : à froid elles coûtaient jusqu'à 1,2 s chacune devant
    // l'utilisateur, 0,12 s une fois en cache.
    for (const card of shown) {
      if (card.image) continue;
      void resolveCardImage(card.id)
        .then((resolved) => resolved && warm([cardImage(resolved.image, "low")]))
        .catch(() => undefined);
    }

    return Response.json({ cards, query });
  } catch (error) {
    console.error("[api/cards]", error);
    return Response.json(
      { cards: [], query, error: "La base de cartes est momentanément injoignable." },
      { status: 502 },
    );
  }
}
