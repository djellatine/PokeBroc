"use client";

import { useFrenchOnly } from "@/components/useFrenchOnly";

/**
 * Bascule « annonces en français », dans l'en-tête.
 *
 * Drapeau dessiné plutôt qu'emoji : Windows ne rend pas les drapeaux du jeu
 * Unicode et afficherait les deux lettres « FR » dans un cadre, ce qui n'est
 * pas le repère qu'on cherche ici. Trois rectangles coûtent moins cher qu'une
 * dépendance d'icônes.
 *
 * Éteint, le drapeau est désaturé : l'état du filtre se lit alors sans avoir à
 * comparer deux bordures.
 */
export default function FrenchOnlyFlag() {
  const [frenchOnly, setFrenchOnly] = useFrenchOnly();

  return (
    <button
      type="button"
      aria-pressed={frenchOnly}
      aria-label="N’afficher que les annonces en français"
      title={
        frenchOnly
          ? "Annonces en français uniquement — cliquez pour rouvrir à toutes les langues"
          : "N’afficher que les annonces en français"
      }
      onClick={() => setFrenchOnly(!frenchOnly)}
      className="control shrink-0"
    >
      <svg
        viewBox="0 0 9 6"
        aria-hidden
        className={`h-3.5 w-[1.3rem] rounded-[2px] transition ${
          frenchOnly ? "" : "opacity-50 saturate-0"
        }`}
      >
        <rect width="3" height="6" fill="#0055a4" />
        <rect x="3" width="3" height="6" fill="#f5f5f5" />
        <rect x="6" width="3" height="6" fill="#ef4135" />
      </svg>
    </button>
  );
}
