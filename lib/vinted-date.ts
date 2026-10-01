/**
 * Date de mise en ligne d'une annonce Vinted, déduite de son identifiant.
 *
 * Le nouveau catalogue (`svc-catalogue`) ne donne plus de date, sauf quand la
 * photo porte un horodatage — mesuré le 1er octobre 2026, 1 760 annonces sur
 * 2 115 sans date. Se replier sur `firstSeen` faisait passer pour neuves les
 * vieilles annonces que la collecte croisait pour la première fois : après la
 * panne du même jour, « Derniers ajouts » s'ouvrait sur des annonces de quinze
 * mois.
 *
 * Les identifiants Vinted, eux, croissent avec le temps : sur les 352 annonces
 * datées du fil, deux seulement s'écartaient de plus d'un mois de l'ordre des
 * identifiants. Une interpolation entre quelques repères date donc une annonce
 * à quelques jours près — assez pour séparer l'annonce du jour de celle de l'an
 * dernier, ce qui est tout ce que le tri demande.
 *
 * Aucun import : le module sert côté navigateur.
 */

/**
 * `[identifiant, date]`, médianes de paquets de trente annonces datées du fil
 * le 1er octobre 2026, plus l'annonce la plus récente croisée ce jour-là.
 */
const ANCHORS: readonly (readonly [number, number])[] = [
  [965315479, Date.UTC(2021, 2, 15)],
  [6186776166, Date.UTC(2025, 3, 21)],
  [8138852959, Date.UTC(2026, 1, 9)],
  [8989530374, Date.UTC(2026, 4, 23)],
  [9274260977, Date.UTC(2026, 5, 28)],
  [9391477099, Date.UTC(2026, 6, 14)],
  [9516084578, Date.UTC(2026, 6, 28)],
  [9622352626, Date.UTC(2026, 7, 10)],
  [9690737709, Date.UTC(2026, 7, 17)],
  [9754738523, Date.UTC(2026, 7, 23)],
  [9805020923, Date.UTC(2026, 7, 28)],
  [9836432921, Date.UTC(2026, 7, 30)],
  [9880869592, Date.UTC(2026, 8, 3)],
  [10207111487, Date.UTC(2026, 9, 1, 17, 48)],
];

/** Identifiant numérique d'une annonce Vinted (`vinted:123`), `null` sinon. */
export function vintedNumericId(id: string): number | null {
  const match = /^vinted:(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/**
 * Date estimée d'un identifiant, en ms epoch.
 *
 * @param latest Annonce la plus récente qu'on ait croisée, `[identifiant,
 *               firstSeen]` : un repère frais, qui empêche l'extrapolation
 *               au-delà du dernier repère écrit ici de dériver au fil des mois.
 */
export function vintedIdTime(id: number, latest: readonly [number, number] | null = null): number {
  const anchors =
    latest && latest[0] > ANCHORS[ANCHORS.length - 1][0] ? [...ANCHORS, latest] : ANCHORS;

  // Segment encadrant, ou le premier / dernier pour extrapoler aux extrémités.
  let i = 1;
  while (i < anchors.length - 1 && id > anchors[i][0]) i += 1;
  const [id0, t0] = anchors[i - 1];
  const [id1, t1] = anchors[i];
  return t0 + ((id - id0) * (t1 - t0)) / (id1 - id0);
}

/**
 * Mise en ligne d'une annonce : sa date quand la source la donne, sinon, pour
 * Vinted, l'estimation par l'identifiant — jamais postérieure au moment où
 * nous l'avons croisée, ce qui borne l'erreur d'extrapolation des annonces
 * neuves à l'écart entre deux collectes.
 */
export function postedAt(
  item: { id: string; createdAt: number | null; firstSeen: number },
  latest: readonly [number, number] | null = null,
): number {
  if (item.createdAt !== null) return item.createdAt;
  const numeric = vintedNumericId(item.id);
  if (numeric === null) return item.firstSeen;
  return Math.min(vintedIdTime(numeric, latest), item.firstSeen);
}

/** Repère frais pour `vintedIdTime` : l'annonce Vinted au plus grand identifiant. */
export function latestVinted(
  items: Iterable<{ id: string; firstSeen: number }>,
): [number, number] | null {
  let latest: [number, number] | null = null;
  for (const item of items) {
    const numeric = vintedNumericId(item.id);
    if (numeric !== null && (latest === null || numeric > latest[0])) {
      latest = [numeric, item.firstSeen];
    }
  }
  return latest;
}
