import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { handleInstagramPublishRequest } from "../lib/instagram-publish";
import { getMcpUserId } from "../lib/mcp";

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/social/instagram/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getCurrentSession();
        const userId = session?.userId ?? await getMcpUserId(request);
        if (!userId) return fail("Conecta una sesión o una clave MCP válida para publicar.", 401);
        return handleInstagramPublishRequest(request, userId);
      },
    },
  },
});
