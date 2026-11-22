import { createFileRoute } from "@tanstack/react-router";
import { authorizationServerMetadata, oauthJson, oauthPreflight, publicOrigin } from "../lib/oauth";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: async ({ request }) => oauthJson(authorizationServerMetadata(publicOrigin(request))),
      OPTIONS: async () => oauthPreflight(),
    },
  },
});
