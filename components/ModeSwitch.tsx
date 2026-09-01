"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Bascule entre les deux marchandises du site, dans l'en-tête.
 *
 * Ce sont deux fils, pas deux vues d'un même fil : un lot n'a ni cote, ni écart
 * à la cote, ni prix comparable à celui d'une carte à l'unité. Les mêler dans un
 * classement reviendrait à ranger un classeur de 300 cartes à 80 € entre deux
 * Dracaufeu à 12 €.
 *
 * D'où deux routes plutôt qu'un état partagé : la page des cartes ne rend plus
 * la moindre ligne de lot, et l'inverse. Sur une collection de douze cartes, le
 * fil pesait cent trente-cinq annonces avant que la section des lots ne
 * commence — cinq écrans et demi plus bas, ce qui la rendait introuvable.
 *
 * `usePathname` plutôt qu'un `useState` : c'est le routeur qui détient l'état,
 * et lui seul survit à un rechargement, à un lien partagé et au bouton retour.
 */

const MODES = [
  {
    href: "/",
    label: "Mes cartes",
    hint: "Les annonces des cartes que vous suivez, comparées à la cote",
  },
  {
    href: "/lots",
    // « Lots » et non « Mes lots » : la page ne part d'aucune collection, et
    // c'est tout son intérêt. L'asymétrie avec « Mes cartes » est le message.
    label: "Lots",
    hint: "Tous les lots Pokémon récemment mis en ligne, sans rapport avec votre collection",
  },
];

export default function ModeSwitch() {
  const pathname = usePathname();

  // Une fiche carte appartient au versant « cartes » : `startsWith` plutôt
  // qu'une égalité, sans quoi aucun des deux boutons ne serait actif sur
  // `/carte/pl3-143` et la bascule paraîtrait éteinte.
  const onLots = pathname.startsWith("/lots");

  // La page Alertes n'est ni l'un ni l'autre : c'est un réglage, pas une
  // marchandise. Sans cette exception, « Mes cartes » s'y allumerait par
  // défaut et la bascule désignerait une page où l'on n'est pas.
  const onNeither = pathname.startsWith("/alertes");

  return (
    <nav
      aria-label="Cartes ou lots"
      className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-line bg-panel-2 p-0.5"
    >
      {MODES.map((mode) => {
        const active = onNeither ? false : mode.href === "/lots" ? onLots : !onLots;
        return (
          <Link
            key={mode.href}
            href={mode.href}
            title={mode.hint}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2 py-1 text-[13px] leading-none transition sm:px-2.5 ${
              active ? "bg-accent/15 font-medium text-accent" : "text-faint hover:text-text"
            }`}
          >
            {mode.label}
          </Link>
        );
      })}
    </nav>
  );
}
