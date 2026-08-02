import type { MetadataRoute } from "next";
import { allTrackedCards } from "@/lib/store";

/**
 * TCGdex compte des dizaines de milliers de cartes : les lister toutes
 * produirait un plan de site immense dont l'essentiel ne serait jamais visité.
 * On publie donc les cartes réellement suivies — les seules dont la page a du
 * contenu vivant, puisque leur fil d'annonces est tenu à jour.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const cards = await allTrackedCards();

  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    ...cards.map((card) => ({
      url: `${base}/carte/${encodeURIComponent(card.cardId)}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
