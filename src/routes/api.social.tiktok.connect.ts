import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { isTikTokConfigured } from "../lib/tiktok";
import { beginTikTokAuthorization } from "../lib/tiktok-workflow";

export const Route = createFileRoute("/api/social/tiktok/connect")({
  server: { handlers: { GET: async ({ request }) => {
    const session = await getCurrentSession();
    if (!session || session.passwordChangeRequired) return Response.redirect(new URL(session ? "/password" : "/login", request.url), 302);
    const origin = new URL(request.url).origin;
    if (!isTikTokConfigured()) return Response.redirect(new URL("/cuentas?tiktok=config", origin), 302);
    try {
      return Response.redirect(await beginTikTokAuthorization(session.userId, origin), 302);
    } catch {
      return Response.redirect(new URL("/cuentas?tiktok=error", origin), 302);
    }
  } } },
});
