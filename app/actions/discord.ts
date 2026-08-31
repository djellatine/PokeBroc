"use server";

import { getCurrentUser } from "@/lib/auth";
import { sendTest } from "@/lib/discord";
import { rateLimit } from "@/lib/rate-limit";

export interface TestResult {
  ok: boolean;
  error?: string;
}

/**
 * Envoie un message de test au webhook, pour vérifier qu'il pointe bien où il
 * faut. Plafonné : un bouton n'a pas à pouvoir inonder le salon.
 */
export async function testDiscord(): Promise<TestResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Connectez-vous d’abord." };

  const gate = rateLimit(`discord:test:${user.id}`, 3, 60 * 1000);
  if (!gate.ok) {
    return { ok: false, error: `Patientez ${gate.retryAfter} s avant un nouveau test.` };
  }

  return sendTest();
}
