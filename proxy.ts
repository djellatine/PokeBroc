/**
 * Limitation de débit devant les routes d'API.
 *
 * Ces routes sont ouvertes et non authentifiées : `/api/vinted` relaie vers un
 * service tiers dont la session anonyme est partagée par tout le site, et
 * `/api/cards` interroge TCGdex. Sans garde-fou, un seul script suffit à faire
 * bloquer la session Vinted, pour tout le monde.
 *
 * Les plafonds sont dimensionnés sur l'usage réel du site, pas sur une valeur
 * ronde : une frappe dans la barre de recherche déclenche déjà dix-huit
 * requêtes de visuels, avec leurs réessais.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const MINUTE = 60 * 1000;

/**
 * Plafond par minute et par adresse, du préfixe le plus spécifique au plus
 * général. Le premier préfixe qui correspond gagne.
 */
const LIMITS: { prefix: string; limit: number }[] = [
  // Un aperçu de recherche demande 18 visuels d'un coup, et chaque vignette se
  // réessaie jusqu'à quatre fois tant que le cache serveur se remplit.
  { prefix: "/api/carte-image", limit: 600 },
  { prefix: "/api/cards", limit: 120 },
  { prefix: "/api/feed", limit: 120 },
  { prefix: "/api/vinted", limit: 60 },
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rule = LIMITS.find((entry) => pathname.startsWith(entry.prefix));
  if (!rule) return NextResponse.next();

  const ip = clientIp(request.headers);
  const result = rateLimit(`${rule.prefix}:${ip}`, rule.limit, MINUTE);

  if (!result.ok) {
    return NextResponse.json(
      { error: "Trop de requêtes. Patientez quelques secondes." },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
