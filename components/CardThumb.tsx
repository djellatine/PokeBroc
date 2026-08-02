"use client";

import { useEffect, useState } from "react";
import { cachedCardImage } from "@/lib/tcgdex";

/**
 * Visuel d'une carte, adossé à un fond qui porte déjà son nom.
 *
 * Le CDN TCGdex met couramment 15 à 25 s à livrer un fichier de 18 Ko. Le cache
 * serveur (`app/api/carte-image`) répond donc en échec au-delà de son budget,
 * tout en poursuivant le téléchargement. C'est ici qu'on va rechercher le
 * résultat : quelques nouvelles tentatives espacées, le temps que le cache se
 * remplisse. Entre-temps la vignette reste identifiable par son nom, et une
 * carte définitivement indisponible finit sur un repli explicite.
 */

/**
 * Délais avant chaque nouvelle tentative, en millisecondes — environ deux
 * minutes en tout. Abandonner plus tôt affichait « visuel indisponible » sur des
 * cartes dont l'image finissait par arriver quelques secondes après.
 */
const RETRY_DELAYS = [2_000, 5_000, 10_000, 20_000, 40_000, 45_000];

export default function CardThumb({
  image,
  name,
  cardId,
  quality = "low",
  className = "relative h-full w-full object-cover",
}: {
  image: string | null | undefined;
  name: string;
  /** Permet au serveur de chercher un visuel quand la base française n'en a pas. */
  cardId?: string;
  quality?: "low" | "high";
  className?: string;
}) {
  const src =
    cachedCardImage(image ?? undefined, quality) ??
    (cardId ? `/api/carte-image?cardId=${encodeURIComponent(cardId)}&q=${quality}` : null);

  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  // Nouvelle carte affichée : on repart d'une tentative neuve.
  const [seenSrc, setSeenSrc] = useState(src);
  if (seenSrc !== src) {
    setSeenSrc(src);
    setAttempt(0);
    setFailed(false);
  }

  const exhausted = attempt >= RETRY_DELAYS.length;

  useEffect(() => {
    if (!failed || exhausted) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((count) => count + 1);
    }, RETRY_DELAYS[attempt]);
    return () => clearTimeout(timer);
  }, [failed, exhausted, attempt]);

  const broken = !src || (failed && exhausted);

  return (
    <div className="relative h-full w-full overflow-hidden bg-panel-2">
      <div
        className={`absolute inset-0 grid place-items-center px-1 text-center text-[9px] leading-tight text-faint ${
          broken ? "" : "skeleton"
        }`}
      >
        <span className="relative z-10">
          {name}
          {broken && <span className="mt-0.5 block opacity-70">visuel indisponible</span>}
        </span>
      </div>

      {!broken && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          // Le numéro de tentative ne sert qu'à forcer le navigateur à
          // redemander l'image ; le cache serveur ne lit que le paramètre `src`.
          src={attempt === 0 ? src : `${src}&essai=${attempt}`}
          alt={name}
          // Pas de `loading="lazy"` : les vignettes sont peu nombreuses et déjà
          // visibles, et le différé retardait d'autant le seul appel qui compte,
          // celui qui déclenche le téléchargement côté serveur.
          onError={() => setFailed(true)}
          className={className}
        />
      )}
    </div>
  );
}
