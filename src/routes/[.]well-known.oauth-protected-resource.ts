import { createFileRoute } from "@tanstack/react-router";
import { oauthJson, oauthPreflight, protectedResourceMetadata, publicOrigin } from "../lib/oauth";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: async ({ request }) => oauthJson(protectedResourceMetadata(publicOrigin(request))),
      OPTIONS: async () => oauthPreflight(),
    },
  },
});
