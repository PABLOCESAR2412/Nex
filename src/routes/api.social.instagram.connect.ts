import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { getDb } from "../lib/db";
import { instagramConfig, randomSecret, sha256Hex } from "../lib/instagram";

export const Route = createFileRoute("/api/social/instagram/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getCurrentSession();
        if (!session) return Response.redirect(new URL("/login", request.url), 302);

        try {
          const config = instagramConfig(new URL(request.url).origin);
          const state = randomSecret();
          const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
          const db = getDb();
          await db.prepare("DELETE FROM instagram_oauth_states WHERE expires_at <= ?").bind(new Date().toISOString()).run();
          await db.prepare("INSERT INTO instagram_oauth_states (state_hash, user_id, expires_at) VALUES (?, ?, ?)")
            .bind(await sha256Hex(state), session.userId, expiresAt)
            .run();

          const authorization = new URL("https://www.instagram.com/oauth/authorize");
          authorization.searchParams.set("client_id", config.appId);
          authorization.searchParams.set("redirect_uri", config.redirectUri);
          authorization.searchParams.set("response_type", "code");
          authorization.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
          authorization.searchParams.set("state", state);
          return Response.redirect(authorization.toString(), 302);
        } catch (error) {
          const status = error instanceof Error && /requiere configurar|debe tener al menos|debe ser solo el origen|debe usar HTTPS/.test(error.message) ? "config" : "error";
          return Response.redirect(new URL("/cuentas?instagram=" + status, request.url), 302);
        }
      },
    },
  },
});
