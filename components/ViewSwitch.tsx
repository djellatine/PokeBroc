"use client";

import { usePersisted } from "@/components/usePersisted";

/**
 * Liste ou grille, et la préférence qui va avec — partagées par les deux fils.
 *
 * Une seule clé pour le fil des cartes et pour les lots : c'est une préférence
 * sur la *forme* des annonces, pas sur leur contenu. Quelqu'un qui veut voir les
 * photos en grand le veut des deux côtés, et deux réglages homonymes à régler
 * séparément se seraient surtout fait oublier l'un des deux.
 */

export type View = "list" | "grid";

const VIEWS: { value: View; label: string; hint: string }[] = [
  { value: "list", label: "Liste", hint: "Une annonce par ligne, prix alignés" },
  { value: "grid", label: "Grille", hint: "Vignettes : les photos en grand" },
];

/**
 * L'affichage est rangé à part des filtres, et pas seulement par propreté : les
 * filtres sont une dépendance du calcul du fil, alors que la forme des lignes
 * n'y change rien. Mélangés, chaque bascule Liste/Grille retrierait deux cents
 * annonces pour rien.
 */
const DEFAULT_DISPLAY: { view: View } = { view: "list" };

const DISPLAY_KEY = "pokebroc:affichage";

/** Conteneur du fil et hauteur des squelettes, selon l'affichage retenu. */
export const LAYOUT: Record<View, { list: string; skeleton: string }> = {
  list: { list: "flex flex-col gap-2", skeleton: "h-[4.75rem]" },
  grid: {
    list: "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
    skeleton: "h-72",
  },
};

/** L'affichage courant, normalisé, et de quoi en changer. */
export function useView(): [View, (view: View) => void] {
  const [display, updateDisplay] = usePersisted(DISPLAY_KEY, DEFAULT_DISPLAY);

  // Normalisé plutôt que lu tel quel : la valeur vient de `localStorage`, et une
  // clé inconnue ferait tomber l'indexation de `LAYOUT` sur `undefined`.
  const view: View = display.view === "grid" ? "grid" : "list";

  return [view, (next) => updateDisplay({ view: next })];
}

/**
 * Bascule d'affichage. Les deux libellés restent visibles plutôt qu'un bouton
 * unique qui changerait de nom : ici l'état courant se lit sans avoir à deviner
 * si l'étiquette décrit ce qu'on voit ou ce qu'on obtiendra en cliquant.
 */
export default function ViewSwitch({
  value,
  onChange,
  label = "Affichage des annonces",
}: {
  value: View;
  onChange: (view: View) => void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-8 items-center gap-0.5 rounded-lg border border-line bg-panel-2 p-0.5"
    >
      {VIEWS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={option.hint}
            className={`rounded-md px-2.5 py-1 text-[13px] leading-none transition ${
              active ? "bg-accent/15 font-medium text-accent" : "text-faint hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
