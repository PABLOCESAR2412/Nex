import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "../lib/db";
import { sha256Hex } from "../lib/instagram";
import { serveSocialVideo } from "../lib/social-video";

async function serveMedia(request: Request, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return new Response(null, { status: 404 });
  const media = await getDb().prepare(`SELECT asset_key, asset_content_type FROM tiktok_upload_jobs
      WHERE media_hash = ? AND media_expires_at > ?`)
    .bind(await sha256Hex(token), new Date().toISOString()).first<{ asset_key: string; asset_content_type: string }>();
  return media ? serveSocialVideo(request, media) : new Response(null, { status: 404 });
}

export const Route = createFileRoute("/api/social/tiktok/media/$token")({
  server: { handlers: {
    GET: ({ request, params }) => serveMedia(request, params.token),
    HEAD: ({ request, params }) => serveMedia(request, params.token),
  } },
});
