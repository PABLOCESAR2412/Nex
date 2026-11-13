import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../../lib/auth";
import { getAssets, getDb, newId } from "../../lib/db";

const PART_SIZE = 8 * 1024 * 1024;
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type PendingUpload = {
  id: string;
  content_id: string;
  asset_key: string;
  upload_id: string;
  filename: string;
  content_type: string;
  file_size: number;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/content/$id/upload")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await getCurrentSession();
        if (!session) return jsonError("Inicia sesión para subir archivos.", 401);

        const db = getDb();
        const content = await db
          .prepare("SELECT id FROM content_items WHERE id = ? AND user_id = ?")
          .bind(params.id, session.userId)
          .first<{ id: string }>();
        if (!content) return jsonError("No se encontró la pieza.", 404);

        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        if (action === "start") {
          let input: { filename?: unknown; contentType?: unknown; size?: unknown };
          try {
            input = await request.json();
          } catch {
            return jsonError("La solicitud no contiene datos válidos.", 400);
          }
          if (
            typeof input.filename !== "string" ||
            typeof input.contentType !== "string" ||
            typeof input.size !== "number" ||
            !Number.isSafeInteger(input.size) ||
            input.size < 1 ||
            input.size > MAX_FILE_SIZE ||
            !ALLOWED_TYPES.has(input.contentType)
          ) {
            return jsonError("Usa un video, imagen o PDF de hasta 5 GiB.", 400);
          }

          const filename = input.filename.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
          if (!filename) return jsonError("El archivo necesita un nombre válido.", 400);

          const assetKey = `users/${session.userId}/content/${params.id}/${newId()}`;
          const upload = await getAssets().createMultipartUpload(assetKey, {
            httpMetadata: { contentType: input.contentType },
          });
          const uploadRowId = newId();
          try {
            await db
              .prepare("INSERT INTO content_uploads (id, content_id, user_id, asset_key, upload_id, filename, content_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(uploadRowId, params.id, session.userId, assetKey, upload.uploadId, filename, input.contentType, input.size)
              .run();
          } catch {
            await upload.abort().catch(() => undefined);
            return jsonError("No se pudo iniciar la carga del archivo.", 500);
          }
          return Response.json({ uploadId: upload.uploadId, partSize: PART_SIZE });
        }

        if (action === "complete") {
          let input: { uploadId?: unknown; parts?: unknown };
          try {
            input = await request.json();
          } catch {
            return jsonError("La solicitud no contiene datos válidos.", 400);
          }
          if (typeof input.uploadId !== "string" || !Array.isArray(input.parts)) {
            return jsonError("Faltan las partes del archivo.", 400);
          }
          const upload = await db
            .prepare("SELECT id, content_id, asset_key, upload_id, filename, content_type, file_size FROM content_uploads WHERE upload_id = ? AND content_id = ? AND user_id = ?")
            .bind(input.uploadId, params.id, session.userId)
            .first<PendingUpload>();
          if (!upload) return jsonError("La carga ya no existe o no te pertenece.", 404);

          const partCount = Math.ceil(upload.file_size / PART_SIZE);
          const parts = input.parts as Array<{ partNumber?: unknown; etag?: unknown }>;
          if (
            parts.length !== partCount ||
            parts.some((part, index) => part.partNumber !== index + 1 || typeof part.etag !== "string" || !part.etag)
          ) {
            return jsonError("La carga está incompleta. Vuelve a intentarlo.", 400);
          }

          const current = await db
            .prepare("SELECT asset_key FROM content_items WHERE id = ? AND user_id = ?")
            .bind(params.id, session.userId)
            .first<{ asset_key: string | null }>();
          if (!current) return jsonError("No se encontró la pieza.", 404);

          const multipart = getAssets().resumeMultipartUpload(upload.asset_key, upload.upload_id);
          let object: R2Object;
          try {
            object = await multipart.complete(parts as R2UploadedPart[]);
          } catch {
            return jsonError("No se pudo completar el archivo. Comprueba la conexión e inténtalo otra vez.", 400);
          }

          try {
            const [result] = await db.batch([
              db.prepare("UPDATE content_items SET asset_key = ?, asset_name = ?, asset_content_type = ?, asset_size = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
                .bind(upload.asset_key, upload.filename, upload.content_type, object.size, params.id, session.userId),
              db.prepare("DELETE FROM content_uploads WHERE id = ? AND user_id = ?").bind(upload.id, session.userId),
            ]);
            if (!result.meta.changes) throw new Error("No se encontró la pieza.");
          } catch {
            await getAssets().delete(upload.asset_key).catch(() => undefined);
            return jsonError("El archivo llegó, pero no se pudo guardar en la pieza.", 500);
          }

          if (current.asset_key && current.asset_key !== upload.asset_key) {
            await getAssets().delete(current.asset_key).catch(() => undefined);
          }
          return Response.json({ ok: true, name: upload.filename, size: object.size });
        }

        if (action === "abort") {
          const uploadId = url.searchParams.get("uploadId");
          if (!uploadId) return jsonError("Falta el identificador de carga.", 400);
          const upload = await db
            .prepare("SELECT id, content_id, asset_key, upload_id, filename, content_type, file_size FROM content_uploads WHERE upload_id = ? AND content_id = ? AND user_id = ?")
            .bind(uploadId, params.id, session.userId)
            .first<PendingUpload>();
          if (!upload) return Response.json({ ok: true });
          try { await getAssets().resumeMultipartUpload(upload.asset_key, upload.upload_id).abort(); } catch {}
          await db.prepare("DELETE FROM content_uploads WHERE id = ? AND user_id = ?").bind(upload.id, session.userId).run();
          return Response.json({ ok: true });
        }

        return jsonError("Acción de carga desconocida.", 400);
      },
      PUT: async ({ request, params }) => {
        const session = await getCurrentSession();
        if (!session) return jsonError("Inicia sesión para subir archivos.", 401);

        const url = new URL(request.url);
        if (request.method === "POST" && !["start", "complete", "abort"].includes(url.searchParams.get("action") ?? "")) {
          return jsonError("Acción de carga desconocida.", 400);
        }
        const uploadId = url.searchParams.get("uploadId");
        const partNumber = Number(url.searchParams.get("partNumber"));
        if (url.searchParams.get("action") !== "part" || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || !request.body) {
          return jsonError("Faltan datos para subir esta parte.", 400);
        }

        const upload = await getDb()
          .prepare("SELECT id, content_id, asset_key, upload_id, filename, content_type, file_size FROM content_uploads WHERE upload_id = ? AND content_id = ? AND user_id = ?")
          .bind(uploadId, params.id, session.userId)
          .first<PendingUpload>();
        if (!upload) return jsonError("La carga ya no existe o no te pertenece.", 404);
        const partCount = Math.ceil(upload.file_size / PART_SIZE);
        if (partNumber > partCount || partNumber > 10000) return jsonError("Número de parte no válido.", 400);
        const expectedLength = partNumber < partCount ? PART_SIZE : upload.file_size - PART_SIZE * (partCount - 1);
        if (Number(request.headers.get("content-length")) !== expectedLength) return jsonError("El tamaño de esta parte no coincide con el archivo.", 400);

        try {
          const part = await getAssets().resumeMultipartUpload(upload.asset_key, upload.upload_id).uploadPart(partNumber, request.body);
          return Response.json(part);
        } catch {
          return jsonError("No se pudo subir esta parte. Inténtalo otra vez.", 400);
        }
      },
    },
  },
});
