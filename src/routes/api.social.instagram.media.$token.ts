import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";
import { getAssets, getDb } from "../lib/db";
import { sha256Hex } from "../lib/instagram";

const serveMedia = createServerOnlyFn(async (request: Request, token: string) => {
  const tokenHash = await sha256Hex(token);
  const grant = await getDb()
    .prepare(`SELECT COALESCE(g.asset_key, c.asset_key) AS asset_key,
      COALESCE(g.asset_content_type, c.asset_content_type) AS asset_content_type
      FROM instagram_media_grants g JOIN content_items c ON c.id = g.content_id AND c.user_id = g.user_id
      WHERE g.token_hash = ? AND g.expires_at > ?
      AND (g.job_id IS NULL OR EXISTS (
        SELECT 1 FROM instagram_publish_jobs j WHERE j.id = g.job_id AND j.status IN ('creating', 'processing', 'publishing')
      ))`)
    .bind(tokenHash, new Date().toISOString())
    .first<{ asset_key: string | null; asset_content_type: string | null }>();
  const assetKey = grant?.asset_key;
  const contentType = grant?.asset_content_type;
  if (!assetKey || !contentType || !["video/mp4", "video/quicktime"].includes(contentType)) {
    return new Response("Not found", { status: 404 });
  }

  const bucket = getAssets();
  const head = request.method === "HEAD";
  const bodyObject = head ? null : await bucket.get(assetKey, { range: request.headers });
  const object = head ? await bucket.head(assetKey) : bodyObject;
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", contentType);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", "inline");
  headers.set("x-content-type-options", "nosniff");
  let status = 200;
  if (object.range) {
    const range = object.range;
    let start: number;
    let length: number;
    if ("suffix" in range) {
      length = Math.min(range.suffix, object.size);
      start = object.size - length;
    } else {
      const offset = "offset" in range ? range.offset : undefined;
      const requestedLength = "length" in range ? range.length : undefined;
      if (offset !== undefined) {
        start = offset;
        length = requestedLength ?? object.size - start;
      } else {
        length = requestedLength ?? object.size;
        start = object.size - length;
      }
    }
    headers.set("content-range", "bytes " + start + "-" + (start + length - 1) + "/" + object.size);
    headers.set("content-length", String(length));
    status = 206;
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(bodyObject?.body ?? null, { status, headers });
});

export const Route = createFileRoute("/api/social/instagram/media/$token")({
  server: {
    handlers: {
      GET: ({ params, request }) => serveMedia(request, params.token),
      HEAD: ({ params, request }) => serveMedia(request, params.token),
    },
  },
});
