import { createFileRoute } from "@tanstack/react-router";
import { exchangeOAuthToken } from "../lib/mcp-oauth";

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => exchangeOAuthToken(request),
    },
  },
});
