"use client";

import { useState, useTransition } from "react";
import { hideOffer, unhideAllOffers, unhideOffer } from "@/app/actions/feed";

/**
 * Les annonces écartées du fil à la main.
 *
 * L'état vit ici plutôt que dans les propriétés du serveur, et c'est tout
 * l'intérêt : la ligne doit disparaître au clic, pas au retour de l'écriture.
 * Attendre l'aller-retour se verrait — c'est un fil qu'on balaie, et une croix
 * qui met trois cents millisecondes à répondre invite à cliquer deux fois.
 *
 * Le serveur reste la source de vérité au chargement suivant, `initial` venant
 * de `users.json`. En cas d'échec d'écriture, l'annonce revient d'où elle
 * était, accompagnée du message qui dit pourquoi : la faire disparaître sans
 * rien enregistrer serait le seul cas vraiment fautif, puisqu'elle
 * réapparaîtrait au rechargement sans qu'on sache pourquoi.
 *
 * Partagé par le fil des cartes et par les lots : mêmes identifiants, même
 * geste, même stockage — voir `app/actions/feed.ts`.
 */
export interface Hidden {
  /** Identifiants masqués. À passer aux dépendances des `useMemo` de filtrage. */
  ids: ReadonlySet<string>;
  hide: (itemId: string) => void;
  restore: (itemId: string) => void;
  restoreAll: () => void;
  /** Dernière annonce masquée, pour le « Annuler » — `null` avant tout geste. */
  last: string | null;
  error: string | null;
}

export function useHidden(initial: string[]): Hidden {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set(initial));
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function apply(next: ReadonlySet<string>, write: () => Promise<{ ok: boolean; error?: string }>) {
    const previous = ids;
    setIds(next);
    setError(null);

    startTransition(async () => {
      const result = await write();
      if (result.ok) return;
      // Rétabli tel quel : l'utilisateur retrouve son fil dans l'état où il
      // l'avait laissé, et le message explique la marche arrière.
      setIds(previous);
      setError(result.error ?? "Modification impossible pour le moment.");
    });
  }

  return {
    ids,
    last,
    error,

    hide(itemId) {
      setLast(itemId);
      apply(new Set(ids).add(itemId), () => hideOffer(itemId));
    },

    restore(itemId) {
      const next = new Set(ids);
      next.delete(itemId);
      // Le « Annuler » ne vise plus rien une fois son annonce rendue.
      setLast((current) => (current === itemId ? null : current));
      apply(next, () => unhideOffer(itemId));
    },

    restoreAll() {
      setLast(null);
      apply(new Set(), () => unhideAllOffers());
    },
  };
}
