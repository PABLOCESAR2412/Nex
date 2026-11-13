import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../../lib/auth";
import { getAssets, getDb } from "../../lib/db";

export const Route = createFileRoute("/api/content/$id/asset")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await getCurrentSession();
        if (!session) return new Response("Unauthorized", { status: 401 });
        const asset = await getDb()
          .prepare("SELECT asset_key, asset_name, asset_content_type FROM content_items WHERE id = ? AND user_id = ?")
          .bind(params.id, session.userId)
          .first<{ asset_key: string | null; asset_name: string | null; asset_content_type: string | null }>();
        if (!asset?.asset_key) return new Response("Not found", { status: 404 });

        const object = await getAssets().get(asset.asset_key, { range: request.headers });
        if (!object) return new Response("Not found", { status: 404 });

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("content-type", asset.asset_content_type ?? "application/octet-stream");
        headers.set("etag", object.httpEtag);
        headers.set("accept-ranges", "bytes");
        headers.set("cache-control", "private, no-store");
        headers.set("x-content-type-options", "nosniff");

        const filename = (asset.asset_name ?? "archivo").replace(/[\r\n\\"]/g, "_");
        const disposition = asset.asset_content_type === "application/pdf" ? "attachment" : "inline";
        headers.set("content-disposition", `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(asset.asset_name ?? "archivo")}`);

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
          headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
          headers.set("content-length", String(length));
          status = 206;
        } else {
          headers.set("content-length", String(object.size));
        }
        return new Response(object.body, { status, headers });
      },
    },
  },
});
