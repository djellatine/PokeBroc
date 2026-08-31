/**
 * La veille — balaie les cartes suivies sans attendre qu'un visiteur passe,
 * et alerte sur Discord ce qui vient d'apparaître.
 *
 * Pourquoi ce script existe
 * -------------------------
 * `refreshCard()` n'était appelé que depuis un rendu de page ou `/api/feed` :
 * autrement dit **uniquement quand quelqu'un regarde le site**. Personne sur le
 * site, aucune collecte ; aucune collecte, rien à annoncer. Une notification
 * qui ne se déclenche que devant l'écran ne notifie rien.
 *
 * D'où ce second processus, sur minuterie, exactement comme `collect/lbc.py`.
 * Il fait tourner la collecte à vide, ce qui a deux effets — le second était
 * déjà souhaitable avant qu'il soit question d'alertes :
 *
 * 1. les annonces neuves sont découvertes dans les minutes qui suivent leur
 *    mise en ligne, et non au prochain passage sur le site ;
 * 2. le badge « nouveau » redevient honnête pour qui ne vient qu'une fois par
 *    jour — sans veille, il ne montrait que ce que la visite venait elle-même
 *    de déterrer.
 *
 * Ce qu'il n'écrit pas
 * --------------------
 * `users.json`. Ce fichier appartient au site, et deux processus Node qui
 * l'écrivent en perdraient des morceaux — `store.ts` sérialise en mémoire, ce
 * qui ne protège de rien au-delà du processus. La veille n'y touche pas : son
 * état à elle vit dans `.data/veille/state.json`. Voir l'en-tête de
 * `lib/veille.ts`.
 *
 * Il écrit en revanche `.data/feed/` et `.data/sightings/`, que le site écrit
 * aussi. La concurrence y est bénigne et bornée : les écritures sont atomiques
 * (fichier temporaire puis renommage), donc jamais tronquées, et deux passages
 * rapprochés sur une même carte produisent deux instantanés presque
 * identiques — perdre le second coûte au pire une redécouverte au tour suivant.
 *
 * Ce qui déclenche une alerte
 * ---------------------------
 * Exactement ce que le fil montre par défaut : correspondance forte
 * (`score >= STRONG_SCORE`), ni gradée, ni lot, et pas écartée à la main.
 * Reprendre les réglages par défaut du tableau de bord plutôt qu'en inventer
 * d'autres est la seule façon qu'une alerte ne mène pas à une page où l'annonce
 * annoncée est filtrée.
 *
 * Usage
 * -----
 *     npm run veille               # balaie puis alerte sur Discord
 *     npm run veille -- --dry-run  # n'envoie rien, n'avance aucun repère
 *     npm run veille -- --no-sweep # alertes seules, sans balayage
 *     npm run veille -- --quiet    # pas de détail carte par carte
 *
 * `--dry-run` retient les messages et l'état, pas les instantanés : le balayage
 * écrit `.data/feed/` comme d'habitude, puisque c'est justement ce qu'on veut
 * observer. Le combiner avec `--no-sweep` pour ne toucher à rien du tout.
 */

import path from "node:path";
import { selectFresh, type AlertGroup } from "../lib/alerts";
import { isConfigured as hasDiscord, sendAlerts } from "../lib/discord";
import { readSnapshot, refreshCard } from "../lib/feed";
import { plural } from "../lib/format";
import { refreshCardmarketSweep, writeCardmarketWatched } from "../lib/cardmarket";
import { readJson, writeJson } from "../lib/json-file";
import { writeLbcQueries } from "../lib/lbc";
import { allTrackedCards, listUsers } from "../lib/store";
import { readVeille, VEILLE_DIR, writeVeille, type VeilleState } from "../lib/veille";

/** Pause entre deux cartes, en plus des 350 ms que chaque place s'impose déjà. */
const BETWEEN_CARDS_MS = 500;

/** Lignes conservées dans `collect.log` — ~2 jours à un passage par quart d'heure. */
const LOG_LINES = 200;

const LOG_FILE = path.join(VEILLE_DIR, "collect.log");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Options {
  dryRun: boolean;
  quiet: boolean;
  sweep: boolean;
}

function parseArgs(argv: string[]): Options {
  return {
    dryRun: argv.includes("--dry-run"),
    quiet: argv.includes("--quiet"),
    sweep: !argv.includes("--no-sweep"),
  };
}

/**
 * Trace d'exécution, à côté de l'état.
 *
 * Même raison que pour `collect/lbc.py` : sous une minuterie, un passage raté
 * ne laisse qu'un code de sortie, et un code de sortie ne dit pas *ce qui* a
 * échoué. Un journal qui échoue n'a jamais de raison de faire échouer un
 * passage réussi, d'où l'erreur avalée.
 */
async function journal(message: string): Promise<void> {
  const stamp = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  try {
    const previous = (await readJson<string[]>(LOG_FILE)) ?? [];
    const kept = [...previous, `${stamp}  ${message}`].slice(-LOG_LINES);
    await writeJson(LOG_FILE, kept);
  } catch {
    /* le journal n'est pas la mission */
  }
}

/* --------------------------------------------------------------- balayage */

async function sweep(startedAt: number, options: Options): Promise<{ cards: number; errors: string[] }> {
  const cards = await allTrackedCards();
  const errors: string[] = [];

  // Les requêtes que `collect/lbc.py` jouera à son prochain passage. Déposées
  // ici parce que la veille tourne au même quart d'heure et tient déjà l'union
  // des cartes suivies — et parce que `bestQuery` s'appuie sur `searchName`,
  // qui traduit `☆` en « gold star » : redire cette règle en Python la ferait
  // diverger au premier ajustement. Un échec ne doit pas emporter le balayage :
  // le collecteur rejouera simplement la liste précédente.
  try {
    const queries = await writeLbcQueries(cards);
    if (!options.quiet) console.error(`  ${queries.length} requêtes leboncoin déposées`);
  } catch (error) {
    errors.push(`requêtes leboncoin : ${error instanceof Error ? error.message : String(error)}`);
  }

  // La liste de chasse Cardmarket, déposée au même endroit et pour la même
  // raison : le collecteur piloté par navigateur la relira pour résoudre puis
  // sonder les cartes cochées « précieuse ». Un échec ne doit pas emporter le
  // balayage.
  try {
    const watched = await writeCardmarketWatched(cards);
    if (!options.quiet) console.error(`  ${watched.length} cartes suivies sur Cardmarket`);

    // Puis on relève ces cartes en un seul lancement de navigateur, avant la
    // boucle par carte qui suit : `refreshCard` y lira le `cartes.json` frais
    // que ce balayage vient d'écrire, et les alertes partiront sur ce qui est
    // neuf. Une fois pour toutes les cartes, pas une fois par carte — c'est ce
    // qui fait de la veille la minuterie de Cardmarket. Ne lève jamais.
    if (watched.length > 0) await refreshCardmarketSweep();
  } catch (error) {
    errors.push(`liste Cardmarket : ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const [index, favorite] of cards.entries()) {
    try {
      const snapshot = await refreshCard(favorite, startedAt, true);
      if (snapshot.error) errors.push(`${favorite.cardId} : ${snapshot.error}`);
      if (!options.quiet) {
        const state = snapshot.error ? "échec" : `${snapshot.items.length} annonces`;
        console.error(`  ${favorite.cardId} — ${state}`);
      }
    } catch (error) {
      errors.push(`${favorite.cardId} : ${error instanceof Error ? error.message : String(error)}`);
    }

    if (index < cards.length - 1) await sleep(BETWEEN_CARDS_MS);
  }

  return { cards: cards.length, errors };
}

/* ---------------------------------------------------------------- alertes */

/**
 * Les annonces neuves a annoncer, groupees par carte, tous comptes confondus.
 *
 * Un seul salon Discord recoit les alertes : on fond donc les cartes suivies de
 * tous les comptes, en dedupliquant par annonce (une carte suivie par deux
 * personnes ne s'annonce qu'une fois). Le masquage manuel de chacun est
 * respecte — ce qu'un compte a ecarte du fil ne repart pas en alerte.
 */
async function freshGroups(since: number): Promise<AlertGroup[]> {
  const byCard = new Map<string, AlertGroup>();
  const seen = new Set<string>();

  for (const user of await listUsers()) {
    for (const favorite of user.favorites) {
      const snapshot = await readSnapshot(favorite.cardId);
      if (!snapshot) continue;

      const items = selectFresh(snapshot.items, since, user.hidden).filter(
        (item) => !seen.has(item.id),
      );
      if (items.length === 0) continue;
      for (const item of items) seen.add(item.id);

      const group = byCard.get(favorite.cardId);
      if (group) group.items.push(...items);
      else byCard.set(favorite.cardId, { card: snapshot.card, items });
    }
  }

  return [...byCard.values()];
}

async function notify(
  state: VeilleState,
  startedAt: number,
  options: Options,
): Promise<{ sent: number; errors: string[] }> {
  // Premier passage : le repere part de maintenant, sinon la premiere alerte
  // deverserait tout l'historique deja sur le disque.
  const since = state.notifiedAt ?? startedAt;
  const groups = await freshGroups(since);
  const count = groups.reduce((total, group) => total + group.items.length, 0);

  if (count === 0) {
    // Rien a annoncer. Le repere avance quand meme, pour qu'il date du dernier
    // *examen* et non du dernier envoi.
    state.notifiedAt = startedAt;
    return { sent: 0, errors: [] };
  }

  if (options.dryRun) {
    console.log(`
${plural(count, "annonce")} a annoncer :`);
    for (const group of groups) {
      console.log(`  ${group.card.name} : ${plural(group.items.length, "annonce")}`);
    }
    return { sent: count, errors: [] };
  }

  const { sent, error } = await sendAlerts(groups);
  if (error) {
    // Erreur passagere : le repere ne bouge pas, le prochain passage renverra
    // les memes annonces plutot que de les perdre.
    return { sent: 0, errors: [error] };
  }

  state.notifiedAt = startedAt;
  state.sent = (state.sent ?? 0) + sent;
  return { sent, errors: [] };
}

/* -------------------------------------------------------------------- main */

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const state = await readVeille();
  const problems: string[] = [];

  const discord = hasDiscord();
  if (!discord) {
    // Comme les clés eBay : la fonction disparaît, le reste tourne. Le balayage
    // seul garde déjà le badge « nouveau » honnête.
    console.error("veille : DISCORD_WEBHOOK_URL absent — balayage seul, aucune alerte.");
  }

  let cards = 0;
  if (options.sweep) {
    const result = await sweep(startedAt, options);
    cards = result.cards;
    problems.push(...result.errors);
  }

  let sent = 0;
  if (discord) {
    const result = await notify(state, startedAt, options);
    sent = result.sent;
    problems.push(...result.errors);
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const summary =
    `${plural(cards, "carte balayée", "cartes balayées")}, ${plural(sent, "alerte envoyée", "alertes envoyées")}` +
    ` (${elapsed.toFixed(1)} s)` +
    (problems.length > 0 ? ` — ${plural(problems.length, "erreur")} : ${problems.join(" · ")}` : "");

  console.log(`veille : ${summary}`);

  if (options.dryRun) return 0;

  state.at = startedAt;
  state.summary = summary;
  await writeVeille(state);
  await journal(summary);

  // Le balayage n'a rien produit *et* n'a rencontré que des erreurs : la
  // minuterie doit pouvoir alerter.
  return cards > 0 && problems.length >= cards ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (error) => {
    // Sans ce filet, une exception inattendue ne laisse qu'une trace sur une
    // sortie que personne ne lit, et un code de sortie 1 indistinct.
    const message = `ÉCHEC ${error instanceof Error ? `${error.name} : ${error.message}` : String(error)}`;
    console.error(`veille : ${message}`);
    await journal(message);
    process.exit(3);
  });
