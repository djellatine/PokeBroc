/**
 * Client TCGdex (base de données de cartes TCG, disponible en français).
 * Docs : https://tcgdex.dev
 *
 * Deux bases sont lues : la française, qui est la maison, et la japonaise,
 * pour les cartes qui n'existent que là-bas — promos McDonald's, campagnes
 * Pokémon Center, extensions jamais traduites. Une carte japonaise se
 * reconnaît à son identifiant, préfixé `ja:` (« ja:SV-P-001 ») : c'est ce
 * préfixe qui dit à `getCard` quelle base interroger, et il suit la carte
 * partout — favoris, instantanés, adresses de page — sans qu'aucun autre
 * module ait à porter une langue. Il évite au passage une collision réelle :
 * les identifiants japonais (« SV8a ») ne se distinguent des français
 * (« sv8a ») que par la casse, que Windows ignore dans les noms de fichiers.
 */

const API = "https://api.tcgdex.net/v2";

type Lang = "fr" | "en" | "ja";

export const JA_PREFIX = "ja:";

/** Carte de la base japonaise, d'après son identifiant. */
export function isJapaneseId(cardId: string): boolean {
  return cardId.startsWith(JA_PREFIX);
}

/** Langue et identifiant tels que TCGdex les attend. */
function locate(cardId: string): { lang: Lang; id: string } {
  return isJapaneseId(cardId)
    ? { lang: "ja", id: cardId.slice(JA_PREFIX.length) }
    : { lang: "fr", id: cardId };
}

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
  /**
   * Carte de la base japonaise. Absent pour une carte française : le champ
   * n'existe que là où il change quelque chose — la notation, les requêtes,
   * la pastille dans le fil.
   */
  lang?: "ja";
  /** Nom imprimé, en japonais ; `name` porte alors la traduction française. */
  nameJa?: string;
  /** Nom anglais, que certains vendeurs préfèrent : « Leafeon ex ». */
  nameEn?: string;
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

/**
 * Numéro imprimé sur la carte, ex. "4/102".
 *
 * Les promos japonaises n'ont pas de total : elles s'impriment « 001/SV-P »,
 * le code de l'extension en guise de dénominateur, et c'est ainsi que les
 * vendeurs les écrivent. TCGdex publie un `official` à zéro pour ces sets.
 */
export function cardNumber(card: CardDetail): string | null {
  if (!card.localId) return null;
  const total = card.set?.cardCount?.official;
  if (total) return `${card.localId}/${total}`;
  if (card.lang === "ja" && card.set?.id) return `${card.localId}/${card.set.id}`;
  return card.localId;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .trim();
}

/**
 * Classe les résultats : correspondance exacte, puis début de nom, puis le reste.
 * Les cartes sans visuel passent en dernier (elles sont inexploitables dans une grille).
 */
function rank<T extends CardBrief>(cards: T[], query: string): T[] {
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

async function tcgdex<T>(path: string, revalidate = 3600, lang: Lang = "fr"): Promise<T> {
  const res = await fetch(`${API}/${lang}${path}`, {
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
  lang?: "ja";
  nameJa?: string;
}

/** L'identifiant d'une carte est de la forme `{setId}-{localId}`. */
function setIdOf(cardId: string): string | null {
  const cut = cardId.lastIndexOf("-");
  return cut > 0 ? cardId.slice(0, cut) : null;
}

const setsIndex = new Map<Lang, { at: number; value: Map<string, string> }>();

/** Table setId → nom d'extension, pour distinguer les rééditions d'une même carte. */
async function getSetsIndex(lang: Lang = "fr"): Promise<Map<string, string>> {
  const cached = setsIndex.get(lang);
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000) return cached.value;
  try {
    const sets = await tcgdex<{ id: string; name: string }[]>("/sets", 86400, lang);
    const map = new Map(sets.map((set) => [set.id, set.name]));
    setsIndex.set(lang, { at: Date.now(), value: map });
    return map;
  } catch {
    return cached?.value ?? new Map();
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

async function fetchByName(name: string, lang: Lang = "fr"): Promise<CardBrief[]> {
  try {
    return await tcgdex<CardBrief[]>(
      `/cards?name=${encodeURIComponent(name)}&pagination:page=1&pagination:itemsPerPage=250`,
      3600,
      lang,
    );
  } catch {
    return [];
  }
}

/**
 * Recherche de cartes par nom (partielle, insensible à la casse et aux accents).
 *
 * `lang: "ja"` interroge la base japonaise à partir d'une saisie française :
 * voir `searchJapanese`.
 */
export async function searchCards(
  query: string,
  limit = 60,
  lang: "fr" | "ja" = "fr",
): Promise<CardListItem[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (lang === "ja") return searchJapanese(q, limit);

  const [direct, sets] = await Promise.all([fetchByName(q), getSetsIndex()]);

  let cards = direct;
  // La saisie porte déjà des accents : inutile d'en tester d'autres.
  const hasAccents = normalize(q) !== q.toLowerCase();

  if (direct.length < VARIANT_THRESHOLD && !hasAccents) {
    const variants = accentVariants(q);
    if (variants.length > 0) {
      const extra = (await Promise.all(variants.map((name) => fetchByName(name)))).flat();
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

/* -------------------------------------------------------------- japonais */

/**
 * Nom d'extension tel que le site l'affiche pour une carte japonaise.
 *
 * Le code passe devant le nom : « SV-P · スカーレット&バイオレット プロモカード ».
 * C'est le code que les vendeurs écrivent — « 001/SV-P » — et le seul mot de
 * l'extension qu'un lecteur français retrouvera dans une annonce.
 */
function japaneseSetName(setId: string, name: string | undefined): string {
  return name ? `${setId} · ${name}` : setId;
}

/**
 * Recherche dans la base japonaise, depuis une saisie française.
 *
 * TCGdex ne connaît que les katakanas : « pikachu » ne trouve rien côté `ja`.
 * La saisie est donc traduite en noms d'espèces japonais, chacun interrogé,
 * puis les résultats sont retraduits pour l'affichage. Une saisie déjà en
 * japonais part telle quelle — utile pour les cartes Dresseur, hors table.
 */
async function searchJapanese(q: string, limit: number): Promise<CardListItem[]> {
  const { japaneseCandidates, translateJapaneseName } = await import("./japanese");
  const candidates = japaneseCandidates(q);
  if (candidates.length === 0) return [];

  const [lists, sets] = await Promise.all([
    Promise.all(candidates.map((name) => fetchByName(name, "ja"))),
    getSetsIndex("ja"),
  ]);

  const byId = new Map<string, CardBrief>();
  for (const card of lists.flat()) byId.set(card.id, card);

  const cards: CardListItem[] = [...byId.values()].map((card) => {
    const setId = setIdOf(card.id);
    return {
      ...card,
      id: JA_PREFIX + card.id,
      name: translateJapaneseName(card.name).name,
      nameJa: card.name,
      lang: "ja",
      setId,
      setName: setId ? japaneseSetName(setId, sets.get(setId)) : null,
    };
  });

  return rank(cards, q).slice(0, limit);
}

/** Détail complet d'une carte (set, rareté, cote Cardmarket…). */
export async function getCard(cardId: string): Promise<CardDetail | null> {
  const { lang, id } = locate(cardId);
  try {
    const card = await tcgdex<CardDetail>(`/cards/${encodeURIComponent(id)}`, 3600, lang);
    return lang === "ja" ? japaneseCard(card) : card;
  } catch {
    return null;
  }
}

/** Carte japonaise telle que le reste du site la lit : nom français, préfixe, code du set. */
async function japaneseCard(raw: CardDetail): Promise<CardDetail> {
  const { translateJapaneseName } = await import("./japanese");
  const { name, nameEn } = translateJapaneseName(raw.name);
  return {
    ...raw,
    id: JA_PREFIX + raw.id,
    lang: "ja",
    name,
    nameJa: raw.name,
    ...(nameEn ? { nameEn } : {}),
    ...(raw.set ? { set: { ...raw.set, name: japaneseSetName(raw.set.id, raw.set.name) } } : {}),
  };
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
 *
 * Pas de repli pour une carte japonaise : elle n'a d'équivalent dans aucune
 * autre base, c'est précisément pour cela qu'on la suit.
 */
export async function resolveCardImage(
  cardId: string,
): Promise<{ image: string; lang: "fr" | "en" | "ja" } | null> {
  const found = await getCard(cardId);
  if (found?.image) return { image: found.image, lang: found.lang ?? "fr" };
  if (isJapaneseId(cardId)) return null;

  try {
    const res = await fetch(`${API}/en/cards/${encodeURIComponent(cardId)}`, {
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
