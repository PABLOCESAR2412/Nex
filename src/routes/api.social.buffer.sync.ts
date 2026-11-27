import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { syncBufferAccounts } from "../lib/buffer-workflow";

export const Route = createFileRoute("/api/social/buffer/sync")({
  server: { handlers: { POST: async ({ request }) => {
    const origin = request.headers.get("Origin");
    if (origin !== new URL(request.url).origin) return Response.json({ error: "Origen no permitido." }, { status: 403 });
    const session = await getCurrentSession();
    if (!session || session.passwordChangeRequired) return Response.json({ error: "Inicia sesión para sincronizar Buffer." }, { status: 401 });
    return syncBufferAccounts(session.userId);
  } } },
});
