/**
 * Les dernières offres Cardmarket, pour que la colonne se rafraîchisse seule.
 *
 * Le collecteur pilote un navigateur : cocher « reverse » ou attendre la
 * minuterie prend une quinzaine de secondes, pendant lesquelles la colonne
 * montrerait encore l'ancien relevé. Plutôt que d'obliger à recharger la page,
 * le navigateur interroge cette route à intervalle et remplace la liste dès que
 * le relevé change. Aucune collecte ici : on ne fait que relire le disque.
 */

import { getCurrentUser } from "@/lib/auth";
import { cardmarketWarning, recentCardmarketOffers } from "@/lib/cardmarket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Connectez-vous." }, { status: 401 });
  }

  const hiddenIds = new Set(Object.keys(user.hidden ?? {}));
  const [offers, warning] = await Promise.all([
    recentCardmarketOffers(user.favorites, hiddenIds),
    cardmarketWarning(user.favorites),
  ]);

  return Response.json({ offers, warning });
}
