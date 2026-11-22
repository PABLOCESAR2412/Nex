import { createFileRoute } from "@tanstack/react-router";
import { oauthJson, oauthPreflight, registerOAuthClient } from "../lib/oauth";

export const Route = createFileRoute("/oauth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: unknown;
        try { input = await request.json(); } catch { return oauthJson({ error: "invalid_client_metadata", error_description: "El cuerpo debe ser JSON." }, 400); }
        const result = await registerOAuthClient(input);
        return oauthJson(result.body, result.status);
      },
      OPTIONS: async () => oauthPreflight(),
    },
  },
});
