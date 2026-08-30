"use client";

/**
 * Le petit « × » posé au coin d'une annonce, qui l'écarte du fil.
 *
 * Un seul bouton pour les quatre affichages — fil et lots, ligne et vignette :
 * c'est le geste qui doit se reconnaître d'un fil à l'autre, pas la mise en
 * page. Seules la taille et la position changent, d'où le `className`.
 *
 * `reveal-on-hover` l'efface tant qu'on ne survole pas l'annonce, et le laisse
 * visible là où il n'y a pas de survol. Deux cents croix affichées en
 * permanence désigneraient le masquage comme l'action principale de la page,
 * alors que l'action principale reste d'ouvrir l'annonce.
 *
 * Même forme que la croix du bandeau de collection (`CollectionStrip`) : les
 * deux retirent quelque chose de la vue, et deux dessins pour un même geste se
 * seraient appris deux fois.
 */
export default function HideButton({
  onClick,
  label = "Masquer cette annonce",
  className,
}: {
  onClick: () => void;
  /** Reformulé pour les lots, qui ne sont pas des annonces de carte. */
  label?: string;
  /** Position et taille, imposées par l'affichage qui l'accueille. */
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`reveal-on-hover z-10 grid place-items-center rounded-full border border-line-strong bg-panel-3 leading-none text-dim transition hover:border-bad hover:text-bad ${className}`}
    >
      ×
    </button>
  );
}
