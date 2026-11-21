import { McpServer, requireScopes, type AuthInfo, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { getAssets, getDb, newId } from "./db";
import { handleInstagramPublishRequest } from "../routes/api.social.instagram.publish";

const SERVER_INSTRUCTIONS = "Nex gestiona piezas, calendario y cuentas sociales del usuario autenticado. Para adjuntar un video usa start_video_upload, sube el archivo en partes base64 de 8 MiB con upload_video_part y termina con complete_video_upload. Las publicaciones públicas requieren petición y confirmación explícitas del usuario.";
const VIDEO_PART_SIZE = 8 * 1024 * 1024;
const MAX_VIDEO_SIZE = 1024 * 1024 * 1024;

type NexMcpContext = {
  era: "legacy" | "modern";
  authInfo?: AuthInfo;
  requestInfo?: Request;
};

type ToolResult = CallToolResult;

type PendingVideoUpload = {
  id: string;
  content_id: string;
  asset_key: string;
  upload_id: string;
  filename: string;
  content_type: string;
  file_size: number;
};

function result(value: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function structuredResult(value: Record<string, string>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function decodeBase64(value: string): ArrayBuffer | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) return null;
  const unpadded = normalized.replace(/=+$/, "");
  if (normalized.includes("=") && normalized.length % 4 !== 0) return null;
  const padded = unpadded + "=".repeat((4 - unpadded.length % 4) % 4);
  try {
    const binary = atob(padded);
    if (btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") !==
        unpadded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  } catch {
    return null;
  }
}

function userIdFrom(context: NexMcpContext) {
  const value = context.authInfo?.extra?.userId;
  return typeof value === "string" ? value : "";
}

async function readPublishResult(request: Request, userId: string, payload: Record<string, unknown>) {
  const response = await handleInstagramPublishRequest(new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), userId);
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

export function createNexMcpServer(context: NexMcpContext) {
  const server = new McpServer({ name: "nex", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS });
  const userId = userIdFrom(context);
  const request = context.requestInfo;

  server.registerTool("list_content", {
    title: "List Nex content",
    description: "Lista las piezas del estudio autenticado, incluidos su estado y datos del archivo adjunto.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("nex:read"),
  }, async () => {
    try {
      const { results } = await getDb().prepare(
        "SELECT id, title, description, script, type, state, channels, asset_name, asset_content_type, asset_size, scheduled_at, created_at, updated_at FROM content_items WHERE user_id = ? ORDER BY updated_at DESC",
      ).bind(userId).all();
      return result(results ?? []);
    } catch {
      return failure("Nex no pudo cargar las piezas de contenido.");
    }
  });

  server.registerTool("get_profile", {
    title: "Get Nex profile",
    description: "Devuelve la identidad estable de la cuenta Nex autorizada en esta conexión.",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({
      id: z.string().min(1).regex(/\S/),
      name: z.string().optional(),
      email: z.string().email().optional(),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("nex:read"),
    _meta: { "openai/profile": true },
  }, async () => {
    try {
      const profile = await getDb().prepare("SELECT id, name, email FROM users WHERE id = ?")
        .bind(userId).first<{ id: string; name: string | null; email: string }>();
      if (!profile?.id?.trim()) return failure("No se pudo identificar la cuenta Nex autorizada.");
      return structuredResult({
        id: profile.id,
        ...(profile.name?.trim() ? { name: profile.name.trim() } : {}),
        email: profile.email,
      });
    } catch {
      return failure("Nex no pudo cargar el perfil autorizado.");
    }
  });

  server.registerTool("create_content", {
    title: "Create a Nex draft",
    description: "Crea un borrador en la biblioteca de Nex. No lo publica en redes.",
    inputSchema: z.object({
      title: z.string().trim().min(1).max(160),
      description: z.string().max(4000).optional(),
      script: z.string().max(20000).optional(),
      type: z.string().max(40).optional(),
      channels: z.string().max(200).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("nex:write"),
  }, async ({ title, description, script, type, channels }) => {
    try {
      const contentId = newId();
      await getDb().prepare(
        "INSERT INTO content_items (id, user_id, title, description, script, type, channels) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(contentId, userId, title, description?.trim() || null, script ?? null, type?.trim() || "video", channels?.trim() || null).run();
      return result({ id: contentId, state: "borrador" });
    } catch {
      return failure("Nex no pudo crear el borrador.");
    }
  });

  server.registerTool("start_video_upload", {
    title: "Start video upload",
    description: "Inicia una carga multipart de un video MP4 o MOV para una pieza propia. Sube partes de 8 MiB y usa el upload_id devuelto en las siguientes llamadas.",
    inputSchema: z.object({
      content_id: z.string().min(1),
      filename: z.string().trim().min(1).max(200),
      content_type: z.enum(["video/mp4", "video/quicktime"]),
      file_size: z.number().int().min(1).max(MAX_VIDEO_SIZE),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("nex:write"),
  }, async ({ content_id, filename, content_type, file_size }) => {
    const db = getDb();
    const content = await db.prepare("SELECT id FROM content_items WHERE id = ? AND user_id = ?")
      .bind(content_id, userId).first<{ id: string }>();
    if (!content) return failure("No se encontró la pieza de contenido del usuario autorizado.");

    const safeFilename = filename.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
    if (!safeFilename) return failure("El archivo necesita un nombre válido.");
    const assetKey = `users/${userId}/content/${content_id}/${newId()}`;
    let multipart: Awaited<ReturnType<R2Bucket["createMultipartUpload"]>> | undefined;
    try {
      multipart = await getAssets().createMultipartUpload(assetKey, { httpMetadata: { contentType: content_type } });
      await db.prepare("INSERT INTO content_uploads (id, content_id, user_id, asset_key, upload_id, filename, content_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(newId(), content_id, userId, assetKey, multipart.uploadId, safeFilename, content_type, file_size).run();
      return result({ upload_id: multipart.uploadId, part_size: VIDEO_PART_SIZE, part_count: Math.ceil(file_size / VIDEO_PART_SIZE) });
    } catch {
      if (multipart) await multipart.abort().catch(() => undefined);
      return failure("Nex no pudo iniciar la carga del video.");
    }
  });

  server.registerTool("upload_video_part", {
    title: "Upload video part",
    description: "Sube una parte base64 estándar de un video iniciado con start_video_upload. Las partes intermedias deben medir 8 MiB; la última puede ser menor.",
    inputSchema: z.object({
      content_id: z.string().min(1),
      upload_id: z.string().min(1),
      part_number: z.number().int().min(1).max(Math.ceil(MAX_VIDEO_SIZE / VIDEO_PART_SIZE)),
      data_base64: z.string().min(1).max(12 * 1024 * 1024),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("nex:write"),
  }, async ({ content_id, upload_id, part_number, data_base64 }) => {
    const pending = await getDb().prepare("SELECT id, content_id, asset_key, upload_id, filename, content_type, file_size FROM content_uploads WHERE upload_id = ? AND content_id = ? AND user_id = ?")
      .bind(upload_id, content_id, userId).first<PendingVideoUpload>();
    if (!pending) return failure("La carga no existe o no pertenece a la cuenta Nex autorizada.");
    const partCount = Math.ceil(pending.file_size / VIDEO_PART_SIZE);
    if (part_number > partCount) return failure("El número de parte supera el tamaño esperado del video.");
    const expectedLength = part_number < partCount ? VIDEO_PART_SIZE : pending.file_size - VIDEO_PART_SIZE * (partCount - 1);
    const body = decodeBase64(data_base64);
    if (!body || body.byteLength !== expectedLength) return failure("La parte no es base64 válido o su tamaño no coincide con el esperado.");
    try {
      const part = await getAssets().resumeMultipartUpload(pending.asset_key, pending.upload_id).uploadPart(part_number, body);
      return result({ part_number: part.partNumber, etag: part.etag });
    } catch {
      return failure("Nex no pudo guardar esta parte del video.");
    }
  });

  server.registerTool("complete_video_upload", {
    title: "Complete video upload",
    description: "Completa la carga con todos los part_number y etag devueltos por upload_video_part. El video queda adjunto a la pieza en Nex.",
    inputSchema: z.object({
      content_id: z.string().min(1),
      upload_id: z.string().min(1),
      parts: z.array(z.object({ part_number: z.number().int().min(1), etag: z.string().min(1).max(256) }).strict()).min(1).max(Math.ceil(MAX_VIDEO_SIZE / VIDEO_PART_SIZE)),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("nex:write"),
  }, async ({ content_id, upload_id, parts }) => {
    const db = getDb();
    const pending = await db.prepare("SELECT id, content_id, asset_key, upload_id, filename, content_type, file_size FROM content_uploads WHERE upload_id = ? AND content_id = ? AND user_id = ?")
      .bind(upload_id, content_id, userId).first<PendingVideoUpload>();
    if (!pending) return failure("La carga no existe o no pertenece a la cuenta Nex autorizada.");
    const expectedCount = Math.ceil(pending.file_size / VIDEO_PART_SIZE);
    if (parts.length !== expectedCount || parts.some((part, index) => part.part_number !== index + 1)) {
      return failure("Incluye todas las partes, en orden y sin duplicados.");
    }

    const current = await db.prepare("SELECT asset_key FROM content_items WHERE id = ? AND user_id = ?")
      .bind(content_id, userId).first<{ asset_key: string | null }>();
    if (!current) return failure("No se encontró la pieza de contenido.");
    let object: R2Object;
    try {
      object = await getAssets().resumeMultipartUpload(pending.asset_key, pending.upload_id).complete(
        parts.map((part) => ({ partNumber: part.part_number, etag: part.etag })),
      );
    } catch {
      return failure("Nex no pudo completar la carga del video.");
    }
    if (object.size !== pending.file_size) {
      await getAssets().delete(pending.asset_key).catch(() => undefined);
      await db.prepare("DELETE FROM content_uploads WHERE id = ? AND user_id = ?").bind(pending.id, userId).run().catch(() => undefined);
      return failure("El video guardado no coincide con el tamaño declarado.");
    }

    let completed: Awaited<ReturnType<typeof db.batch>>;
    try {
      completed = await db.batch([
        db.prepare("UPDATE content_items SET asset_key = ?, asset_name = ?, asset_content_type = ?, asset_size = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
          .bind(pending.asset_key, pending.filename, pending.content_type, object.size, content_id, userId),
        db.prepare("DELETE FROM content_uploads WHERE id = ? AND user_id = ?").bind(pending.id, userId),
      ]);
    } catch {
      await getAssets().delete(pending.asset_key).catch(() => undefined);
      await db.prepare("DELETE FROM content_uploads WHERE id = ? AND user_id = ?").bind(pending.id, userId).run().catch(() => undefined);
      return failure("Nex no pudo adjuntar el video a la pieza.");
    }
    if (completed[0]?.meta.changes !== 1) {
      await getAssets().delete(pending.asset_key).catch(() => undefined);
      return failure("No se pudo adjuntar el video a la pieza.");
    }
    if (current.asset_key && current.asset_key !== pending.asset_key) await getAssets().delete(current.asset_key).catch(() => undefined);
    return result({ ok: true, content_id, filename: pending.filename, file_size: object.size });
  });

  server.registerTool("abort_video_upload", {
    title: "Cancel video upload",
    description: "Cancela y elimina una carga de video incompleta de la cuenta autorizada.",
    inputSchema: z.object({ content_id: z.string().min(1), upload_id: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("nex:write"),
  }, async ({ content_id, upload_id }) => {
    const db = getDb();
    const pending = await db.prepare("SELECT id, content_id, asset_key, upload_id, filename, content_type, file_size FROM content_uploads WHERE upload_id = ? AND content_id = ? AND user_id = ?")
      .bind(upload_id, content_id, userId).first<PendingVideoUpload>();
    if (!pending) return failure("La carga no existe o no pertenece a la cuenta Nex autorizada.");
    await getAssets().resumeMultipartUpload(pending.asset_key, pending.upload_id).abort().catch(() => undefined);
    await db.prepare("DELETE FROM content_uploads WHERE id = ? AND user_id = ?").bind(pending.id, userId).run();
    return result({ ok: true, upload_id });
  });

  server.registerTool("schedule_content", {
    title: "Schedule Nex content",
    description: "Programa una pieza del usuario autenticado para una fecha futura en el calendario de Nex.",
    inputSchema: z.object({ id: z.string().min(1), scheduled_at: z.string().datetime() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("nex:write"),
  }, async ({ id, scheduled_at }) => {
    const date = new Date(scheduled_at);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return failure("La fecha programada debe estar en el futuro.");
    try {
      const scheduledAt = date.toISOString();
      const updated = await getDb().prepare("UPDATE content_items SET state = 'programada', scheduled_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .bind(scheduledAt, id, userId).run();
      if (!updated.meta.changes) return failure("No se encontró la pieza de contenido.");
      return result({ ok: true, id, scheduled_at: scheduledAt });
    } catch {
      return failure("Nex no pudo programar la pieza.");
    }
  });

  server.registerTool("list_instagram_accounts", {
    title: "List connected Instagram accounts",
    description: "Lista las cuentas profesionales de Instagram conectadas al estudio. Devuelve IDs para elegir una cuenta al publicar.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("nex:read"),
  }, async () => {
    try {
      const { results } = await getDb().prepare(
        "SELECT id, handle, status, token_expires_at FROM social_accounts WHERE user_id = ? AND platform = 'Instagram' AND external_account_id IS NOT NULL ORDER BY connected_at DESC",
      ).bind(userId).all<{ id: string; handle: string; status: string; token_expires_at: string | null }>();
      return result(results ?? []);
    } catch {
      return failure("Nex no pudo cargar las cuentas de Instagram.");
    }
  });

  server.registerTool("publish_instagram_reel", {
    title: "Publish an Instagram Reel",
    description: "Inicia la publicación de un Reel en una cuenta de Instagram conectada. Solo usar si el usuario pidió publicar esta pieza y confirmó que se haga pública. Requiere contenido aprobado, video MP4/MOV cargado en Nex y confirm_publish=true.",
    inputSchema: z.object({
      content_id: z.string().min(1),
      account_id: z.string().min(1),
      confirm_publish: z.literal(true),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    scopeChallenge: requireScopes("nex:publish"),
  }, async ({ content_id, account_id, confirm_publish }) => {
    if (!confirm_publish || !request) return failure("Se requiere una petición explícita de publicación y una solicitud HTTP autenticada.");
    try {
      const response = await readPublishResult(request, userId, { action: "start", contentId: content_id, accountId: account_id });
      if (response.status >= 400) return failure(`Nex no pudo iniciar la publicación (HTTP ${response.status}).`);
      return result(response.data);
    } catch {
      return failure("Nex no pudo iniciar la publicación.");
    }
  });

  server.registerTool("check_instagram_publish", {
    title: "Check Instagram publishing status",
    description: "Consulta y avanza el estado de un Reel que ya se está procesando en Instagram.",
    inputSchema: z.object({ job_id: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    scopeChallenge: requireScopes("nex:publish"),
  }, async ({ job_id }) => {
    if (!request) return failure("La solicitud HTTP autenticada no está disponible.");
    try {
      const response = await readPublishResult(request, userId, { action: "check", jobId: job_id });
      if (response.status >= 400) return failure(`Nex no pudo consultar la publicación (HTTP ${response.status}).`);
      return result(response.data);
    } catch {
      return failure("Nex no pudo consultar el estado de publicación.");
    }
  });

  return server;
}
