"use client";

import { SEARCH_INPUT_ID } from "@/components/CardSearch";

/**
 * Renvoie vers la barre de recherche de l'en-tête.
 *
 * La recherche est unique et vit dans l'en-tête ; en dupliquer une seconde dans
 * la page ferait deux états à tenir pour un seul geste. Un bouton qui va poser
 * le curseur au bon endroit suffit, et garde la barre comme point d'entrée
 * unique de l'ajout de cartes.
 */
export default function FocusSearchButton({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const input = document.getElementById(SEARCH_INPUT_ID);
        input?.scrollIntoView({ block: "center" });
        (input as HTMLInputElement | null)?.focus();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
