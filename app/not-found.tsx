import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <p className="text-4xl">🔍</p>
      <h1 className="mt-4 text-2xl font-bold">Carte introuvable</h1>
      <p className="mt-2 max-w-md text-sm text-dim">
        Cet identifiant ne correspond à aucune carte de la base TCGdex.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong"
      >
        Retour à ma collection
      </Link>
    </div>
  );
}
