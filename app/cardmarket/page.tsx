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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Cardmarket</h1>
        <p className="mt-2 text-sm leading-relaxed text-dim">
          Cardmarket est une des grandes places de cartes en Europe, mais elle n’a pas de fil de
          nouveautés et se cache derrière une protection anti-robots. PokeBroc la surveille quand
          même — pour les cartes que vous jugez assez précieuses — et fait remonter ses offres dans
          votre fil, à côté de Vinted, eBay et leboncoin.
        </p>
      </header>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Suivre une carte</h2>
        <p className="mt-3 text-sm leading-relaxed text-dim">
          Sur chaque carte de votre collection, le petit bouton{" "}
          <span className="rounded border border-accent/60 bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
            CM
          </span>{" "}
          ouvre un menu :
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-dim">
          <li>
            <strong className="text-text">Surveiller sur Cardmarket</strong> — coche la carte comme
            « précieuse ». Ses offres apparaissent alors dans le fil. À réserver aux cartes qui
            comptent : chaque carte suivie coûte une visite de navigateur.
          </li>
          <li>
            <strong className="text-text">Reverse</strong> et{" "}
            <strong className="text-text">1ère édition</strong> — le tirage change tout au prix. On
            surveille donc précisément la version voulue, pas « la carte » en général.
          </li>
          <li>
            <strong className="text-text">Toujours en français</strong> — la langue est imposée, pas
            à choisir : un collectionneur francophone ne guette pas une carte japonaise.
          </li>
          <li>
            <strong className="text-text">Coller le lien</strong> — pour les cartes anciennes ou
            rares que la recherche automatique ne retrouve pas, ouvrez la page de la carte sur
            Cardmarket dans votre navigateur et collez son adresse dans le menu. Elle sera sondée
            telle quelle.
          </li>
        </ul>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">État de la collecte</h2>
        {watched.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-dim">
            Aucune carte n’est encore surveillée sur Cardmarket. Cochez « CM » sur une carte
            précieuse de votre collection pour commencer.
          </p>
        ) : !status ? (
          <p className="mt-3 text-sm leading-relaxed text-dim">
            {plural(watched.length, "carte surveillée", "cartes surveillées")}, mais aucune collecte
            n’a encore tourné. Lancez l’amorçage ci-dessous.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              {status.challenged ? (
                <span className="text-bad">● Bloquée par Cloudflare</span>
              ) : (
                <span className="text-good">● En service</span>
              )}
              <span className="text-faint">
                dernier passage il y a {age(status.at)} · {plural(status.offers, "offre relevée", "offres relevées")}
              </span>
            </p>
            <p className="text-xs leading-relaxed text-dim">
              {plural(watched.length, "carte surveillée", "cartes surveillées")}.{" "}
              {status.challenged
                ? "La dernière tentative s’est heurtée au contrôle anti-robots — voir « débloquer » ci-dessous."
                : "Les offres se rafraîchissent toutes les quinze minutes."}
            </p>
          </div>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Démarrer, ou débloquer la collecte</h2>
        <p className="mt-3 text-sm leading-relaxed text-dim">
          La collecte pilote un vrai navigateur, sur la machine où tourne le site — la seule à avoir
          une adresse « maison » que Cardmarket accepte. Elle se lance toute seule toutes les quinze
          minutes une fois amorcée. Au premier usage, ou quand le contrôle anti-robots se réveille
          (bandeau ambre sur le fil), il faut lever le défi <strong className="text-text">à la
          main</strong> — aucun programme ne coche une case « je ne suis pas un robot » à votre
          place.
        </p>
        <ol className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-dim">
          <li>
            <strong className="text-text">1. Laisser refroidir.</strong> Ouvrez{" "}
            <code className="font-mono text-text">cardmarket.com</code> dans votre navigateur
            habituel : quand la page s’affiche sans écran d’attente, l’adresse est calmée.
          </li>
          <li>
            <strong className="text-text">2. Amorcer une fois</strong>, dans un terminal à la racine
            du projet :
            <br />
            <code className="mt-1 inline-block rounded bg-panel-2 px-2 py-1 font-mono text-xs text-text">
              python collect\cardmarket.py --visible --resolve
            </code>
            <br />
            Une fenêtre s’ouvre : laissez-la passer le contrôle (cliquez la case si elle apparaît).
            Le laissez-passer obtenu est ensuite gardé pour les collectes invisibles.
          </li>
          <li>
            <strong className="text-text">3. Vérifier la minuterie.</strong> La tâche Windows{" "}
            <code className="font-mono text-text">PokeBroc Cardmarket</code> relève vos cartes toutes
            les quinze minutes. Pour l’activer :
            <br />
            <code className="mt-1 inline-block rounded bg-panel-2 px-2 py-1 font-mono text-xs text-text">
              schtasks /Change /TN &quot;PokeBroc Cardmarket&quot; /ENABLE
            </code>
          </li>
        </ol>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Ce qu’il faut savoir</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-dim">
          <li>
            <strong className="text-text">Ce n’est pas du 100 % automatique.</strong> La protection
            de Cardmarket redurcit de temps en temps ; il faut alors refaire l’amorçage{" "}
            <code className="font-mono text-text">--visible</code>. C’est le prix à payer :{" "}
            <span className="text-faint">
              l’API officielle, elle, est réservée aux vendeurs professionnels et n’accepte plus de
              nouvelles demandes.
            </span>
          </li>
          <li>
            <strong className="text-text">Les offres ne se bousculent pas.</strong> Une offre
            Cardmarket est comparée à la même cote que le reste du fil ; une version standard bien
            cotée n’a rien d’une affaire, c’est l’offre isolée très en dessous qu’on guette.
          </li>
          <li>
            <strong className="text-text">Écart trompeur sur les cartes bon marché.</strong> Sur une
            carte à un euro, un écart de −80 % ne vaut que quelques centimes. La surveillance a du
            sens sur les cartes de valeur.
          </li>
        </ul>
      </section>
    </div>
  );
}
