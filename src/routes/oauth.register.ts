import { createFileRoute } from "@tanstack/react-router";
import { registerOAuthClient } from "../lib/mcp-oauth";

export const Route = createFileRoute("/oauth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => registerOAuthClient(request),
    },
  },
});
