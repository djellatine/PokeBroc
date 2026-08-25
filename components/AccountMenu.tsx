import Link from "next/link";
import { logout } from "@/app/actions/auth";
import FrenchOnlyFlag from "@/components/FrenchOnlyFlag";
import ModeSwitch from "@/components/ModeSwitch";
import { getCurrentUser } from "@/lib/auth";

/**
 * Rendu à part et sous `<Suspense>` : lire le cookie de session dans le layout
 * lui-même retarderait le premier octet de toutes les pages.
 */
export default async function AccountMenu() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-[13px]">
        <Link
          href="/connexion"
          className="rounded-lg px-2.5 py-1.5 text-dim transition hover:text-text"
        >
          Connexion
        </Link>
        <Link
          href="/inscription"
          className="rounded-lg bg-accent px-2.5 py-1.5 font-semibold text-accent-ink transition hover:bg-accent-strong"
        >
          S’inscrire
        </Link>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2 text-[13px]">
      {/* La bascule et le drapeau sont rendus ici plutôt que dans le layout :
          c'est le seul endroit de l'en-tête qui sache déjà s'il y a quelqu'un de
          connecté, et ni les deux fils ni le filtre n'ont de sens pour un
          visiteur qui ne suit aucune carte. */}
      <ModeSwitch />
      <FrenchOnlyFlag />

      {/* Un réglage, pas une troisième marchandise : d'où un lien discret ici
          plutôt qu'un onglet dans `ModeSwitch`, qui n'oppose que les deux fils. */}
      <Link
        href="/alertes"
        title="Recevoir les annonces neuves de vos cartes sur Telegram"
        className="rounded-lg px-2 py-1.5 text-dim transition hover:text-text"
      >
        Alertes
      </Link>

      <span className="hidden max-w-[18ch] truncate text-faint lg:block" title={user.email}>
        {user.email}
      </span>
      <form action={logout}>
        <button type="submit" className="control">
          Déconnexion
        </button>
      </form>
    </div>
  );
}
