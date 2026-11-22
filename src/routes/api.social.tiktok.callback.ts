import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeEnv } from "../lib/db";
import { completeTikTokConnection } from "../lib/tiktok";

function resultRedirect(status: string, requestOrigin: string) {
  const base = getRuntimeEnv().PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || requestOrigin;
  return Response.redirect(base + "/cuentas?tiktok=" + encodeURIComponent(status), 302);
}

export const Route = createFileRoute("/api/social/tiktok/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.has("error")) return resultRedirect("denied", url.origin);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return resultRedirect("invalid", url.origin);
        try {
          return resultRedirect(await completeTikTokConnection(code, state, url.origin), url.origin);
        } catch {
          return resultRedirect("error", url.origin);
        }
      },
    },
  },
});
