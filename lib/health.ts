/**
 * Santé des places de marché, et les alertes qui en découlent.
 *
 * Pourquoi
 * --------
 * Une source en panne ne faisait rien remarquer. Le fil la note carte par
 * carte (`partial`), mais la veille ne comptait pas ces échecs : du 30
 * septembre au 1er octobre 2026, Vinted n'a rien rendu pendant un jour entier
 * et le journal disait « 68 cartes balayées, 0 alerte » à chaque passage. En
 * septembre, une semaine. Les deux fois, l'utilisateur l'a vu par hasard. Sur
 * un site qui doit tourner sans développeur, une panne qu'on ne voit pas est
 * la pire.
 *
 * La veille passe donc chaque quart d'heure l'état de chaque source à
 * `nextHealth`, qui décide quoi dire sur Discord :
 *
 * - une source en panne depuis `DOWN_AFTER_MS` → un message, avec ce qu'il
 *   faut faire ; une coupure réseau de cinq minutes ne dit rien ;
 * - toujours en panne → le même rappel une fois par jour, pas à chaque passage ;
 * - revenue après une alerte → un message pour le dire.
 *
 * Pur, sans disque ni réseau : la veille fait les lectures et l'envoi.
 */

export type HealthSource = "vinted" | "ebay" | "lbc" | "cardmarket";

export const HEALTH_NAMES: Record<HealthSource, string> = {
  vinted: "Vinted",
  ebay: "eBay",
  lbc: "leboncoin",
  cardmarket: "Cardmarket",
};

/** Ce qu'un passage a observé d'une source. `null` : rien à en dire (non configurée). */
export type Observation = { down: false } | { down: true; reason: string } | null;

export interface SourceHealth {
  /** Début de la panne en cours, en ms epoch ; `null` quand tout va bien. */
  since: number | null;
  /** Dernière alerte envoyée pour cette panne. */
  alertedAt: number | null;
  /** Dernière raison connue, pour le message. */
  reason?: string;
}

export type HealthState = Partial<Record<HealthSource, SourceHealth>>;

/** Trois passages ratés d'affilée : assez pour écarter une coupure réseau passagère. */
export const DOWN_AFTER_MS = 45 * 60 * 1000;

/** Rappel d'une panne qui dure. */
export const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;

export interface HealthNotice {
  source: HealthSource;
  kind: "down" | "still-down" | "up";
  since: number;
  reason?: string;
}

/** Nouvel état et messages à envoyer, à partir de l'état précédent et d'un passage. */
export function nextHealth(
  previous: HealthState,
  observed: Partial<Record<HealthSource, Observation>>,
  now: number,
): { state: HealthState; notices: HealthNotice[] } {
  const state: HealthState = { ...previous };
  const notices: HealthNotice[] = [];

  for (const source of Object.keys(HEALTH_NAMES) as HealthSource[]) {
    const seen = observed[source];
    if (seen === undefined || seen === null) continue;
    const before = previous[source] ?? { since: null, alertedAt: null };

    if (!seen.down) {
      if (before.since !== null && before.alertedAt !== null) {
        notices.push({ source, kind: "up", since: before.since });
      }
      state[source] = { since: null, alertedAt: null };
      continue;
    }

    const since = before.since ?? now;
    let alertedAt = before.alertedAt;
    if (alertedAt === null && now - since >= DOWN_AFTER_MS) {
      notices.push({ source, kind: "down", since, reason: seen.reason });
      alertedAt = now;
    } else if (alertedAt !== null && now - alertedAt >= REMIND_EVERY_MS) {
      notices.push({ source, kind: "still-down", since, reason: seen.reason });
      alertedAt = now;
    }
    state[source] = { since, alertedAt, reason: seen.reason };
  }

  return { state, notices };
}

/**
 * Une source interrogée carte par carte (Vinted, eBay) est en panne quand
 * elle a échoué sur au moins la moitié des cartes du passage. Une carte isolée
 * qui échoue — une requête refusée, un délai — n'est pas une panne.
 */
export function observeFromCards(failures: number, cards: number, reason: string | null): Observation {
  if (cards === 0) return null;
  return failures * 2 >= cards && failures > 0
    ? { down: true, reason: reason ?? "échecs répétés" }
    : { down: false };
}

/** Ce que l'utilisateur peut faire seul, source par source. */
const REMEDIES: Record<HealthSource, string> = {
  vinted:
    "Le site retente tout seul. Si ça dure, sur la tablette, dans Termux :\n" +
    '`proot-distro login debian -- bash -c "cd /root/PokeBroc && DISPLAY=:9 /root/venv/bin/python collect/vinted_session.py --force"`\n' +
    "« session ouverte » : c'est reparti. « ÉCHEC » : Vinted a changé quelque chose, il faut un développeur.",
  ebay:
    "Souvent le quota du jour (5 000 appels), qui revient à minuit heure du Pacifique. Si ça dure plus d'un jour, " +
    "vérifier les clés sur developer.ebay.com (« Application Keys »).",
  lbc:
    "Leboncoin (Datadome) bloque parfois quelques heures, puis laisse repasser tout seul. Si ça dure plus d'un jour : " +
    "bouton PokeBroc du widget, sur la tablette.",
  cardmarket:
    "Cloudflare, le plus souvent : la tablette coche la case toute seule et ça revient. Si ça dure : " +
    "bouton PokeBroc du widget, sur la tablette.",
};

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} jours`;
}

/** Texte Discord d'un avis. */
export function noticeText(notice: HealthNotice, now: number): string {
  const name = HEALTH_NAMES[notice.source];
  const elapsed = duration(now - notice.since);
  if (notice.kind === "up") return `✅ **${name}** refonctionne, après ${elapsed} de panne.`;
  const head =
    notice.kind === "down"
      ? `⚠️ **${name}** ne répond plus depuis ${elapsed} : ses annonces manquent au fil et aux alertes.`
      : `⚠️ Rappel : **${name}** est toujours en panne, depuis ${elapsed}.`;
  const reason = notice.reason ? `\nErreur : ${notice.reason.slice(0, 300)}` : "";
  return `${head}${reason}\n${REMEDIES[notice.source]}`;
}
