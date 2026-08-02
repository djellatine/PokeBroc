/** Formatages partagés entre le serveur et le navigateur. */

const EURO = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

export function euro(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? EURO.format(value) : "—";
}

/** Écart en pourcentage, signe explicite. */
export function percent(value: number): string {
  return `${value > 0 ? "+" : ""}${value} %`;
}

/**
 * Ancienneté en clair. `now` est injectable pour que le rendu serveur et la
 * première passe du navigateur produisent le même texte.
 */
export function age(at: number | null | undefined, now = Date.now()): string | null {
  if (!at) return null;
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} j`;
  const months = Math.round(days / 30.5);
  if (months < 12) return `${months} mois`;
  const years = Math.round(months / 12);
  return `${years} an${years > 1 ? "s" : ""}`;
}

/** Pluriel simple : `plural(2, "carte")` → « 2 cartes ». */
export function plural(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count > 1 ? plural : singular}`;
}
