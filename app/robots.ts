import type { MetadataRoute } from "next";

/**
 * Les fiches cartes sont publiques et indexables — c'est le seul contenu du
 * site qui puisse être trouvé depuis un moteur. Tout ce qui dépend d'une
 * session est explicitement écarté : rien à y indexer, et une exploration y
 * consommerait le quota de requêtes vers Vinted.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/connexion", "/inscription"],
    },
  };
}
