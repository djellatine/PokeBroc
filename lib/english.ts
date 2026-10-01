/**
 * Passerelle entre les noms anglais du catalogue et la saisie française.
 *
 * Certaines extensions ne sont jamais sorties en français : Base Set 2, les
 * deux Gym, Legendary Collection, Skyridge, EX Team Rocket Returns, Platine
 * Arceus, Legendary Treasures — plus une poignée de séries promo. TCGdex ne
 * les a donc que dans sa base anglaise, sous des noms anglais. L'utilisateur,
 * lui, tape « dracaufeu » ; et les vendeurs français écrivent l'un ou l'autre.
 *
 * Même principe que `lib/japanese.ts`, dont on reprend la table des espèces :
 * la saisie est traduite en noms anglais pour interroger le catalogue, et le
 * nom de chaque carte retraduit en français pour l'affichage et la notation,
 * le nom anglais restant à côté. Seules les espèces sont traduites : « Dark
 * Charizard » devient « Dark Dracaufeu », « Professor Oak » reste tel quel.
 *
 * Pur, sans réseau, et chargé à la demande par `tcgdex.ts` comme son pendant
 * japonais : la table n'a rien à faire dans le paquet client.
 */

import { speciesCandidates } from "./japanese";
import { POKEDEX_NAMES } from "./pokedex-names";

/** Noms à interroger au plus : la saisie elle-même, puis les espèces qu'elle désigne. */
const MAX_QUERIES = 5;

/**
 * Noms anglais à interroger pour une saisie française ou anglaise.
 *
 * La saisie passe d'abord telle quelle — « reshiram », « professor » — puis
 * les noms anglais des espèces qu'elle désigne : « dracaufeu » ajoute
 * « Charizard ». L'exact d'abord, comme pour le japonais.
 */
export function englishCandidates(query: string): string[] {
  const q = query.trim();
  const out = new Map<string, string>([[q.toLowerCase(), q]]);
  for (const species of speciesCandidates(q)) {
    out.set(species.en.toLowerCase(), species.en);
  }
  return [...out.values()].slice(0, MAX_QUERIES);
}

/** Apostrophe droite : TCGdex écrit « Farfetch’d » comme « Farfetch'd ». */
function straight(value: string): string {
  return value.replace(/[’‘]/g, "'");
}

let pattern: { re: RegExp; fr: Map<string, string> } | null = null;

/**
 * Une seule expression pour toutes les espèces, les plus longs noms d'abord :
 * « Mewtwo » doit passer avant « Mew ». Les bornes refusent une lettre
 * collée — « Mew » ne prend pas dans « Mewtwo » — mais pas un trait d'union
 * ni un chiffre : « Reshiram-EX », « Porygon2 ».
 */
function speciesPattern(): { re: RegExp; fr: Map<string, string> } {
  if (pattern) return pattern;
  const fr = new Map<string, string>();
  for (const [, french, english] of POKEDEX_NAMES) fr.set(straight(english).toLowerCase(), french);
  const names = [...fr.keys()]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  pattern = { re: new RegExp(`(?<!\\p{L})(?:${names.join("|")})(?!\\p{L})`, "giu"), fr };
  return pattern;
}

/**
 * Traduit un nom de carte anglais.
 *
 * | Anglais | Français |
 * | --- | --- |
 * | Charizard | Dracaufeu |
 * | Reshiram-EX | Reshiram-EX |
 * | Dark Charizard | Dark Dracaufeu |
 * | Mr. Mime | M. Mime |
 * | Professor Oak | Professor Oak |
 */
export function translateEnglishName(raw: string): string {
  const { re, fr } = speciesPattern();
  return straight(raw).replace(re, (hit) => fr.get(hit.toLowerCase()) ?? hit);
}
