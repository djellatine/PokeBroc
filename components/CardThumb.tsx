"use client";

import { useEffect, useState } from "react";
import { cachedCardImage, directCardImage } from "@/lib/tcgdex";

/**
 * Visuel d'une carte, adossé à un fond qui porte déjà son nom.
 *
 * L'image vient d'abord du CDN, directement (voir `directCardImage`). S'il
 * échoue ou traîne, on passe par le cache serveur.
 *
 * Le CDN TCGdex a mis par moments 15 à 25 s à livrer un fichier de 18 Ko. Le cache
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

/**
 * Temps laissé au CDN avant de basculer sur le proxy. Il répond d'ordinaire en
 * 0,1 à 0,3 s, directement au navigateur, sans charger la tablette.
 */
const DIRECT_BUDGET_MS = 4_000;

export default function CardThumb({
  image,
  name,
  cardId,
  quality = "low",
  className = "relative h-full w-full object-cover",
  lazy = false,
}: {
  image: string | null | undefined;
  name: string;
  /** Permet au serveur de chercher un visuel quand la base française n'en a pas. */
  cardId?: string;
  quality?: "low" | "high";
  className?: string;
  /** Vignette hors écran d'une longue liste : ne la charger qu'en approchant. */
  lazy?: boolean;
}) {
  const src =
    cachedCardImage(image ?? undefined, quality) ??
    (cardId ? `/api/carte-image?cardId=${encodeURIComponent(cardId)}&q=${quality}` : null);
  const direct = directCardImage(image ?? undefined, quality);

  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  /** Le CDN a échoué ou traîné : on passe par le cache du serveur. */
  const [viaProxy, setViaProxy] = useState(!direct);
  const [loaded, setLoaded] = useState(false);

  // Nouvelle carte affichée : on repart d'une tentative neuve.
  const [seenSrc, setSeenSrc] = useState(src);
  if (seenSrc !== src) {
    setSeenSrc(src);
    setAttempt(0);
    setFailed(false);
    setViaProxy(!direct);
    setLoaded(false);
  }

  // Le CDN a ses mauvaises passes (15 à 25 s par fichier, vu en septembre) :
  // passé ce délai, le proxy, que la recherche a déjà préchauffé, prend le relais.
  useEffect(() => {
    if (viaProxy || loaded) return;
    const timer = setTimeout(() => setViaProxy(true), DIRECT_BUDGET_MS);
    return () => clearTimeout(timer);
  }, [viaProxy, loaded, seenSrc]);

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
          src={!viaProxy && direct ? direct : attempt === 0 ? src! : `${src}&essai=${attempt}`}
          alt={name}
          // Pas de différé par défaut : les vignettes de l'aperçu sont déjà
          // visibles, et il retardait d'autant le seul appel qui compte, celui
          // qui déclenche le téléchargement côté serveur. Différé seulement pour
          // la longue liste d'un nom très imprimé, une fois tout affiché.
          loading={lazy ? "lazy" : undefined}
          // Une image déjà en cache peut avoir fini avant l'hydratation, sans
          // jamais déclencher `onLoad` : on regarde au montage.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0 && !loaded) setLoaded(true);
          }}
          onLoad={() => setLoaded(true)}
          onError={() => (viaProxy ? setFailed(true) : setViaProxy(true))}
          className={className}
        />
      )}
    </div>
  );
}
