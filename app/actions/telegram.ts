"use server";

import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { clearTelegramCode, startTelegramLink } from "@/lib/store";

export interface CodeResult {
  ok: boolean;
  code?: string;
  error?: string;
}

/**
 * Émet un code d'appairage.
 *
 * Plafonné : chaque appel invalide le code précédent, et un script qui
 * boucherait ici priverait le compte de tout appairage — celui qu'on vient de
 * recopier dans Telegram cesserait de valoir avant d'être envoyé.
 */
export async function requestTelegramCode(): Promise<CodeResult> {
  // Une Server Action est joignable en POST direct : on revérifie tout ici.
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous d’abord." };

  const gate = rateLimit(`telegram:code:${user.id}`, 5, 10 * 60 * 1000);
  if (!gate.ok) {
    return { ok: false, error: `Patientez ${gate.retryAfter} s avant un nouveau code.` };
  }

  const code = await startTelegramLink(user.id);
  if (!code) return { ok: false, error: "Compte introuvable." };

  refresh();
  return { ok: true, code };
}

/** Renonce à l'appairage en cours. Ne délie pas une conversation déjà connectée : voir `/stop`. */
export async function cancelTelegramCode(): Promise<CodeResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous d’abord." };

  await clearTelegramCode(user.id);
  refresh();
  return { ok: true };
}
