import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { startTikTokAuthorization } from "../lib/tiktok";

export const Route = createFileRoute("/api/social/tiktok/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getCurrentSession();
        if (!session) return Response.redirect(new URL("/login", request.url), 302);
        try {
          return Response.redirect(await startTikTokAuthorization(session.userId, new URL(request.url).origin), 302);
        } catch (error) {
          const status = error instanceof Error && /requiere configurar|requiere PUBLIC_APP_URL|debe tener al menos|debe ser solo el origen|debe usar HTTPS|Falta la clave/.test(error.message) ? "config" : "error";
          return Response.redirect(new URL("/cuentas?tiktok=" + status, request.url), 302);
        }
      },
    },
  },
});
