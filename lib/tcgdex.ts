/**
 * Client TCGdex (base de données de cartes TCG, disponible en français).
 * Docs : https://tcgdex.dev
 */

const BASE = "https://api.tcgdex.net/v2/fr";
const BASE_EN = "https://api.tcgdex.net/v2/en";

export interface CardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface CardSetRef {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { official: number; total: number };
}

export interface CardMarketPricing {
  updated?: string;
  unit?: string;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  "avg-holo"?: number | null;
  "low-holo"?: number | null;
  "trend-holo"?: number | null;
}

export interface CardDetail extends CardBrief {
  category?: string;
  illustrator?: string;
  rarity?: string;
  set?: CardSetRef;
  hp?: number;
  types?: string[];
  stage?: string;
  evolveFrom?: string;
  dexId?: number[];
  variants?: Record<string, boolean>;
  pricing?: { cardmarket?: CardMarketPricing | null; tcgplayer?: unknown };
}

/** Construit l'URL d'une image TCGdex (l'API renvoie une base sans extension). */
export function cardImage(
  image: string | undefined,
  quality: "low" | "high" = "high",
  ext: "webp" | "png" = "webp",
): string | null {
  if (!image) return null;
  return `${image}/${quality}.${ext}`;
}

/**
 * Même visuel, mais servi par notre cache local (`app/api/carte-image`).
 * Le CDN TCGdex est trop lent et trop instable pour être appelé directement
 * depuis le navigateur.
 */
export function cachedCardImage(
  image: string | undefined,
  quality: "low" | "high" = "low",
): string | null {
  const src = cardImage(image, quality);
  return src ? `/api/carte-image?src=${encodeURIComponent(src)}` : null;
}

/** Numéro imprimé sur la carte, ex. "4/102". */
export function cardNumber(card: CardDetail): string | null {
  if (!card.localId) return null;
  const total = card.set?.cardCount?.official;
  return total ? `${card.localId}/${total}` : card.localId;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Classe les résultats : correspondance exacte, puis début de nom, puis le reste.
 * Les cartes sans visuel passent en dernier (elles sont inexploitables dans une grille).
 */
function rank(cards: CardBrief[], query: string): CardBrief[] {
  const q = normalize(query);
  return [...cards].sort((a, b) => {
    const na = normalize(a.name);
    const nb = normalize(b.name);
    const scoreOf = (n: string) => (n === q ? 0 : n.startsWith(q) ? 1 : 2);
    const byScore = scoreOf(na) - scoreOf(nb);
    if (byScore !== 0) return byScore;
    const byImage = Number(Boolean(b.image)) - Number(Boolean(a.image));
    if (byImage !== 0) return byImage;
    return na.localeCompare(nb);
  });
}

async function tcgdex<T>(path: string, revalidate = 3600): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate },
  });
  if (!res.ok) {
    throw new Error(`TCGdex ${res.status} sur ${path}`);
  }
  return (await res.json()) as T;
}

export interface CardListItem extends CardBrief {
  setId: string | null;
  setName: string | null;
}

/** L'identifiant d'une carte est de la forme `{setId}-{localId}`. */
function setIdOf(cardId: string): string | null {
  const cut = cardId.lastIndexOf("-");
  return cut > 0 ? cardId.slice(0, cut) : null;
}

let setsIndex: { at: number; value: Map<string, string> } | null = null;

/** Table setId → nom d'extension, pour distinguer les rééditions d'une même carte. */
async function getSetsIndex(): Promise<Map<string, string>> {
  if (setsIndex && Date.now() - setsIndex.at < 24 * 3600 * 1000) return setsIndex.value;
  try {
    const sets = await tcgdex<{ id: string; name: string }[]>("/sets", 86400);
    const map = new Map(sets.map((set) => [set.id, set.name]));
    setsIndex = { at: Date.now(), value: map };
    return map;
  } catch {
    return setsIndex?.value ?? new Map();
  }
}

/**
 * TCGdex compare les noms caractère par caractère : « evoli » ne trouve pas « Évoli ».
 * On génère donc les orthographes accentuées plausibles d'une saisie sans accents :
 * une substitution isolée (Férosinge, Léviator), plus la variante « tous les e accentués »
 * pour les noms qui en portent plusieurs (Ténéfix, Mélofée).
 */
const ACCENT_VARIANTS: Record<string, string[]> = {
  e: ["é", "è", "ê"],
  a: ["à", "â"],
  i: ["î", "ï"],
  o: ["ô"],
  u: ["ù", "û"],
  c: ["ç"],
};

const MAX_VARIANTS = 12;
/** En dessous de ce nombre de résultats, on suspecte un accent manquant. */
const VARIANT_THRESHOLD = 30;

function accentVariants(query: string): string[] {
  const lower = query.toLowerCase();
  const out = new Set<string>();

  for (let i = 0; i < lower.length; i++) {
    for (const replacement of ACCENT_VARIANTS[lower[i]] ?? []) {
      out.add(lower.slice(0, i) + replacement + lower.slice(i + 1));
    }
  }
  if (lower.includes("e")) {
    out.add(lower.replaceAll("e", "é"));
    out.add(lower.replaceAll("e", "è"));
  }

  return [...out].slice(0, MAX_VARIANTS);
}

async function fetchByName(name: string): Promise<CardBrief[]> {
  try {
    return await tcgdex<CardBrief[]>(
      `/cards?name=${encodeURIComponent(name)}&pagination:page=1&pagination:itemsPerPage=250`,
    );
  } catch {
    return [];
  }
}

/** Recherche de cartes par nom (partielle, insensible à la casse et aux accents). */
export async function searchCards(query: string, limit = 60): Promise<CardListItem[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const [direct, sets] = await Promise.all([fetchByName(q), getSetsIndex()]);

  let cards = direct;
  // La saisie porte déjà des accents : inutile d'en tester d'autres.
  const hasAccents = normalize(q) !== q.toLowerCase();

  if (direct.length < VARIANT_THRESHOLD && !hasAccents) {
    const variants = accentVariants(q);
    if (variants.length > 0) {
      const extra = (await Promise.all(variants.map(fetchByName))).flat();
      const byId = new Map(direct.map((card) => [card.id, card]));
      for (const card of extra) byId.set(card.id, card);
      // Une variante peut ramener un homonyme : on ne garde que les vraies correspondances.
      const needle = normalize(q);
      cards = [...byId.values()].filter((card) => normalize(card.name).includes(needle));
    }
  }

  return rank(cards, q)
    .slice(0, limit)
    .map((card) => {
      const setId = setIdOf(card.id);
      return { ...card, setId, setName: setId ? (sets.get(setId) ?? null) : null };
    });
}

/** Détail complet d'une carte (set, rareté, cote Cardmarket…). */
export async function getCard(id: string): Promise<CardDetail | null> {
  try {
    return await tcgdex<CardDetail>(`/cards/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/**
 * Résout le visuel d'une carte, en se rabattant sur la base anglaise.
 *
 * Environ 13 % des cartes n'ont pas d'illustration côté français (mesuré sur
 * 400 cartes), et les deux tiers d'entre elles en ont une côté anglais. C'est la
 * même illustration : seul le texte imprimé change, illisible à la taille d'une
 * vignette. Mieux vaut la montrer que laisser un cadre vide.
 *
 * Résolu à la demande, uniquement pour les cartes concernées : le faire dans la
 * recherche ajouterait un aller-retour par carte sans visuel à chaque frappe.
 */
export async function resolveCardImage(
  id: string,
): Promise<{ image: string; lang: "fr" | "en" } | null> {
  const french = await getCard(id);
  if (french?.image) return { image: french.image, lang: "fr" };

  try {
    const res = await fetch(`${BASE_EN}/cards/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const english = (await res.json()) as CardBrief;
    return english.image ? { image: english.image, lang: "en" } : null;
  } catch {
    return null;
  }
}
