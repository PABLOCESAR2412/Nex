import { createFileRoute } from "@tanstack/react-router";
import { protectedResourceMetadata } from "../lib/mcp-oauth";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/api/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => Response.json(protectedResourceMetadata(new URL(request.url).origin), {
        headers: { "cache-control": "public, max-age=300", "content-type": "application/json" },
      }),
    },
  },
});
