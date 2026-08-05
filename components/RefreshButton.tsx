"use client";

import { FORCE_COOLDOWN_MS } from "@/lib/rate-limit";

/**
 * « Actualiser » — le seul geste du site qui interroge les catalogues sur
 * commande.
 *
 * Il existe parce que recharger la page ne suffisait pas, et que rien ne le
 * laissait deviner : tant qu'un instantané a moins de dix minutes, le serveur le
 * rend tel quel sans rien demander à Vinted. Une annonce parue entre-temps était
 * donc inaccessible, et l'utilisateur rechargeait en vain.
 *
 * Le décompte remplace le libellé pendant l'attente au lieu de simplement griser
 * le bouton : un bouton éteint sans explication se lit comme une panne, alors
 * qu'un « 24 s » dit à la fois pourquoi et jusqu'à quand. Ce décompte n'est
 * qu'un confort — la garde est tenue par les routes, qui appliquent le même
 * délai et répondent 429 à qui l'ignore.
 */
export default function RefreshButton({
  onClick,
  loading,
  cooldown,
  disabled = false,
  label = "Actualiser",
}: {
  onClick: () => void;
  /** Une collecte est en cours : le bouton se tait plutôt que d'en lancer une seconde. */
  loading: boolean;
  /** Secondes restantes, 0 quand le bouton est disponible. */
  cooldown: number;
  disabled?: boolean;
  label?: string;
}) {
  const waiting = cooldown > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading || waiting}
      aria-live="polite"
      title={
        waiting
          ? `Encore ${cooldown} s — les catalogues ne sont pas interrogés plus d’une fois par ${Math.round(FORCE_COOLDOWN_MS / 1000)} s.`
          : "Interroger les places de marché maintenant, sans attendre l’expiration de l’instantané"
      }
      className="control disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Recherche…" : waiting ? `${label} · ${cooldown} s` : label}
    </button>
  );
}
