import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { disconnectTikTokAccount } from "../lib/tiktok-workflow";

export const Route = createFileRoute("/api/social/tiktok/disconnect")({
  server: { handlers: { POST: async ({ request }) => {
    const session = await getCurrentSession();
    if (!session || session.passwordChangeRequired) return Response.json({ error: "Inicia sesión para gestionar las cuentas." }, { status: 401 });
    const input = await request.json().catch(() => null) as { accountId?: unknown } | null;
    if (typeof input?.accountId !== "string") return Response.json({ error: "Falta la cuenta." }, { status: 400 });
    const removed = await disconnectTikTokAccount(session.userId, input.accountId);
    return removed ? Response.json({ ok: true }) : Response.json({ error: "No se encontró la cuenta." }, { status: 404 });
  } } },
});
