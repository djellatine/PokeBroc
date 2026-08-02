"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dropFavorite, saveFavorite, type FavoriteInput } from "@/app/actions/favorites";

export default function FavoriteButton({
  card,
  initiallySaved,
  isLoggedIn,
}: {
  card: FavoriteInput;
  initiallySaved: boolean;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (!isLoggedIn) {
      router.push("/connexion");
      return;
    }

    const wanted = !saved;
    setSaved(wanted);
    setError(null);

    startTransition(async () => {
      const result = wanted ? await saveFavorite(card) : await dropFavorite(card.cardId);
      if (!result.ok) {
        setSaved(!wanted);
        setError(result.error ?? "Action impossible.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
          saved
            ? "border border-accent/70 bg-accent/10 text-accent"
            : "bg-accent text-accent-ink hover:bg-accent-strong"
        }`}
      >
        {saved ? "✓ Dans ma collection" : "+ Ajouter à ma collection"}
      </button>

      {!isLoggedIn && (
        <p className="text-center text-[11px] text-faint">
          Un compte est nécessaire pour épingler une carte.
        </p>
      )}
      {error && (
        <p role="alert" className="text-center text-[11px] text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
