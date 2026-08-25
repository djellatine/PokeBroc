import type { Metadata } from "next";
import TelegramLink from "@/components/TelegramLink";
import { requireUser } from "@/lib/auth";
import { age, plural } from "@/lib/format";
import { botName, isConfigured as hasTelegram } from "@/lib/telegram";
import { readVeilleAt, veilleUser } from "@/lib/veille";
import { TELEGRAM_CODE_TTL_MS } from "@/lib/store";

export const metadata: Metadata = { title: "Alertes" };

// L'état de la veille est un fichier que l'autre processus réécrit : le mettre
// en cache afficherait un « dernier passage » figé à l'heure du build.
export const dynamic = "force-dynamic";

export default async function AlertesPage() {
  const user = await requireUser();
  const { state, now } = await readVeilleAt();
  const linked = veilleUser(state, user.id);

  const bot = botName();
  const configured = hasTelegram();

  const pendingCode =
    user.telegramCode && now - (user.telegramCodeAt ?? 0) < TELEGRAM_CODE_TTL_MS
      ? user.telegramCode
      : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Alertes</h1>
        <p className="mt-2 text-sm leading-relaxed text-dim">
          Une veille balaie vos {plural(user.favorites.length, "carte suivie", "cartes suivies")} en
          dehors de vos visites. Chaque annonce qui apparaît — et que le fil vous montrerait par
          défaut — vous est signalée sur Telegram.
        </p>
      </header>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Telegram</h2>

        {!configured ? (
          <p className="mt-3 text-sm leading-relaxed text-dim">
            Le bot n’est pas configuré sur ce serveur : <code className="font-mono">TELEGRAM_BOT_TOKEN</code>{" "}
            est absent. La veille continue de balayer — les pastilles « nouveau » restent à jour —
            mais aucune alerte ne part.
          </p>
        ) : linked ? (
          <>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-good">● Connecté</span>
              <span className="text-faint">
                depuis {age(linked.linkedAt, now)} · {plural(linked.sent, "alerte envoyée", "alertes envoyées")}
              </span>
            </p>
            <p className="mt-3 text-xs leading-relaxed text-dim">
              Pour ne plus rien recevoir, envoyez <code className="font-mono text-text">/stop</code>{" "}
              au bot. La déconnexion se fait depuis la conversation, et non d’ici : l’appairage
              appartient au processus de veille, seul à écrire son fichier d’état.
            </p>
          </>
        ) : (
          <div className="mt-3">
            <TelegramLink botName={bot} ttlMs={TELEGRAM_CODE_TTL_MS} pendingCode={pendingCode} />
          </div>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Dernier passage</h2>
        {state.at ? (
          <p className="mt-2 text-sm text-dim">
            Il y a {age(state.at, now)}
            {state.summary && <span className="text-faint"> · {state.summary}</span>}
          </p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-dim">
            La veille n’a encore jamais tourné. Lancez <code className="font-mono">npm run veille</code>{" "}
            une fois, puis posez-la sur une minuterie — la marche à suivre est dans le README.
          </p>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Ce qui déclenche une alerte</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-xs leading-relaxed text-dim">
          <li>
            Une annonce <strong className="font-semibold text-text">jamais croisée</strong> jusque-là
            — la même mémoire que la pastille « nouveau » du fil.
          </li>
          <li>
            Dont le titre cite le nom <em>et</em> le numéro ou l’extension : les correspondances
            approximatives parlent d’une autre carte.
          </li>
          <li>
            Ni gradée, ni lot — comme le fil les masque par défaut, pour qu’une alerte ne mène
            jamais à une page où l’annonce annoncée est filtrée.
          </li>
        </ul>
      </section>
    </div>
  );
}
