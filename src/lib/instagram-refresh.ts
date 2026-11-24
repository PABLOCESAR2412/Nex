import { createServerOnlyFn } from "@tanstack/react-start";
import { getDb } from "./db";
import { decryptInstagramToken, encryptInstagramToken } from "./instagram";

// Los tokens de larga duración de Instagram vencen a los 60 días y solo se pueden renovar mientras siguen
// vigentes (y tras 24 horas de vida). Se renuevan cuando les quedan menos de 14 días.
const RENEW_WHEN_LESS_THAN_MS = 14 * 24 * 3600_000;
const MIN_TOKEN_AGE_MS = 24 * 3600_000;

/** El cron corre cada minuto; la renovación de tokens basta una vez por hora. */
export function isHourlyTick(scheduledTime: number) {
  return new Date(scheduledTime).getUTCMinutes() === 0;
}

type AccountRow = { id: string; token_ciphertext: string; token_iv: string; token_expires_at: string; updated_at: string };

/** Renueva los tokens de Instagram próximos a vencer. Devuelve cuántos renovó y cuántos fallaron. */
export const refreshInstagramTokens = createServerOnlyFn(async (now = new Date()) => {
  const db = getDb();
  const { results } = await db
    .prepare("SELECT id, token_ciphertext, token_iv, token_expires_at, updated_at FROM social_accounts WHERE platform = 'Instagram' AND status = 'conectada' AND token_ciphertext IS NOT NULL AND token_iv IS NOT NULL AND token_expires_at IS NOT NULL AND token_expires_at > ? AND token_expires_at <= ? LIMIT 20")
    .bind(now.toISOString(), new Date(now.getTime() + RENEW_WHEN_LESS_THAN_MS).toISOString())
    .all<AccountRow>();
  let renewed = 0;
  let failed = 0;
  for (const account of results ?? []) {
    // updated_at en formato SQLite («YYYY-MM-DD HH:MM:SS», UTC): un token recién conectado aún no puede renovarse.
    if (now.getTime() - Date.parse(account.updated_at.replace(" ", "T") + "Z") < MIN_TOKEN_AGE_MS) continue;
    try {
      const token = await decryptInstagramToken(account.token_ciphertext, account.token_iv);
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", token);
      const response = await fetch(url);
      const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: { message?: string } } | null;
      if (!response.ok || !body?.access_token || typeof body.expires_in !== "number") throw new Error(body?.error?.message ?? "Instagram no devolvió un token renovado.");
      const sealed = await encryptInstagramToken(body.access_token);
      await db.prepare("UPDATE social_accounts SET token_ciphertext = ?, token_iv = ?, token_expires_at = ?, updated_at = datetime('now') WHERE id = ? AND platform = 'Instagram'")
        .bind(sealed.ciphertext, sealed.iv, new Date(now.getTime() + body.expires_in * 1000).toISOString(), account.id)
        .run();
      renewed++;
    } catch (error) {
      failed++;
      console.error("instagram token refresh failed", account.id, error instanceof Error ? error.message : error);
    }
  }
  return { renewed, failed };
});
