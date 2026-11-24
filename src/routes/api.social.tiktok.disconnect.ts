import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { failOpenPublicationsForAccount } from "../lib/publications";
import { disconnectTikTokAccount } from "../lib/tiktok";

export const Route = createFileRoute("/api/social/tiktok/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getCurrentSession();
        if (!session) return Response.json({ error: "Inicia sesión para gestionar las cuentas." }, { status: 401 });
        let input: { accountId?: unknown };
        try { input = await request.json(); } catch { return Response.json({ error: "Solicitud no válida." }, { status: 400 }); }
        if (typeof input.accountId !== "string") return Response.json({ error: "Falta la cuenta." }, { status: 400 });
        if (!(await disconnectTikTokAccount(session.userId, input.accountId))) return Response.json({ error: "No se encontró la cuenta." }, { status: 404 });
        await failOpenPublicationsForAccount(session.userId, input.accountId, "Cuenta desconectada antes de terminar la publicación.");
        return Response.json({ ok: true });
      },
    },
  },
});
