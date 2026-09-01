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
    <div className="flex shrink-0 items-center gap-1 text-[13px] sm:gap-2">
      {/* La bascule et le drapeau sont rendus ici plutôt que dans le layout :
          c'est le seul endroit de l'en-tête qui sache déjà s'il y a quelqu'un de
          connecté, et ni les deux fils ni le filtre n'ont de sens pour un
          visiteur qui ne suit aucune carte. */}
      <ModeSwitch />
      <FrenchOnlyFlag />

      {/* Un réglage, pas une troisième marchandise : d'où un lien discret ici
          plutôt qu'un onglet dans `ModeSwitch`, qui n'oppose que les deux fils.
          Icône seule sur mobile : le libellé ne tenait plus sur la rangée. */}
      <Link
        href="/alertes"
        title="Recevoir les annonces neuves de vos cartes sur Discord"
        aria-label="Alertes"
        className="rounded-lg px-2 py-1.5 text-dim transition hover:text-text"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4 sm:hidden"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span className="hidden sm:inline">Alertes</span>
      </Link>

      <span className="hidden max-w-[18ch] truncate text-faint lg:block" title={user.email}>
        {user.email}
      </span>
      <form action={logout}>
        <button type="submit" className="control" title="Déconnexion" aria-label="Déconnexion">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="h-4 w-4 sm:hidden"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="hidden sm:inline">Déconnexion</span>
        </button>
      </form>
    </div>
  );
}
