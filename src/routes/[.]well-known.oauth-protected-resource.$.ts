import { createFileRoute } from "@tanstack/react-router";
import { oauthJson, oauthPreflight, protectedResourceMetadata, publicOrigin } from "../lib/oauth";

// RFC 9728: los clientes también piden los metadatos con la ruta del recurso añadida (/.well-known/oauth-protected-resource/api/mcp).
export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")({
  server: {
    handlers: {
      GET: async ({ request }) => oauthJson(protectedResourceMetadata(publicOrigin(request))),
      OPTIONS: async () => oauthPreflight(),
    },
  },
});
