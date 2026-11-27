import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { completeTikTokAuthorization } from "../lib/tiktok-workflow";

export const Route = createFileRoute("/api/social/tiktok/callback")({
  server: { handlers: { GET: async ({ request }) => {
    const url = new URL(request.url);
    const done = (status: string) => Response.redirect(new URL(`/cuentas?tiktok=${status}`, url), 302);
    const session = await getCurrentSession();
    if (!session || session.passwordChangeRequired) return done("expired");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.searchParams.get("error") === "access_denied") return done("denied");
    if (!code || !state || code.length > 1024 || state.length > 128) return done("invalid");
    try {
      return done(await completeTikTokAuthorization(session.userId, url.origin, code, state));
    } catch {
      return done("error");
    }
  } } },
});
