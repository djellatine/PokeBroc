import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Dossier de construction, `.next` sauf demande contraire.
   *
   * La tablette se met à jour toute seule (voir `deploy/tablette/lancer.sh`) :
   * elle construit la nouvelle version dans `.next-nouveau` pendant que
   * l'ancienne continue de servir depuis `.next`, puis échange les deux
   * dossiers. Sans cela, `next build` écraserait en place ce que `next start`
   * est en train de lire, un quart d'heure durant sur ce processeur.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
