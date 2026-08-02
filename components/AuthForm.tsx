"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/actions/auth";

const FIELD =
  "rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm outline-none transition focus:border-line-strong";

export default function AuthForm({
  action,
  mode,
}: {
  action: (state: AuthState | undefined, formData: FormData) => Promise<AuthState>;
  mode: "login" | "register";
}) {
  const [state, submit, pending] = useActionState(action, undefined);
  const isRegister = mode === "register";

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="text-xl font-bold tracking-tight">
        {isRegister ? "Créer un compte" : "Se connecter"}
      </h1>
      <p className="mt-1.5 text-sm text-dim">
        {isRegister
          ? "Votre collection vous suit d’un appareil à l’autre."
          : "Retrouvez votre collection et les annonces du moment."}
      </p>

      <form action={submit} className="mt-6 flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Adresse e-mail</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={state?.email ?? ""}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Mot de passe</span>
          <input
            name="password"
            type="password"
            required
            minLength={isRegister ? 8 : undefined}
            autoComplete={isRegister ? "new-password" : "current-password"}
            className={FIELD}
          />
          {isRegister && <span className="text-[11px] text-faint">8 caractères minimum.</span>}
        </label>

        {state?.error && (
          <p
            role="alert"
            className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2.5 text-sm text-bad"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong disabled:opacity-60"
        >
          {pending ? "…" : isRegister ? "Créer mon compte" : "Se connecter"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-dim">
        {isRegister ? (
          <>
            Déjà inscrit ?{" "}
            <Link href="/connexion" className="font-medium text-accent hover:underline">
              Se connecter
            </Link>
          </>
        ) : (
          <>
            Pas encore de compte ?{" "}
            <Link href="/inscription" className="font-medium text-accent hover:underline">
              En créer un
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
