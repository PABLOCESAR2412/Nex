import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { disconnectBufferAccount } from "../lib/buffer-workflow";

export const Route = createFileRoute("/api/social/buffer/disconnect")({
  server: { handlers: { POST: async ({ request }) => {
    if (request.headers.get("Origin") !== new URL(request.url).origin) return Response.json({ error: "Origen no permitido." }, { status: 403 });
    const session = await getCurrentSession();
    if (!session || session.passwordChangeRequired) return Response.json({ error: "Inicia sesión para gestionar cuentas." }, { status: 401 });
    const input = await request.json().catch(() => null) as { accountId?: unknown } | null;
    if (typeof input?.accountId !== "string") return Response.json({ error: "Falta la cuenta." }, { status: 400 });
    return disconnectBufferAccount(session.userId, input.accountId);
  } } },
});
