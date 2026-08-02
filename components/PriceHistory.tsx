import { euro, percent, plural } from "@/lib/format";
import type { PriceStats } from "@/lib/sightings";

/**
 * Prix réellement demandés sur Vinted, par opposition à la cote.
 *
 * Cardmarket publie une tendance européenne, tous vendeurs et tous états
 * confondus. Ce panneau montre autre chose : ce que les vendeurs Vinted
 * demandent effectivement pour cette carte, mesuré sur les annonces que le site
 * a croisées. C'est la seule donnée ici qu'aucune autre source ne fournit — et
 * elle se construit toute seule, à mesure que le fil tourne.
 */
export default function PriceHistory({
  stats,
  trend,
}: {
  stats: PriceStats;
  trend: number | null;
}) {
  if (stats.count === 0) {
    return (
      <div className="panel p-3.5">
        <h2 className="eyebrow">Prix observés sur Vinted</h2>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          Pas encore assez d’annonces croisées pour cette carte. Les statistiques se remplissent
          d’elles-mêmes à mesure que le fil la suit.
        </p>
      </div>
    );
  }

  // L'écart médian vaut mieux qu'une moyenne : quelques annonces gradées ou
  // fantaisistes suffiraient à déplacer une moyenne de plusieurs dizaines de %.
  const gap =
    trend && trend > 0 && stats.median !== null
      ? Math.round(((stats.median - trend) / trend) * 100)
      : null;

  return (
    <div className="panel p-3.5">
      <h2 className="eyebrow">Prix observés sur Vinted · {stats.days} j</h2>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-bold">{euro(stats.median)}</span>
        <span className="text-[11px] text-faint">médiane</span>
        {gap !== null && (
          <span
            className={`ml-auto text-xs font-semibold ${gap <= 0 ? "text-good" : "text-bad"}`}
            title="Écart entre la médiane Vinted et la tendance Cardmarket"
          >
            {percent(gap)} vs cote
          </span>
        )}
      </div>

      <p className="mt-1 text-[11px] text-dim">
        {euro(stats.min)} – {euro(stats.max)} · {plural(stats.count, "annonce")} retenue
        {stats.count > 1 ? "s" : ""}
      </p>

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        Prix total, frais inclus, des seules annonces citant le nom et le numéro ou l’extension.
        C’est un prix demandé, pas un prix de vente.
      </p>
    </div>
  );
}
