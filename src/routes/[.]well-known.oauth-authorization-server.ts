import { createFileRoute } from "@tanstack/react-router";
import { authorizationServerMetadata } from "../lib/mcp-oauth";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: async ({ request }) => Response.json(authorizationServerMetadata(new URL(request.url).origin), {
        headers: { "cache-control": "public, max-age=300", "content-type": "application/json" },
      }),
    },
  },
});
