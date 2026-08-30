"use client";

import { plural } from "@/lib/format";
import type { Hidden } from "@/components/useHidden";

/**
 * Ce que le masquage a retiré du fil, et de quoi le défaire.
 *
 * Sans cette ligne, la fonctionnalité serait un piège : une croix cliquée par
 * mégarde effacerait une annonce sans trace ni retour, et personne ne saurait
 * jamais qu'il reste des annonces derrière. Elle reprend la forme des autres
 * avis du fil — ceux du seuil de pertinence et du drapeau français — parce
 * qu'elle dit la même chose qu'eux : voilà ce que vous ne voyez pas, et voilà
 * comment le revoir.
 *
 * Le message d'erreur vit ici aussi, et volontairement hors du `count > 0` : un
 * masquage qui échoue rend l'annonce au fil, donc ramène le compte à zéro. Le
 * loger dans la ligne du décompte reviendrait à ne jamais l'afficher.
 */
export default function HiddenNotice({
  count,
  hidden,
  singular,
  pluralized,
}: {
  /** Annonces masquées effectivement présentes dans le fil courant. */
  count: number;
  hidden: Hidden;
  /** « annonce masquée » côté fil, « lot masqué » côté lots. */
  singular: string;
  pluralized: string;
}) {
  // Capturé : l'assertion de non-nullité disparaît, et la fermeture du bouton
  // ne dépend plus d'un champ que le rendu suivant peut avoir vidé.
  const last = hidden.last;

  return (
    <>
      {hidden.error && (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad"
        >
          {hidden.error}
        </p>
      )}

      {count > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
          <span>{plural(count, singular, pluralized)}</span>

          {last !== null && (
            <button
              type="button"
              onClick={() => hidden.restore(last)}
              className="text-accent transition hover:underline"
            >
              Annuler la dernière
            </button>
          )}

          <button
            type="button"
            onClick={hidden.restoreAll}
            className="text-accent transition hover:underline"
          >
            Tout réafficher
          </button>
        </p>
      )}
    </>
  );
}
