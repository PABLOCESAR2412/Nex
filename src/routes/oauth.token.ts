import { createFileRoute } from "@tanstack/react-router";
import { exchangeOAuthToken, oauthJson, oauthPreflight } from "../lib/oauth";

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/x-www-form-urlencoded")) {
          return oauthJson({ error: "invalid_request", error_description: "Usa application/x-www-form-urlencoded." }, 400);
        }
        const result = await exchangeOAuthToken(new URLSearchParams(await request.text()));
        return oauthJson(result.body, result.status);
      },
      OPTIONS: async () => oauthPreflight(),
    },
  },
});
