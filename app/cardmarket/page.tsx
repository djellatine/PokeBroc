import type { Metadata } from "next";
import { readCardmarketStatus } from "@/lib/cardmarket";
import { requireUser } from "@/lib/auth";
import { age, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Cardmarket" };

// L'état de la collecte est un fichier que le collecteur réécrit toutes les
// quinze minutes : le mettre en cache figerait le « dernier passage ».
export const dynamic = "force-dynamic";

export default async function CardmarketPage() {
  const user = await requireUser();
  const watched = user.favorites.filter((favorite) => favorite.cardmarket);
  const status = await readCardmarketStatus();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-10 sm:py-14">
      <header className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-indigo-400/40 bg-indigo-400/10 px-3 py-1 text-xs font-semibold text-indigo-300">
          <span className="h-2 w-2 rounded-full bg-indigo-400" />
          Cardmarket
        </span>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Guettez vos cartes précieuses
          <br />
          <span className="text-dim">là où les affaires partent vite.</span>
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-dim">
          Cardmarket n’a pas de fil de nouveautés et se cache derrière une protection anti-robots.
          PokeBroc la surveille quand même — pour les cartes que vous jugez assez précieuses — et
          fait remonter ses offres dans une colonne dédiée, à droite du fil.
        </p>
      </header>

      <StatusCard watched={watched.length} status={status} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight">Suivre une carte</h2>
        <p className="text-sm leading-relaxed text-dim">
          Sur chaque carte de votre collection, le bouton{" "}
          <span className="inline-flex items-center rounded-full border border-accent/60 bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">
            CM
          </span>{" "}
          ouvre un menu.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FeatureCard title="Surveiller" accent>
            Coche la carte comme « précieuse ». Ses offres entrent dans le fil. À réserver aux cartes
            qui comptent : chacune coûte une visite de navigateur.
          </FeatureCard>
          <FeatureCard title="Reverse · 1ère édition">
            Le tirage change tout au prix. On surveille précisément la version voulue, pas « la
            carte » en général.
          </FeatureCard>
          <FeatureCard title="Toujours en français">
            La langue est imposée, pas à choisir : un collectionneur francophone ne guette pas une
            carte japonaise.
          </FeatureCard>
          <FeatureCard title="Coller le lien">
            Pour une carte ancienne ou rare que la recherche ne retrouve pas, collez l’adresse de sa
            page Cardmarket dans le menu. Elle sera sondée telle quelle.
          </FeatureCard>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight">Démarrer, ou débloquer</h2>
        <p className="text-sm leading-relaxed text-dim">
          La collecte pilote un vrai navigateur, sur la machine où tourne le site — la seule à avoir
          une adresse « maison » que Cardmarket accepte. Une fois amorcée, elle tourne seule toutes
          les quinze minutes. Au premier usage, ou quand le contrôle se réveille (bandeau ambre sur
          le fil), il faut lever le défi à la main : aucun programme ne coche un CAPTCHA à votre
          place.
        </p>
        <ol className="flex flex-col gap-3">
          <Step n={1} title="Laisser refroidir">
            Ouvrez <Code>cardmarket.com</Code> dans votre navigateur habituel : quand la page
            s’affiche sans écran d’attente, l’adresse est calmée.
          </Step>
          <Step n={2} title="Amorcer une fois">
            Dans un terminal, à la racine du projet — une fenêtre s’ouvre, laissez-la passer le
            contrôle (cliquez la case si elle apparaît) :
            <CodeBlock>python collect\cardmarket.py --visible --resolve</CodeBlock>
          </Step>
          <Step n={3} title="Activer la minuterie">
            La tâche <Code>PokeBroc Cardmarket</Code> relève vos cartes toutes les quinze minutes :
            <CodeBlock>schtasks /Change /TN &quot;PokeBroc Cardmarket&quot; /ENABLE</CodeBlock>
          </Step>
        </ol>
      </section>

      <section className="rounded-2xl border border-line bg-panel-2 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-faint">Bon à savoir</h2>
        <ul className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-dim">
          <li className="flex gap-2.5">
            <span className="text-faint">·</span>
            <span>
              <strong className="text-text">Pas 100 % automatique.</strong> La protection redurcit
              parfois : il faut refaire l’amorçage <Code>--visible</Code>. L’API officielle, plus
              propre, est réservée aux vendeurs professionnels et fermée aux nouvelles demandes.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="text-faint">·</span>
            <span>
              <strong className="text-text">Les offres ne se bousculent pas.</strong> Comparées à la
              même cote que le reste du fil : c’est l’offre isolée très en dessous qu’on guette.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="text-faint">·</span>
            <span>
              <strong className="text-text">Écart trompeur sur les cartes bon marché.</strong> Sur
              une carte à un euro, −80 % ne vaut que quelques centimes.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function StatusCard({
  watched,
  status,
}: {
  watched: number;
  status: Awaited<ReturnType<typeof readCardmarketStatus>>;
}) {
  if (watched === 0) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-6">
        <p className="text-base font-semibold">Aucune carte surveillée pour l’instant</p>
        <p className="mt-1.5 text-sm leading-relaxed text-dim">
          Cochez <span className="font-bold text-accent">CM</span> sur une carte précieuse de votre
          collection pour commencer.
        </p>
      </div>
    );
  }

  const blocked = status?.challenged ?? false;
  const missing = !status;
  const tone = missing
    ? { ring: "border-line", dot: "bg-faint", label: "En attente", text: "text-faint" }
    : blocked
      ? { ring: "border-bad/40", dot: "bg-bad", label: "Bloquée", text: "text-bad" }
      : { ring: "border-good/40", dot: "bg-good", label: "En service", text: "text-good" };

  return (
    <div className={`rounded-2xl border ${tone.ring} bg-panel p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
          <span className={`text-base font-bold ${tone.text}`}>Collecte {tone.label.toLowerCase()}</span>
        </span>
        <span className="text-xs text-faint">
          {plural(watched, "carte surveillée", "cartes surveillées")}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-dim">
        {missing
          ? "Aucune collecte n’a encore tourné. Suivez les trois étapes ci-dessous."
          : blocked
            ? "La dernière tentative s’est heurtée au contrôle anti-robots. Relancez l’amorçage « --visible » — étape 2 ci-dessous."
            : "Tout roule. Les offres se rafraîchissent toutes les quinze minutes."}
      </p>
      {status && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-faint">
          Dernier passage il y a {age(status.at)} · {plural(status.offers, "offre relevée", "offres relevées")}
        </p>
      )}
    </div>
  );
}

function FeatureCard({
  title,
  accent,
  children,
}: {
  title: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent ? "border-accent/40 bg-accent/[0.06]" : "border-line bg-panel"
      }`}
    >
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 rounded-xl border border-line bg-panel p-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold">{title}</h3>
        <div className="mt-1.5 text-[13px] leading-relaxed text-dim">{children}</div>
      </div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-panel-3 px-1.5 py-0.5 font-mono text-[12px] text-text">{children}</code>;
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg bg-panel-3 px-3 py-2 font-mono text-[12px] text-text">
      {children}
    </pre>
  );
}
