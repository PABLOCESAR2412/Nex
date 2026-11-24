import { createFileRoute } from "@tanstack/react-router";
import { handleInstagramPublishRequest } from "../lib/instagram-publish";
import { getRequestAuth, hasScope } from "../lib/mcp";

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/social/instagram/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getRequestAuth(request);
        if (!auth) return fail("Conecta una sesión o una clave MCP válida para publicar.", 401);
        if (!hasScope(auth, "nex:publish")) return fail("Esta conexión MCP no tiene el permiso nex:publish.", 403);
        return handleInstagramPublishRequest(request, auth.userId);
      },
    },
  },
});
