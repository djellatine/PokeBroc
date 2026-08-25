/**
 * La veille — balaie les cartes suivies sans attendre qu'un visiteur passe,
 * et alerte sur Telegram ce qui vient d'apparaître.
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
 * (`score >= STRONG_SCORE`), ni gradée, ni lot. Reprendre les réglages par
 * défaut du tableau de bord plutôt qu'en inventer d'autres est la seule façon
 * qu'une alerte ne mène pas à une page où l'annonce annoncée est filtrée.
 *
 * Usage
 * -----
 *     npm run veille               # balaie, appaire, alerte
 *     npm run veille -- --dry-run  # n'envoie rien, n'avance aucun repère
 *     npm run veille -- --no-sweep # appairage et alertes seuls, sans balayage
 *     npm run veille -- --quiet    # pas de détail carte par carte
 *
 * `--dry-run` retient les messages et l'état, pas les instantanés : le balayage
 * écrit `.data/feed/` comme d'habitude, puisque c'est justement ce qu'on veut
 * observer. Le combiner avec `--no-sweep` pour ne toucher à rien du tout.
 */

import path from "node:path";
import { compose, isPermanentFailure, selectFresh, type AlertGroup } from "../lib/alerts";
import { readSnapshot, refreshCard } from "../lib/feed";
import { plural } from "../lib/format";
import { readJson, writeJson } from "../lib/json-file";
import {
  allTrackedCards,
  clearTelegramCode,
  findUserByTelegramCode,
  listUsers,
  type User,
} from "../lib/store";
import {
  chunk,
  escapeHtml,
  getUpdates,
  isConfigured as hasTelegram,
  sendMessage,
} from "../lib/telegram";
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

/* ---------------------------------------------------- boîte de réception */

/** Ce que le bot a compris du lot de messages relevé. */
interface Inbox {
  /** Adresses fraîchement connectées. */
  paired: string[];
  /** Conversations qui se sont déliées avec `/stop`. */
  stopped: number;
}

const HELP =
  "Envoyez le code affiché sur la page <b>Alertes</b> de PokeBroc pour connecter votre compte. " +
  "<b>/stop</b> déconnecte cette conversation.";

/**
 * Relève les messages reçus par le bot : codes d'appairage et `/stop`.
 *
 * La déconnexion passe par le bot, et non par le site, pour la raison qui
 * gouverne tout ce fichier : l'appairage vit dans `.data/veille/state.json`,
 * dont la veille est seule écrivaine. Un bouton « déconnecter » sur le site
 * devrait y écrire depuis l'autre processus, et rouvrirait exactement la course
 * que ce découpage évite. `/stop` est de toute façon la convention Telegram, et
 * il a un avantage propre : il fonctionne depuis la conversation elle-même,
 * y compris pour qui n'a plus accès au site.
 *
 * L'offset n'est avancé qu'après traitement du lot : Telegram ne considère un
 * message comme acquitté que lorsqu'on demande un `update_id` supérieur, et
 * avancer trop tôt perdrait un appairage au premier plantage.
 */
async function readInbox(state: VeilleState, options: Options): Promise<Inbox> {
  const inbox: Inbox = { paired: [], stopped: 0 };
  const updates = await getUpdates(state.offset);
  if (updates.length === 0) return inbox;

  const say = async (chatId: string, html: string) => {
    if (options.dryRun) return;
    // Un accusé qui échoue ne doit pas faire échouer le lot : le message
    // suivant peut très bien être un appairage valide.
    await sendMessage(chatId, html).catch(() => undefined);
  };

  for (const update of updates) {
    if (/^\/stop\b/i.test(update.text)) {
      const entry = Object.entries(state.users).find(
        ([, linked]) => linked.chatId === update.chatId,
      );
      if (entry && !options.dryRun) delete state.users[entry[0]];
      if (entry) inbox.stopped += 1;
      await say(
        update.chatId,
        entry
          ? "🔕 Déconnecté. Plus aucune alerte n'arrivera ici."
          : "Cette conversation n'était rattachée à aucun compte.",
      );
      continue;
    }

    // `/start ABC123` autant que `ABC123` : le lien profond du bot envoie la
    // première forme, la saisie manuelle la seconde.
    const code = update.text.replace(/^\/start\b\s*/i, "").trim();
    if (code === "") {
      await say(update.chatId, HELP);
      continue;
    }

    const user = await findUserByTelegramCode(code);
    if (!user) {
      // Se taire serait pire : l'expéditeur attendrait une alerte qui ne
      // viendrait jamais, sans savoir que son code avait expiré.
      await say(update.chatId, `❌ Code inconnu ou expiré.

${HELP}`);
      continue;
    }

    inbox.paired.push(user.email);
    if (options.dryRun) continue;

    const now = Date.now();
    state.users[user.id] = {
      chatId: update.chatId,
      linkedAt: now,
      // Le repère part de maintenant, sinon le premier passage déverserait
      // d'un coup les quarante annonces déjà sur le disque.
      notifiedAt: now,
      sent: 0,
    };
    await clearTelegramCode(user.id);
    await say(
      update.chatId,
      `✅ Compte <b>${escapeHtml(user.email)}</b> connecté.
` +
        `Vous recevrez ici les annonces neuves de vos ${plural(user.favorites.length, "carte suivie", "cartes suivies")}.`,
    );
  }

  state.offset = updates[updates.length - 1].updateId + 1;
  return inbox;
}

/* --------------------------------------------------------------- balayage */

async function sweep(startedAt: number, options: Options): Promise<{ cards: number; errors: string[] }> {
  const cards = await allTrackedCards();
  const errors: string[] = [];

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
 * Annonces à annoncer pour un compte, carte par carte.
 *
 * Seule cette fonction touche au disque ; la règle de sélection elle-même vit
 * dans `lib/alerts.ts`, où elle se teste sans instantané ni réseau.
 */
async function freshFor(user: User, since: number): Promise<AlertGroup[]> {
  const groups: AlertGroup[] = [];

  for (const favorite of user.favorites) {
    const snapshot = await readSnapshot(favorite.cardId);
    if (!snapshot) continue;

    const items = selectFresh(snapshot.items, since);
    if (items.length > 0) groups.push({ card: snapshot.card, items });
  }

  return groups;
}

async function notify(
  state: VeilleState,
  startedAt: number,
  options: Options,
): Promise<{ sent: number; errors: string[] }> {
  const users = await listUsers();
  const errors: string[] = [];
  let sent = 0;

  for (const user of users) {
    const linked = state.users[user.id];
    if (!linked) continue;

    const groups = await freshFor(user, linked.notifiedAt);
    const count = groups.reduce((total, group) => total + group.items.length, 0);

    if (count === 0) {
      // Rien à annoncer. Le repère avance quand même, pour qu'il date du
      // dernier *examen* et non du dernier envoi : c'est ce qui le rend
      // lisible dans le fichier d'état, où un repère vieux d'une semaine se
      // lit à tort comme une veille en panne.
      linked.notifiedAt = startedAt;
      continue;
    }

    if (options.dryRun) {
      console.log(`\n— ${user.email} : ${plural(count, "annonce")}`);
      for (const line of compose(groups)) console.log(`  ${line}`);
      sent += count;
      continue;
    }

    try {
      for (const message of chunk(compose(groups))) {
        await sendMessage(linked.chatId, message);
      }
      linked.notifiedAt = startedAt;
      linked.sent += count;
      sent += count;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${user.email} : ${message}`);
      if (isPermanentFailure(message)) {
        delete state.users[user.id];
      }
      // Erreur passagère : le repère ne bouge pas, le prochain passage
      // renverra les mêmes annonces plutôt que de les perdre.
    }
  }

  return { sent, errors };
}

/* -------------------------------------------------------------------- main */

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const state = await readVeille();
  const problems: string[] = [];

  const telegram = hasTelegram();
  if (!telegram) {
    // Comme les clés eBay : la fonction disparaît, le reste tourne. Le balayage
    // seul garde déjà le badge « nouveau » honnête.
    console.error("veille : TELEGRAM_BOT_TOKEN absent — balayage seul, aucune alerte.");
  }

  let inbox: Inbox = { paired: [], stopped: 0 };
  if (telegram) {
    try {
      inbox = await readInbox(state, options);
      for (const email of inbox.paired) console.log(`veille : ${email} connecté à Telegram.`);
    } catch (error) {
      problems.push(`appairage : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let cards = 0;
  if (options.sweep) {
    const result = await sweep(startedAt, options);
    cards = result.cards;
    problems.push(...result.errors);
  }

  let sent = 0;
  if (telegram) {
    const result = await notify(state, startedAt, options);
    sent = result.sent;
    problems.push(...result.errors);
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const summary =
    `${plural(cards, "carte balayée", "cartes balayées")}, ${plural(sent, "alerte envoyée", "alertes envoyées")}` +
    (inbox.paired.length > 0 ? `, ${plural(inbox.paired.length, "appairage")}` : "") +
    (inbox.stopped > 0 ? `, ${plural(inbox.stopped, "déconnexion")}` : "") +
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
