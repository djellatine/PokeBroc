import type { Metadata } from "next";
import DiscordTest from "@/components/DiscordTest";
import { requireUser } from "@/lib/auth";
import { isConfigured as hasDiscord } from "@/lib/discord";
import { age, plural } from "@/lib/format";
import { readVeilleAt } from "@/lib/veille";

export const metadata: Metadata = { title: "Alertes" };

// L'état de la veille est un fichier que l'autre processus réécrit : le mettre
// en cache afficherait un « dernier passage » figé à l'heure du build.
export const dynamic = "force-dynamic";

export default async function AlertesPage() {
  const user = await requireUser();
  const { state, now } = await readVeilleAt();
  const configured = hasDiscord();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Alertes</h1>
        <p className="mt-2 text-sm leading-relaxed text-dim">
          Une veille balaie vos {plural(user.favorites.length, "carte suivie", "cartes suivies")} en
          dehors de vos visites. Chaque annonce qui apparaît — et que le fil vous montrerait par
          défaut — est envoyée sur <strong className="text-text">Discord</strong>, dans le salon de
          votre choix.
        </p>
      </header>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Discord</h2>

        {configured ? (
          <>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-good">● Webhook branché</span>
              {typeof state.sent === "number" && (
                <span className="text-faint">
                  {plural(state.sent, "alerte envoyée", "alertes envoyées")} au total
                </span>
              )}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-dim">
              Les alertes partent vers le salon du webhook <code className="font-mono">DISCORD_WEBHOOK_URL</code>.
              Pour changer de salon, remplacez cette variable ; pour couper les alertes, retirez-la.
            </p>
            <div className="mt-4">
              <DiscordTest />
            </div>
          </>
        ) : (
          <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-dim">
            <p>Aucun webhook configuré. Trois étapes, une minute :</p>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              <li>
                Sur votre serveur Discord : <strong className="text-text">Paramètres du salon → Intégrations
                → Webhooks → Nouveau webhook</strong>, puis <strong className="text-text">Copier l’URL</strong>.
              </li>
              <li>
                Collez-la dans <code className="font-mono">.env.local</code> :
                <br />
                <code className="mt-1 inline-block rounded bg-panel-3 px-2 py-1 font-mono text-[12px] text-text">
                  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/…
                </code>
              </li>
              <li>Relancez le site. La veille enverra alors ses alertes dans ce salon.</li>
            </ol>
            <p className="text-faint">
              La veille continue de balayer sans webhook — les pastilles « nouveau » du fil restent à
              jour — mais aucune alerte ne part.
            </p>
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
