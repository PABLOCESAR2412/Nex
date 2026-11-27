import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { handleTikTokUploadRequest } from "../lib/tiktok-workflow";

export const Route = createFileRoute("/api/social/tiktok/upload")({
  server: { handlers: { POST: async ({ request }) => {
    const session = await getCurrentSession();
    if (!session || session.passwordChangeRequired) return Response.json({ error: "Inicia sesión para enviar videos a TikTok." }, { status: 401 });
    return handleTikTokUploadRequest(request, session.userId);
  } } },
});
