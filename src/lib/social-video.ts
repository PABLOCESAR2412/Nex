import { getAssets } from "./db";

export async function serveSocialVideo(request: Request, media: { asset_key: string; asset_content_type: string }) {
  const bucket = getAssets();
  const isHead = request.method === "HEAD";
  const bodyObject = isHead ? null : await bucket.get(media.asset_key, { range: request.headers });
  const object = isHead ? await bucket.head(media.asset_key) : bodyObject;
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers({
    "content-type": media.asset_content_type,
    "content-length": String(object.size),
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  const range = bodyObject?.range;
  if (!range) return new Response(bodyObject?.body ?? null, { headers });
  const suffix = "suffix" in range ? Math.min(range.suffix, object.size) : null;
  const offset = suffix !== null ? object.size - suffix : "offset" in range ? range.offset ?? 0 : 0;
  const length = suffix ?? ("length" in range ? range.length : undefined) ?? object.size - offset;
  headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
  headers.set("content-length", String(length));
  return new Response(bodyObject.body, { status: 206, headers });
}
