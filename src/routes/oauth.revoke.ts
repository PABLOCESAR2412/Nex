import { createFileRoute } from "@tanstack/react-router";
import { revokeOAuthToken } from "../lib/mcp-oauth";

export const Route = createFileRoute("/oauth/revoke")({
  server: {
    handlers: {
      POST: async ({ request }) => revokeOAuthToken(request),
    },
  },
});
