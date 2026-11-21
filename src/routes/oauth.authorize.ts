import { createFileRoute } from "@tanstack/react-router";
import { beginOAuthAuthorization, completeOAuthAuthorization } from "../lib/mcp-oauth";

export const Route = createFileRoute("/oauth/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => beginOAuthAuthorization(request),
      POST: async ({ request }) => completeOAuthAuthorization(request),
    },
  },
});
