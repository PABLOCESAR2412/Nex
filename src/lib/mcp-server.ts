import { McpServer, requireScopes, type AuthInfo, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { getAssets, getDb, newId } from "./db";
import { handleInstagramPublishRequest } from "../routes/api.social.instagram.publish";
import { randomSecret, sha256Hex } from "./instagram";
import { handleTikTokUploadRequest } from "./tiktok-workflow";
import { canReplaceVideoAssetSql } from "./content-asset-guard";

const SERVER_INSTRUCTIONS = "Crea una pieza con create_content, con su título y descripción. Adjunta el archivo con start_video_upload, envía las partes directamente por HTTP PUT desde el equipo que tiene el video y termina con complete_video_upload. Usa list_social_accounts para determinar la cuenta destino. Si el usuario aprueba la pieza, usa approve_video_content. Publicar o enviar un video a una plataforma externa requiere la confirmación explícita del usuario para esa cuenta.";
const VIDEO_PART_SIZE = 8 * 1024 * 1024;
const MAX_VIDEO_SIZE = 1024 * 1024 * 1024;

const socialPlatform = z.enum(["instagram", "tiktok"]);
type SocialPlatform = z.infer<typeof socialPlatform>;

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

function expectedPartSize(fileSize: number, partNumber: number) {
  const remaining = fileSize - VIDEO_PART_SIZE * (partNumber - 1);
  return Math.max(0, Math.min(VIDEO_PART_SIZE, remaining));
}

async function saveVideoPart(upload: PendingVideoUpload, partNumber: number, data: ArrayBuffer | ReadableStream) {
  const part = await getAssets().resumeMultipartUpload(upload.asset_key, upload.upload_id).uploadPart(partNumber, data);
  return { part_number: part.partNumber, etag: part.etag };
}

export async function putMcpVideoPart(request: Request) {
  const token = /^Bearer (nex_upload_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return Response.json({ error: "Usa el upload_token devuelto al iniciar la carga." }, { status: 401 });
  const partNumber = Number(new URL(request.url).searchParams.get("part_number"));
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    return Response.json({ error: "Indica un número de parte válido." }, { status: 400 });
  }
  try {
    const upload = await getDb().prepare(
      "SELECT id, content_id, asset_key, upload_id, filename, content_type, file_size FROM content_uploads WHERE id = ? AND created_at > datetime('now', '-1 hour')",
    ).bind(await sha256Hex(token)).first<PendingVideoUpload>();
    if (!upload) return Response.json({ error: "La autorización de carga venció o no es válida." }, { status: 401 });
    const size = expectedPartSize(upload.file_size, partNumber);
    if (!request.body || !size || Number(request.headers.get("content-length")) !== size) {
      return Response.json({ error: "El cuerpo de la parte debe ser binario y coincidir con el tamaño esperado." }, { status: 400 });
    }
    return Response.json(await saveVideoPart(upload, partNumber, request.body));
  } catch {
    return Response.json({ error: "Nex no pudo guardar esta parte del video. Puedes volver a enviarla." }, { status: 502 });
  }
}

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

async function runSocialAction(request: Request | undefined, userId: string, platform: SocialPlatform, payload: Record<string, unknown>) {
  if (!request) return failure("La solicitud HTTP autenticada no está disponible.");
  const handler = platform === "instagram" ? handleInstagramPublishRequest : handleTikTokUploadRequest;
  try {
    const response = await handler(new Request(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }), userId);
    const data = await response.json().catch(() => null) as { status?: string; error?: string } | null;
    if (!data || (!response.ok && !data.status)) {
      return failure(data?.error || `Nex no pudo completar la operación (HTTP ${response.status}).`);
    }
    return result({ ...data, platform });
  } catch {
    return failure("Nex no pudo completar la operación con la plataforma.");
  }
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
    description: "Crea un borrador con el título y la descripción de la pieza. Para Instagram, la descripción se usa como texto del Reel y el título se usa si no hay descripción.",
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
      return result({ id: contentId, state: "borrador", title, description: description?.trim() || null });
    } catch {
      return failure("Nex no pudo crear el borrador.");
    }
  });

  server.registerTool("start_video_upload", {
    title: "Start video upload",
    description: "Inicia la carga por partes de un MP4 o MOV. Desde el equipo que tiene el archivo, envía cada parte binaria por HTTP PUT a upload_url con ?part_number=N, Authorization: Bearer <upload_token> y su Content-Length. Guarda los etags y termina con complete_video_upload. El token dura una hora y sirve solo para esta carga. Si tu cliente ya automatiza base64, también puedes usar upload_video_part.",
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
      const uploadToken = request ? "nex_upload_" + randomSecret() : null;
      // A binary upload uses the one-way hash as the upload row ID.
      const rowId = uploadToken ? await sha256Hex(uploadToken) : newId();
      multipart = await getAssets().createMultipartUpload(assetKey, { httpMetadata: { contentType: content_type } });
      await db.prepare("INSERT INTO content_uploads (id, content_id, user_id, asset_key, upload_id, filename, content_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(rowId, content_id, userId, assetKey, multipart.uploadId, safeFilename, content_type, file_size).run();
      return result({
        upload_id: multipart.uploadId,
        part_size: VIDEO_PART_SIZE,
        part_count: Math.ceil(file_size / VIDEO_PART_SIZE),
        ...(request && uploadToken ? { upload_url: new URL("/api/mcp", request.url).href, upload_token: uploadToken } : {}),
      });
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
    const expectedLength = expectedPartSize(pending.file_size, part_number);
    if (!expectedLength) return failure("El número de parte supera el tamaño esperado del video.");
    const body = decodeBase64(data_base64);
    if (!body || body.byteLength !== expectedLength) return failure("La parte no es base64 válido o su tamaño no coincide con el esperado.");
    try {
      return result(await saveVideoPart(pending, part_number, body));
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

    const current = await db.prepare(`SELECT asset_key, (${canReplaceVideoAssetSql}) AS can_replace FROM content_items WHERE id = ? AND user_id = ?`)
      .bind(content_id, userId).first<{ asset_key: string | null; can_replace: number }>();
    if (!current) return failure("No se encontró la pieza de contenido.");
    if (!current.can_replace) return failure("Espera a que termine el envío a la red social para reemplazar el video.");
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
        db.prepare(`UPDATE content_items SET asset_key = ?, asset_name = ?, asset_content_type = ?, asset_size = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND asset_key IS ? AND ${canReplaceVideoAssetSql}`)
          .bind(pending.asset_key, pending.filename, pending.content_type, object.size, content_id, userId, current.asset_key),
        db.prepare("DELETE FROM content_uploads WHERE id = ? AND user_id = ?").bind(pending.id, userId),
      ]);
    } catch {
      await getAssets().delete(pending.asset_key).catch(() => undefined);
      await db.prepare("DELETE FROM content_uploads WHERE id = ? AND user_id = ?").bind(pending.id, userId).run().catch(() => undefined);
      return failure("Nex no pudo adjuntar el video a la pieza.");
    }
    if (completed[0]?.meta.changes !== 1) {
      await getAssets().delete(pending.asset_key).catch(() => undefined);
      return failure("La pieza cambió o se está enviando a una red social. Inicia una nueva carga cuando esté lista.");
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

  server.registerTool("list_social_accounts", {
    title: "List connected social accounts",
    description: "Lista las cuentas de Instagram y TikTok vinculadas a este estudio. Usa el identificador id y la plataforma de la cuenta elegida al enviar un video.",
    inputSchema: z.object({ platform: socialPlatform.optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("nex:read"),
  }, async ({ platform }) => {
    try {
      const { results } = await getDb().prepare(
        "SELECT id, lower(platform) AS platform, handle, status, token_expires_at FROM social_accounts WHERE user_id = ? AND platform IN ('Instagram', 'TikTok') AND status = 'conectada' AND external_account_id IS NOT NULL AND (? IS NULL OR lower(platform) = ?) ORDER BY platform, connected_at DESC",
      ).bind(userId, platform ?? null, platform ?? null).all();
      return result(results ?? []);
    } catch {
      return failure("Nex no pudo cargar las cuentas sociales.");
    }
  });

  server.registerTool("approve_video_content", {
    title: "Approve a video in Nex",
    description: "Marca como aprobada una pieza con video adjunto cuando el usuario haya revisado y aprobado esa pieza. Solo cambia el estado dentro de Nex. No envía el archivo a redes.",
    inputSchema: z.object({ content_id: z.string().min(1), confirm_approve: z.literal(true) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("nex:publish"),
  }, async ({ content_id }) => {
    try {
      const db = getDb();
      await db.prepare(
        "UPDATE content_items SET state = 'aprobada', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND state IN ('borrador', 'en_revision') AND asset_key IS NOT NULL AND asset_content_type IN ('video/mp4', 'video/quicktime')",
      ).bind(content_id, userId).run();
      const content = await db.prepare(
        "SELECT id, title, description, state FROM content_items WHERE id = ? AND user_id = ? AND asset_key IS NOT NULL AND asset_content_type IN ('video/mp4', 'video/quicktime')",
      ).bind(content_id, userId).first<{ id: string; title: string; description: string | null; state: string }>();
      if (!content) return failure("Primero adjunta un video MP4 o MOV a la pieza.");
      if (content.state !== "aprobada" && content.state !== "publicada") {
        return failure("La pieza debe estar en borrador o en revisión para aprobarla.");
      }
      return result(content);
    } catch {
      return failure("Nex no pudo aprobar el video.");
    }
  });

  server.registerTool("publish_social_video", {
    title: "Send video to a connected social account",
    description: "Envía una pieza aprobada con video a la cuenta destino. En Instagram inicia la publicación del Reel; en TikTok envía el archivo a la bandeja de la cuenta para que el usuario añada el texto y publique en la app. Solo usar tras confirmación explícita para la pieza y cuenta elegidas. Guarda el jobId y usa check_social_publish.",
    inputSchema: z.object({
      platform: socialPlatform,
      content_id: z.string().min(1),
      account_id: z.string().min(1),
      confirm_publish: z.literal(true),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    scopeChallenge: requireScopes("nex:publish"),
  }, async ({ platform, content_id, account_id }) =>
    runSocialAction(request, userId, platform, { action: "start", contentId: content_id, accountId: account_id }),
  );

  server.registerTool("check_social_publish", {
    title: "Check social video status",
    description: "Consulta una operación por plataforma y job_id. En Instagram también finaliza la publicación ya confirmada al quedar listo el Reel. En TikTok, awaiting_user indica que el usuario debe abrir TikTok para completar la publicación.",
    inputSchema: z.object({ platform: socialPlatform, job_id: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    scopeChallenge: requireScopes("nex:publish"),
  }, async ({ platform, job_id }) =>
    runSocialAction(request, userId, platform, { action: "check", jobId: job_id }),
  );

  server.registerTool("publish_instagram_reel", {
    title: "Publish an Instagram Reel",
    description: "Inicia la publicación de un Reel aprobado en la cuenta de Instagram elegida. Usa la descripción de la pieza como texto del Reel y el título si no hay descripción. Solo llamar si el usuario pidió y confirmó publicar la pieza en esa cuenta.",
    inputSchema: z.object({
      content_id: z.string().min(1),
      account_id: z.string().min(1),
      confirm_publish: z.literal(true),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    scopeChallenge: requireScopes("nex:publish"),
  }, async ({ content_id, account_id }) =>
    runSocialAction(request, userId, "instagram", { action: "start", contentId: content_id, accountId: account_id }),
  );

  server.registerTool("check_instagram_publish", {
    title: "Check Instagram publishing status",
    description: "Consulta y avanza el estado de un Reel que ya se está procesando en Instagram.",
    inputSchema: z.object({ job_id: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    scopeChallenge: requireScopes("nex:publish"),
  }, async ({ job_id }) => runSocialAction(request, userId, "instagram", { action: "check", jobId: job_id }));

  return server;
}
