import { createFileRoute } from "@tanstack/react-router";
import { getDb, getRuntimeEnv, newId } from "../lib/db";
import { encryptInstagramToken, instagramConfig, randomSecret, sha256Hex } from "../lib/instagram";

type TokenResponse = { access_token?: string; user_id?: string | number; expires_in?: number; error_message?: string };
type ProfileResponse = { user_id?: string | number; id?: string | number; username?: string };

function resultRedirect(status: string, requestOrigin: string) {
  const base = getRuntimeEnv().PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || requestOrigin;
  if (!base) return new Response("Instagram callback configuration is missing.", { status: 503 });
  return Response.redirect(base + "/cuentas?instagram=" + encodeURIComponent(status), 302);
}

export const Route = createFileRoute("/api/social/instagram/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const requestOrigin = url.origin;
        if (url.searchParams.has("error")) return resultRedirect("denied", requestOrigin);

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return resultRedirect("invalid", requestOrigin);

        try {
          const db = getDb();
          const stateRow = await db
            .prepare("DELETE FROM instagram_oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING user_id")
            .bind(await sha256Hex(state), new Date().toISOString())
            .first<{ user_id: string }>();
          if (!stateRow) return resultRedirect("expired", requestOrigin);

          const config = instagramConfig(requestOrigin);
          const form = new FormData();
          form.set("client_id", config.appId);
          form.set("client_secret", config.appSecret);
          form.set("grant_type", "authorization_code");
          form.set("redirect_uri", config.redirectUri);
          form.set("code", code);

          const shortResponse = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
          const shortToken = await shortResponse.json().catch(() => null) as TokenResponse | null;
          if (!shortResponse.ok || !shortToken?.access_token) return resultRedirect("token_error", requestOrigin);

          const exchangeUrl = new URL("https://graph.instagram.com/access_token");
          exchangeUrl.searchParams.set("grant_type", "ig_exchange_token");
          exchangeUrl.searchParams.set("client_secret", config.appSecret);
          exchangeUrl.searchParams.set("access_token", shortToken.access_token);
          const longResponse = await fetch(exchangeUrl);
          const longToken = await longResponse.json().catch(() => null) as TokenResponse | null;
          if (!longResponse.ok || !longToken?.access_token) return resultRedirect("token_error", requestOrigin);

          const profileUrl = new URL("https://graph.instagram.com/" + config.graphVersion + "/me");
          profileUrl.searchParams.set("fields", "user_id,username");
          const profileResponse = await fetch(profileUrl, {
            headers: { authorization: "Bearer " + longToken.access_token },
          });
          const profile = await profileResponse.json().catch(() => null) as ProfileResponse | null;
          const externalId = profile?.user_id ?? profile?.id ?? longToken.user_id ?? shortToken.user_id;
          if (!profileResponse.ok || !externalId || !profile?.username) return resultRedirect("profile_error", requestOrigin);

          const encrypted = await encryptInstagramToken(longToken.access_token);
          const accountId = newId();
          const expiresIn = typeof longToken.expires_in === "number" ? longToken.expires_in : 60 * 24 * 60 * 60;
          const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
          await db.prepare(
            "INSERT INTO social_accounts (id, user_id, platform, handle, status, external_account_id, token_ciphertext, token_iv, token_expires_at, connected_at, updated_at) VALUES (?, ?, 'Instagram', ?, 'conectada', ?, ?, ?, ?, datetime('now'), datetime('now')) ON CONFLICT(user_id, platform, external_account_id) WHERE external_account_id IS NOT NULL DO UPDATE SET handle = excluded.handle, status = 'conectada', token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv, token_expires_at = excluded.token_expires_at, connected_at = datetime('now'), updated_at = datetime('now')")
            .bind(accountId, stateRow.user_id, "@" + profile.username, String(externalId), encrypted.ciphertext, encrypted.iv, expiresAt)
            .run();
          return resultRedirect("connected", requestOrigin);
        } catch {
          return resultRedirect("error", requestOrigin);
        }
      },
    },
  },
});
