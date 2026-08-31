"use client";

import { useState, useTransition } from "react";
import { testDiscord } from "@/app/actions/discord";

/**
 * Bouton « envoyer un message de test » : le seul moyen sûr de vérifier que le
 * webhook pointe vraiment vers le bon salon avant de compter dessus.
 */
export default function DiscordTest() {
  const [state, setState] = useState<{ tone: "idle" | "ok" | "error"; message: string }>({
    tone: "idle",
    message: "",
  });
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await testDiscord();
      setState(
        result.ok
          ? { tone: "ok", message: "Envoyé — regardez votre salon Discord." }
          : { tone: "error", message: result.error ?? "Échec de l’envoi." },
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={run} disabled={pending} className="control">
        {pending ? "Envoi…" : "Envoyer un message de test"}
      </button>
      {state.tone !== "idle" && (
        <span className={`text-xs ${state.tone === "ok" ? "text-good" : "text-bad"}`}>
          {state.message}
        </span>
      )}
    </div>
  );
}
