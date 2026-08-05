import Link from "next/link";
import Dashboard from "@/components/Dashboard";
import FocusSearchButton from "@/components/FocusSearchButton";
import { getCurrentUser } from "@/lib/auth";
import { readSnapshots, staleCardIds } from "@/lib/feed";
import { touchFeedVisit } from "@/lib/store";

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) return <Landing />;
  if (user.favorites.length === 0) return <EmptyCollection />;

  // Les instantanés viennent du disque : aucune requête Vinted n'est faite ici,
  // et la page part complète. `Dashboard` ne rattrape que les cartes périmées.
  //
  // Les lots ne sont plus lus ici : ils ont leur propre route (`/lots`), et rien
  // n'obligeait à payer leur lecture pour une section que le fil enterrait cinq
  // écrans plus bas.
  const [visit, snapshots] = await Promise.all([
    touchFeedVisit(user.id),
    readSnapshots(user.favorites),
  ]);

  return (
    <Dashboard
      favorites={user.favorites}
      initialSnapshots={snapshots}
      initialStaleIds={staleCardIds(user.favorites, snapshots, visit.now)}
      newSince={visit.newSince}
      serverNow={visit.now}
    />
  );
}

/* -------------------------------------------------------------- visiteur */

function Landing() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 py-10 sm:py-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          Vos cartes Pokémon,
          <br />
          <span className="text-accent">leurs bonnes affaires sur Vinted et eBay.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-dim sm:text-base">
          Épinglez les cartes que vous cherchez. Toutes leurs annonces Vinted et eBay arrivent dans
          un fil unique, comparées à la cote Cardmarket, les nouveautés en tête.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Link
            href="/inscription"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong"
          >
            Créer un compte
          </Link>
          <Link
            href="/connexion"
            className="rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-dim transition hover:border-line-strong hover:text-text"
          >
            Se connecter
          </Link>
        </div>
      </div>

      {/* Quatre arguments : deux colonnes puis quatre, jamais trois — une
          rangée de trois laisserait le quatrième seul sur sa ligne. */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Argument title="La bonne carte, pas le bon mot">
          Sur Vinted, « Dracaufeu 4/102 » renvoie les mêmes mille annonces que « Dracaufeu ». Chaque
          annonce est renotée d’après son titre, et seules celles qui citent le nom <em>et</em> le
          numéro ou l’extension arrivent dans le fil.
        </Argument>
        <Argument title="Deux places de marché, un seul fil">
          Vinted et eBay sont interrogés ensemble et leurs annonces fusionnées, dédoublonnées et
          classées côte à côte. Chaque ligne porte sa provenance ; comparer les deux ne demande plus
          d’ouvrir deux onglets.
        </Argument>
        <Argument title="Un prix, une référence">
          Chaque annonce affiche son écart avec la tendance Cardmarket. Une carte à −38 % se repère
          sans ouvrir un seul onglet.
        </Argument>
        <Argument title="Ce qui est vraiment nouveau">
          Les annonces déjà croisées sont mémorisées. À chaque retour, seules celles apparues depuis
          votre dernier passage portent une pastille.
        </Argument>
      </ul>
    </div>
  );
}

function Argument({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="panel p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-dim">{children}</p>
    </li>
  );
}

/* ------------------------------------------------------ collection vide */

function EmptyCollection() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center sm:py-24">
      <h1 className="text-2xl font-bold tracking-tight">Votre collection est vide</h1>
      <p className="mt-3 text-sm leading-relaxed text-dim">
        Tapez un nom de Pokémon dans la barre de recherche, en haut. Les cartes s’affichent en
        aperçu — cliquez sur la bonne pour l’épingler, et ses annonces Vinted et eBay apparaîtront
        ici.
      </p>
      <FocusSearchButton className="mt-6 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong">
        Chercher une carte
      </FocusSearchButton>
    </div>
  );
}
