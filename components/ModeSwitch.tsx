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
    label: "Mes lots",
    hint: "Les lots Pokémon : les derniers mis en ligne, et ceux qui citent vos cartes",
  },
];

export default function ModeSwitch() {
  const pathname = usePathname();

  // Une fiche carte appartient au versant « cartes » : `startsWith` plutôt
  // qu'une égalité, sans quoi aucun des deux boutons ne serait actif sur
  // `/carte/pl3-143` et la bascule paraîtrait éteinte.
  const onLots = pathname.startsWith("/lots");

  return (
    <nav
      aria-label="Cartes ou lots"
      className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-line bg-panel-2 p-0.5"
    >
      {MODES.map((mode) => {
        const active = mode.href === "/lots" ? onLots : !onLots;
        return (
          <Link
            key={mode.href}
            href={mode.href}
            title={mode.hint}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 text-[13px] leading-none transition ${
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
