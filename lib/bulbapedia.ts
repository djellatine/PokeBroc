/**
 * Bulbapedia comme second catalogue des cartes japonaises.
 *
 * La base japonaise de TCGdex est incomplète : 18 Salamèche quand la base
 * française en compte 46 et l'anglaise 53, et rien avant 1999 ni pour les
 * promos d'enseigne — la Salamèche McDonald's de 2002, la seule que
 * cherchait l'utilisateur, n'y est pas. Bulbapedia, lui, tient pour chaque
 * espèce la liste de *toutes* ses impressions, dans un gabarit régulier :
 *
 *     {{card list/card|cardname={{TCG ID|McDonald Pack|Charmander|4}}|…}}
 *     {{card list/release|…|jpset=McDonald's Pokémon-e Minimum Pack|jpnum=004/018}}
 *
 * et chaque carte a sa page, avec le nom japonais, le visuel et ses sorties :
 *
 *     {{PokémoncardInfobox |cardname=Charmander |jname=ヒトカゲ |image=….jpg …}}
 *     {{PokémoncardInfobox/Expansion|jpexpansion={{TCG|…}}|jpcardno=004/018}}
 *
 * Une carte venue d'ici porte l'identifiant `jb:{page}|{numéro}` — la page
 * Bulbapedia, et le numéro japonais qui distingue deux sorties d'une même
 * carte. Pas de cote : Bulbapedia ne vend rien. Le fil affiche alors les
 * annonces sans écart, et le lecteur juge.
 *
 * Tout ce qui lit du wikitexte est pur et testable ; seules `fetchWikitext`
 * et les deux fonctions exportées en fin de fichier touchent le réseau.
 */

import { frenchSpeciesName, hasJapaneseScript, speciesCandidates } from "./japanese";
import { normalize } from "./match";
import { BULBA_USER_AGENT, JB_PREFIX } from "./tcgdex";

const API = "https://bulbapedia.bulbagarden.net/w/api.php";

/** Espèces dont on lit la page par recherche : chaque page pèse 100 à 300 Ko. */
const MAX_SPECIES = 3;

/* --------------------------------------------------------- identifiants */

export interface BulbaId {
  /** Titre de la page Bulbapedia, ex. « Charmander (McDonald Pack 4) ». */
  page: string;
  /** Numéro japonais (« 004/018 ») ou, à défaut, nom de l'extension. */
  release: string | null;
}

export function bulbaId(page: string, release: string | null): string {
  return release ? `${JB_PREFIX}${page}|${release}` : `${JB_PREFIX}${page}`;
}

export function parseBulbaId(id: string): BulbaId | null {
  if (!id.startsWith(JB_PREFIX)) return null;
  const rest = id.slice(JB_PREFIX.length);
  const cut = rest.lastIndexOf("|");
  if (cut === -1) return { page: rest, release: null };
  return { page: rest.slice(0, cut), release: rest.slice(cut + 1) || null };
}

/* ------------------------------------------------------------ wikitexte */

/**
 * Paramètres d'un appel de modèle, `|clé=valeur|…`, en respectant les
 * imbrications : `jpexpansion={{TCG|McDonald's…}}` contient une barre qui
 * n'en sépare pas deux.
 */
export function templateParams(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth += 1;
      current += two;
      i += 1;
    } else if (two === "}}" || two === "]]") {
      depth -= 1;
      current += two;
      i += 1;
    } else if (body[i] === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += body[i];
    }
  }
  parts.push(current);

  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return params;
}

/** Corps d'un modèle `{{name|…}}` à partir de sa position d'ouverture. */
function templateBody(text: string, start: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === "{{") {
      depth += 1;
      i += 1;
    } else if (two === "}}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return { body: text.slice(start + 2, i - 1), end: i + 1 };
    }
  }
  return null;
}

/** Tous les appels d'un modèle donné, sous forme de paramètres. */
function templates(text: string, name: string): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  const opener = `{{${name}`;
  let from = 0;
  for (;;) {
    const at = text.indexOf(opener, from);
    if (at === -1) break;
    // « {{card list/card » ne doit pas attraper « {{card list/cardx », ni
    // « {{PokémoncardInfobox » attraper « {{PokémoncardInfobox/Expansion ».
    const next = text[at + opener.length];
    if (next !== "|" && next !== "\n" && next !== "}") {
      from = at + opener.length;
      continue;
    }
    const template = templateBody(text, at);
    if (!template) break;
    found.push(templateParams(template.body.slice(name.length)));
    from = template.end;
  }
  return found;
}

/** `{{TCG|Nom}}` → « Nom » ; `[[Page|Libellé]]` → « Libellé » ; le reste tel quel. */
export function plainText(value: string): string {
  return value
    .replace(/\{\{TCG\|([^}|]+)(?:\|[^}]*)?\}\}/g, "$1")
    .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .trim();
}

/* ------------------------------------------------------- page d'espèce */

/** Une sortie japonaise d'une carte, telle que la page d'espèce la liste. */
export interface JapaneseRelease {
  /** Page de la carte : « Charmander (McDonald Pack 4) ». */
  page: string;
  /** Nom de la carte sur la page : « Charmander », « Charmander δ ». */
  cardName: string;
  /** Extension japonaise, en anglais : « McDonald's Pokémon-e Minimum Pack ». */
  set: string;
  /** Numéro japonais imprimé, « 004/018 », ou `null` pour les anciennes cartes non numérotées. */
  number: string | null;
  rarity: string | null;
}

/**
 * Titre de la page d'une carte, d'après le paramètre `cardname` d'une ligne
 * `card list/card` : `{{TCG ID|McDonald Pack|Charmander|4}}` désigne la page
 * « Charmander (McDonald Pack 4) » ; un lien `[[Page|Libellé]]` donne la page
 * directement.
 */
export function cardPageOf(cardname: string): { page: string; name: string } | null {
  const id = /\{\{TCG ID\|([^|}]+)\|([^|}]+)\|([^|}]+)(?:\|[^}]*)?\}\}/.exec(cardname);
  if (id) {
    const [, set, name, number] = id.map((part) => part.trim());
    return { page: `${name} (${set} ${number})`, name };
  }
  const link = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(cardname);
  if (link) return { page: link[1].trim(), name: (link[2] ?? link[1]).trim() };
  return null;
}

/** Sorties japonaises listées par une page « {Espèce} (TCG) ». */
export function parseSpeciesReleases(wikitext: string): JapaneseRelease[] {
  const releases: JapaneseRelease[] = [];
  let card: { page: string; name: string } | null = null;

  // Ligne à ligne : une carte, puis ses sorties, jusqu'à la carte suivante.
  for (const line of wikitext.split("\n")) {
    if (line.startsWith("{{card list/card")) {
      const params = templateParams(line.slice("{{card list/card".length, line.lastIndexOf("}}")));
      card = params.cardname ? cardPageOf(params.cardname) : null;
      continue;
    }
    if (!card || !line.startsWith("{{card list/release")) continue;

    const params = templateParams(
      line.slice("{{card list/release".length, line.lastIndexOf("}}")),
    );
    if (!params.jpset) continue;
    releases.push({
      page: card.page,
      cardName: card.name,
      set: plainText(params.jpset),
      number: params.jpnum?.trim() || null,
      rarity: params.jprarity?.trim() || null,
    });
  }
  return releases;
}

/* ------------------------------------------------------- page de carte */

export interface BulbaCardPage {
  cardName: string;
  /** Nom japonais imprimé, ou `null` sur une page qui ne le donne pas. */
  jname: string | null;
  image: string | null;
  hp: number | null;
  type: string | null;
  illustrator: string | null;
  /** Sorties japonaises, dans l'ordre de la page. */
  releases: { set: string; number: string | null; rarity: string | null }[];
}

export function parseCardPage(wikitext: string): BulbaCardPage | null {
  const box =
    templates(wikitext, "PokémoncardInfobox")[0] ??
    templates(wikitext, "TrainercardInfobox")[0] ??
    templates(wikitext, "EnergycardInfobox")[0];
  if (!box) return null;

  const illus = /Illus\.\s*\[\[([^\]|]+)/.exec(box.caption ?? "");
  const releases = [
    ...templates(wikitext, "PokémoncardInfobox/Expansion"),
    ...templates(wikitext, "TrainercardInfobox/Expansion"),
    ...templates(wikitext, "EnergycardInfobox/Expansion"),
  ]
    .filter((params) => params.jpexpansion)
    .map((params) => ({
      set: plainText(params.jpexpansion),
      number: params.jpcardno?.trim() || null,
      rarity: params.jprarity ? plainText(params.jprarity) : null,
    }));

  return {
    cardName: plainText(box.cardname ?? ""),
    jname: box.jname?.trim() || null,
    image: box.image?.trim() || null,
    hp: box.hp && /^\d+$/.test(box.hp.trim()) ? Number(box.hp) : null,
    type: box.type?.trim() || null,
    illustrator: illus ? illus[1].trim() : null,
    releases,
  };
}

/* --------------------------------------------------------------- cartes */

/**
 * Extension telle que le site la porte : `id` sert de code dans la notation
 * quand le numéro l'emploie comme dénominateur (« 052/ADV-P »), et de simple
 * clé sinon ; `official` est le total imprimé, quand il est un nombre.
 */
export function setRef(setName: string, number: string | null) {
  const parts = number?.split("/") ?? [];
  const denominator = parts.length === 2 ? parts[1].trim() : null;
  const official = denominator && /^\d+$/.test(denominator) ? Number(denominator) : 0;
  const id = denominator && !official ? denominator : normalize(setName).replace(/[^a-z0-9]+/g, "-");
  return {
    id,
    name: setName,
    cardCount: { official, total: official },
    localId: parts.length === 2 ? parts[0].trim() : number?.trim() || null,
  };
}

/**
 * Nom d'une carte pour un lecteur français : l'espèce traduite, le reste tel
 * quel — « Charmander δ » devient « Salamèche δ », « Team Rocket's Charmander »
 * garde son propriétaire. Une carte Dresseur, sans espèce, reste en anglais.
 */
export function frenchCardName(cardName: string, species?: { en: string; fr: string }): string {
  const found =
    species ??
    (() => {
      const bare = cardName.replace(/\s*(ex|EX|GX|V|VMAX|VSTAR|δ|☆|◇)$/u, "");
      const fr = frenchSpeciesName(bare);
      return fr ? { en: bare, fr } : null;
    })();
  if (!found) return cardName;
  const escaped = found.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cardName.replace(new RegExp(`\\b${escaped}\\b`), found.fr);
}

/**
 * Requêtes simultanées vers l'API. Une grille de recherche demande d'un coup
 * la vignette de quarante cartes, donc quarante pages : Bulbagarden est un
 * wiki de bénévoles, pas un CDN, et on n'y débarque pas à quarante de front.
 */
const MAX_PARALLEL = 4;
let active = 0;
const waiting: (() => void)[] = [];

async function throttled<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

async function fetchWikitext(page: string): Promise<string | null> {
  const url = `${API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
  return throttled(async () => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": BULBA_USER_AGENT, Accept: "application/json" },
        next: { revalidate: 86400 },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { parse?: { wikitext?: { "*": string } } };
      return json.parse?.wikitext?.["*"] ?? null;
    } catch {
      return null;
    }
  });
}

/** Ce que la recherche rend pour une carte Bulbapedia, avant mise en forme par `tcgdex.ts`. */
export interface BulbaListItem {
  id: string;
  name: string;
  nameJa: string;
  localId: string | null;
  setId: string;
  setName: string;
  /** Clé de dédoublonnage face à TCGdex : le numéro japonais imprimé. */
  printed: string | null;
}

/**
 * Cartes japonaises d'une saisie, par les pages d'espèce.
 *
 * Une saisie déjà en japonais ne mène nulle part ici : Bulbapedia s'indexe en
 * anglais, et les Dresseurs — le seul cas où l'on tape du japonais — n'ont pas
 * de page « (TCG) » par nom.
 */
export async function searchBulbapedia(query: string): Promise<BulbaListItem[]> {
  if (hasJapaneseScript(query)) return [];
  const species = speciesCandidates(query).slice(0, MAX_SPECIES);
  const pages = await Promise.all(species.map((entry) => fetchWikitext(`${entry.en} (TCG)`)));

  const items: BulbaListItem[] = [];
  species.forEach((entry, index) => {
    const wikitext = pages[index];
    if (!wikitext) return;
    for (const release of parseSpeciesReleases(wikitext)) {
      const ref = setRef(release.set, release.number);
      items.push({
        id: bulbaId(release.page, release.number ?? release.set),
        name: frenchCardName(release.cardName, entry),
        nameJa: entry.ja,
        localId: ref.localId,
        setId: ref.id,
        setName: ref.name,
        printed: release.number,
      });
    }
  });
  return items;
}

/** Une carte Bulbapedia, résolue depuis sa page. */
export interface BulbaCard {
  id: string;
  name: string;
  nameJa: string | null;
  nameEn: string;
  image: string | null;
  localId: string | null;
  set: { id: string; name: string; cardCount: { official: number; total: number } };
  rarity: string | null;
  hp: number | null;
  type: string | null;
  illustrator: string | null;
}

export async function getBulbaCard(id: string): Promise<BulbaCard | null> {
  const parsed = parseBulbaId(id);
  if (!parsed) return null;
  const wikitext = await fetchWikitext(parsed.page);
  const page = wikitext ? parseCardPage(wikitext) : null;
  if (!page) return null;

  // La sortie demandée, sinon la première japonaise, sinon rien de japonais :
  // la page existe, on la montre quand même, sans numéro.
  const release =
    page.releases.find(
      (entry) => entry.number === parsed.release || entry.set === parsed.release,
    ) ??
    page.releases[0] ??
    null;
  const ref = setRef(release?.set ?? "", release?.number ?? null);

  return {
    id,
    name: frenchCardName(page.cardName),
    nameJa: page.jname,
    nameEn: page.cardName,
    image: page.image,
    localId: ref.localId,
    set: { id: ref.id, name: ref.name, cardCount: ref.cardCount },
    rarity: release?.rarity ?? null,
    hp: page.hp,
    type: page.type,
    illustrator: page.illustrator,
  };
}
