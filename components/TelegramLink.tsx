"use client";

import { useState, useTransition } from "react";
import { cancelTelegramCode, requestTelegramCode } from "@/app/actions/telegram";

/**
 * Appairage Telegram, côté navigateur.
 *
 * Le code n'est pas rendu par le serveur au chargement : il n'existe qu'après
 * un geste explicite. Un code affiché d'office serait un secret publié à chaque
 * visite — y compris sur un écran laissé ouvert — alors qu'il n'a de raison
 * d'être qu'au moment précis où l'on ouvre Telegram.
 *
 * Le compte à rebours est un confort, pas une garde : la péremption est tenue
 * par `findUserByTelegramCode()`, côté serveur, qui est seul à décider.
 */
export default function TelegramLink({
  botName,
  ttlMs,
  pendingCode,
}: {
  /** Nom du bot, sans `@`. Absent : la consigne manuelle remplace le lien profond. */
  botName: string | null;
  ttlMs: number;
  /** Code déjà émis et encore valide, repris au rechargement de la page. */
  pendingCode: string | null;
}) {
  const [code, setCode] = useState<string | null>(pendingCode);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const ask = () =>
    start(async () => {
      setError(null);
      const result = await requestTelegramCode();
      if (result.ok && result.code) setCode(result.code);
      else setError(result.error ?? "Impossible d’émettre un code.");
    });

  const cancel = () =>
    start(async () => {
      await cancelTelegramCode();
      setCode(null);
      setCopied(false);
    });

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papier refusé (page non sécurisée, permission) : le code reste
      // affiché en grand, il se retape en six caractères.
      setCopied(false);
    }
  };

  if (!code) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={ask}
          disabled={pending}
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong disabled:opacity-50"
        >
          {pending ? "Un instant…" : "Obtenir un code"}
        </button>
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
    );
  }

  const minutes = Math.round(ttlMs / 60000);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-lg border border-line-strong bg-panel-2 px-4 py-2 font-mono text-2xl font-bold tracking-[0.3em]">
          {code}
        </code>
        <button type="button" onClick={copy} className="control">
          {copied ? "Copié" : "Copier"}
        </button>
        {botName && (
          <a
            href={`https://t.me/${botName}?start=${code}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong"
          >
            Ouvrir Telegram
          </a>
        )}
      </div>

      <p className="text-xs leading-relaxed text-dim">
        {botName ? (
          <>
            « Ouvrir Telegram » lance la conversation avec le code déjà saisi ; il ne reste qu’à
            l’envoyer. Sinon, écrivez ce code au bot{" "}
            <span className="font-mono text-text">@{botName}</span>.
          </>
        ) : (
          <>Envoyez ce code en message au bot Telegram du site.</>
        )}{" "}
        Il vaut {minutes} minutes, et la connexion s’établit au passage suivant de la veille.
      </p>

      <button type="button" onClick={cancel} disabled={pending} className="self-start text-xs text-faint underline">
        Annuler ce code
      </button>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
