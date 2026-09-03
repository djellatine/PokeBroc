/**
 * Passerelle entre les noms japonais du catalogue et ceux des annonces.
 *
 * La base japonaise de TCGdex ne connaît que les noms japonais — « ピカチュウ »,
 * « リーフィアex » — sans numéro de Pokédex ni équivalent latin. Or tout le
 * reste du site parle français : l'utilisateur tape « pikachu », les vendeurs
 * écrivent « Pikachu 001/SV-P », et la notation cherche le nom dans le titre.
 * Ce module fait la traduction dans les deux sens, à partir de la table des
 * espèces de `pokedex-names.ts`.
 *
 * Seules les espèces sont traduites. Un nom de carte est une espèce habillée
 * de suffixes — « ex », « GX », « VMAX » — et parfois d'un préfixe (Méga,
 * forme régionale, dresseur propriétaire). On repère les espèces dans le nom,
 * on garde les suffixes latins tels quels, et on laisse tomber le reste du
 * japonais, qu'aucune annonce française ne reprend. Les cartes Dresseur, sans
 * espèce, restent en japonais : la notation s'en remet alors au numéro, qui sur
 * une carte japonaise porte le code de l'extension et suffit à la désigner.
 *
 * Aucun import de `node:` ni de `./tcgdex` : pur, testable, et chargé à la
 * demande par `tcgdex.ts` (import dynamique) pour que la table de 50 Ko
 * n'atterrisse jamais dans le paquet client.
 */

import { POKEDEX_NAMES } from "./pokedex-names";

/** Katakanas, hiraganas, kanjis — allongements et points médians compris. */
const JAPANESE_SCRIPT = /[\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Han}]/u;

export function hasJapaneseScript(text: string): boolean {
  return JAPANESE_SCRIPT.test(text);
}

/** Minuscules sans accents, pour comparer une saisie française à la table. */
function latin(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export interface Species {
  ja: string;
  fr: string;
  en: string;
}

/** Espèces indexées par premier katakana, les noms les plus longs d'abord. */
let byFirstChar: Map<string, Species[]> | null = null;

function index(): Map<string, Species[]> {
  if (byFirstChar) return byFirstChar;
  byFirstChar = new Map();
  for (const [ja, fr, en] of POKEDEX_NAMES) {
    const list = byFirstChar.get(ja[0]) ?? [];
    list.push({ ja, fr, en });
    byFirstChar.set(ja[0], list);
  }
  // Le plus long d'abord : « フシギバナ » avant « フシギ », s'il existait.
  for (const list of byFirstChar.values()) list.sort((a, b) => b.ja.length - a.ja.length);
  return byFirstChar;
}

export interface TranslatedName {
  /** Nom tel que les annonces l'écrivent : « Pikachu », « Phyllali ex ». */
  name: string;
  /** Même chose en anglais, que certains vendeurs préfèrent : « Leafeon ex ». */
  nameEn: string | null;
  /** Au moins une espèce reconnue. Faux pour une carte Dresseur. */
  translated: boolean;
}

/**
 * Traduit un nom de carte japonais.
 *
 * | Japonais | Français | Anglais |
 * | --- | --- | --- |
 * | ピカチュウ | Pikachu | Pikachu |
 * | リーフィアex | Phyllali ex | Leafeon ex |
 * | ピカチュウ&ゼクロムGX | Pikachu & Zekrom GX | Pikachu & Zekrom GX |
 * | Mリザードンex | Mega Dracaufeu ex | Mega Charizard ex |
 * | ロケット団のニャース | Miaouss | Meowth |
 * | ナンジャモ | ナンジャモ | — |
 */
export function translateJapaneseName(raw: string): TranslatedName {
  const name = raw.normalize("NFKC");
  const species = index();

  const fr: string[] = [];
  const en: string[] = [];
  let rest = "";
  let translated = false;

  const flush = () => {
    const kept = rest.trim();
    rest = "";
    if (!kept) return;
    // « ex », « GX », « & » restent ; « ロケット団の » tombe.
    const chunks = kept.split(JAPANESE_SCRIPT).map((chunk) => chunk.trim()).filter(Boolean);
    fr.push(...chunks);
    en.push(...chunks);
  };

  for (let i = 0; i < name.length; ) {
    const hit = species.get(name[i])?.find((entry) => name.startsWith(entry.ja, i));
    if (hit) {
      flush();
      fr.push(hit.fr);
      en.push(hit.en);
      translated = true;
      i += hit.ja.length;
    } else {
      rest += name[i];
      i += 1;
    }
  }
  flush();

  if (!translated) return { name: raw, nameEn: null, translated: false };

  // « M » devant une espèce : la Méga-évolution, que les vendeurs écrivent
  // « Mega Dracaufeu ex » ou « M Dracaufeu ex ». La première graphie contient
  // la seconde une fois normalisée, on la préfère.
  if (fr[0] === "M" && fr.length > 1) {
    fr[0] = "Mega";
    en[0] = "Mega";
  }

  const join = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").trim();
  return { name: join(fr), nameEn: join(en), translated: true };
}

/** Candidats retenus pour une saisie partielle : au-delà, la saisie est trop courte. */
const MAX_CANDIDATES = 8;

/**
 * Noms japonais à interroger pour une saisie française ou anglaise.
 *
 * « pikachu » donne « ピカチュウ » ; « evo » donne tout ce qui commence ainsi,
 * Évoli en tête. La correspondance exacte prime, puis les noms qui commencent
 * par la saisie, dans l'ordre du Pokédex. Une saisie qui porte déjà du japonais
 * est prise telle quelle.
 */
export function japaneseCandidates(query: string): string[] {
  const q = query.trim();
  if (hasJapaneseScript(q)) return [q.normalize("NFKC")];
  return speciesCandidates(q).map((species) => species.ja);
}

/**
 * Espèces que désigne une saisie française ou anglaise, dans les trois
 * langues — pour interroger Bulbapedia, qui parle anglais, comme TCGdex, qui
 * parle japonais. Même règle que `japaneseCandidates` : l'exact d'abord, puis
 * les préfixes, dans l'ordre du Pokédex.
 */
export function speciesCandidates(query: string): Species[] {
  const needle = latin(query);
  if (needle.length < 2) return [];

  const exact: Species[] = [];
  const prefixed: Species[] = [];
  for (const [ja, fr, en] of POKEDEX_NAMES) {
    const names = [latin(fr), latin(en)];
    if (names.includes(needle)) exact.push({ ja, fr, en });
    else if (names.some((name) => name.startsWith(needle))) prefixed.push({ ja, fr, en });
  }

  return [...exact, ...prefixed].slice(0, MAX_CANDIDATES);
}

/** Nom français d'une espèce désignée par son nom anglais, ou `null`. */
export function frenchSpeciesName(english: string): string | null {
  const needle = latin(english);
  const found = POKEDEX_NAMES.find(([, , en]) => latin(en) === needle);
  return found ? found[1] : null;
}
