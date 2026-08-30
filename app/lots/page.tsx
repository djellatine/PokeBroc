import type { Metadata } from "next";
import Lots from "@/components/Lots";
import { requireUser } from "@/lib/auth";
import { readLotsView } from "@/lib/lots";

export const metadata: Metadata = {
  title: "Lots",
  description:
    "Les lots de cartes Pokémon qui viennent d’être mis en ligne sur Vinted, eBay et leboncoin.",
};

/**
 * Le versant « lots » du site, atteint par la bascule de l'en-tête.
 *
 * Comme la page d'accueil, elle part de ce qui est sur le disque et n'interroge
 * aucun catalogue : `Lots` ne rattrape l'instantané que s'il est périmé, une
 * fois monté. La différence est qu'ici le rattrapage est certain — on n'arrive
 * sur cette page qu'en la demandant, alors que la section repliée d'autrefois
 * aurait dépensé des recherches pour un bloc que personne ne dépliait.
 *
 * `requireUser` sans lire les favoris : la page ne dépend d'aucune carte suivie
 * et vaut donc d'être servie à tout compte, même neuf. Le contrôle reste, parce
 * que le montage déclenche une collecte — c'est lui qui empêche la page de
 * piloter des recherches sur les catalogues pour un visiteur anonyme. Le compte
 * sert au passage à retrouver les annonces masquées, qui sont les mêmes des deux
 * côtés du site.
 */
export default async function LotsPage() {
  const user = await requireUser();
  const view = await readLotsView();

  return (
    <Lots
      initialRecent={view.recent}
      recentIsStale={view.recentIsStale}
      initialHidden={Object.keys(user.hidden ?? {})}
      serverNow={view.now}
    />
  );
}
