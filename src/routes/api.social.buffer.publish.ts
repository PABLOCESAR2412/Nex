import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { handleBufferPublishRequest } from "../lib/buffer-workflow";

export const Route = createFileRoute("/api/social/buffer/publish")({
  server: { handlers: { POST: async ({ request }) => {
    if (request.headers.get("Origin") !== new URL(request.url).origin) return Response.json({ error: "Origen no permitido." }, { status: 403 });
    const session = await getCurrentSession();
    if (!session || session.passwordChangeRequired) return Response.json({ error: "Inicia sesión para enviar videos a Buffer." }, { status: 401 });
    return handleBufferPublishRequest(request, session.userId);
  } } },
});
