import type { Metadata } from "next";
import Lots from "@/components/Lots";
import { requireUser } from "@/lib/auth";
import { readLotsView } from "@/lib/lots";

export const metadata: Metadata = {
  title: "Mes lots",
  description:
    "Les lots de cartes Pokémon qui viennent d’être mis en ligne sur Vinted et eBay, et ceux dont le titre cite une carte de votre collection.",
};

/**
 * Le versant « lots » du site, atteint par la bascule de l'en-tête.
 *
 * Comme la page d'accueil, elle part de ce qui est sur le disque et n'interroge
 * aucun catalogue : `Lots` ne rattrape que les instantanés périmés, une fois
 * monté. La différence est qu'ici le rattrapage est certain — on n'arrive sur
 * cette page qu'en la demandant, alors que la section repliée d'autrefois
 * aurait dépensé des recherches pour un bloc que personne ne dépliait.
 *
 * `requireUser` et non `getCurrentUser` : sans collection l'onglet « Ma
 * collection » est vide, mais « Récents » reste entier — il ne dépend d'aucune
 * carte suivie. La page vaut donc d'être servie à tout compte, même neuf.
 */
export default async function LotsPage() {
  const user = await requireUser();
  const view = await readLotsView(user.favorites);

  return (
    <Lots
      favorites={user.favorites}
      initialSnapshots={view.snapshots}
      initialStaleIds={view.staleIds}
      initialRecent={view.recent}
      recentIsStale={view.recentIsStale}
      serverNow={view.now}
    />
  );
}
