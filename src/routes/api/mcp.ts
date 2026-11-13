import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAssets, getDb, newId } from "../../lib/db";
import { getMcpUserId } from "../../lib/mcp";
import { handleInstagramPublishRequest } from "../api.social.instagram.publish";

const TOOLS = [
  {
    name: "list_content",
    description: "Lista las piezas de contenido del estudio autenticado, incluidos su estado y datos del archivo adjunto.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_content",
    description: "Crea un borrador en la biblioteca de Nex. No lo publica en redes.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        description: { type: "string", maxLength: 4000 },
        script: { type: "string", maxLength: 20000 },
        type: { type: "string", maxLength: 40 },
        channels: { type: "string", maxLength: 200 },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "upload_content_from_url",
    description: "Carga un video MP4 o MOV desde una URL HTTPS pública y accesible sin inicio de sesión y lo adjunta a una pieza de Nex. No publica el video.",
    inputSchema: {
      type: "object",
      properties: {
        content_id: { type: "string" },
        video_url: { type: "string", format: "uri", description: "URL HTTPS directa y pública del archivo de video. No uses enlaces de vista previa ni enlaces con inicio de sesión." },
        filename: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["content_id", "video_url", "filename"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "schedule_content",
    description: "Programa una pieza del usuario autenticado para una fecha futura en el calendario de Nex.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID de la pieza devuelto por list_content o create_content." },
        scheduled_at: { type: "string", format: "date-time" },
      },
      required: ["id", "scheduled_at"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_instagram_accounts",
    description: "Lista las cuentas profesionales de Instagram conectadas al estudio. Devuelve IDs para elegir una cuenta al publicar.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "publish_instagram_reel",
    description: "Inicia la publicación de un Reel en una cuenta de Instagram conectada. Solo usar si el usuario pidió publicar esta pieza y confirmó que se haga pública. Requiere contenido aprobado, video MP4/MOV cargado en Nex y confirm_publish=true.",
    inputSchema: {
      type: "object",
      properties: {
        content_id: { type: "string" },
        account_id: { type: "string" },
        confirm_publish: { type: "boolean", const: true, description: "Debe ser true solo después de que el usuario haya pedido expresamente publicar este Reel." },
      },
      required: ["content_id", "account_id", "confirm_publish"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "check_instagram_publish",
    description: "Consulta y avanza el estado de un Reel que ya se está procesando en Instagram.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

function response(id: unknown, result: unknown, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, result }, { status, headers: { "cache-control": "no-store" } });
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

function toolResult(id: unknown, result: unknown, isError = false) {
  return response(id, {
    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
    ...(isError ? { isError: true } : {}),
  });
}

async function readPublishResult(request: Request, userId: string, payload: Record<string, unknown>) {
  const result = await handleInstagramPublishRequest(new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), userId);
  return { status: result.status, data: await result.json().catch(() => ({ error: "Respuesta inválida del proceso de Instagram." })) as Record<string, unknown> };
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) {
          return Response.json({ error: "Origin not allowed." }, { status: 403, headers: { "cache-control": "no-store" } });
        }

        const userId = await getMcpUserId(request);
        if (!userId) {
          return Response.json({ error: "Clave MCP inválida o revocada." }, {
            status: 401,
            headers: { "www-authenticate": 'Bearer realm="Nex MCP"', "cache-control": "no-store" },
          });
        }

        let body: { jsonrpc?: unknown; method?: unknown; params?: unknown; id?: unknown };
        try { body = await request.json() as typeof body; }
        catch { return rpcError(null, -32700, "Parse error", 400); }

        const { method, params, id } = body ?? {};
        if (body?.jsonrpc !== "2.0" || typeof method !== "string") return rpcError(id ?? null, -32600, "Invalid Request", 400);
        if (method.startsWith("notifications/")) return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });

        if (method === "initialize") {
          return response(id, {
            protocolVersion: "2025-11-25",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "nex", version: "1.0.0" },
            instructions: "Nex gestiona piezas, calendario y cuentas sociales del usuario. Las publicaciones públicas requieren petición y confirmación explícitas del usuario.",
          });
        }
        if (method === "ping") return response(id, {});
        if (method === "tools/list") return response(id, { tools: TOOLS });
        if (method !== "tools/call") return rpcError(id, -32601, `Unknown method: ${method}`);

        const call = params as { name?: unknown; arguments?: unknown } | null;
        const toolName = call?.name;
        const args = (call?.arguments && typeof call.arguments === "object" ? call.arguments : {}) as Record<string, unknown>;
        try {
          if (toolName === "list_content") {
            const { results } = await getDb()
              .prepare("SELECT id, title, description, script, type, state, channels, asset_name, asset_content_type, asset_size, scheduled_at, created_at, updated_at FROM content_items WHERE user_id = ? ORDER BY updated_at DESC")
              .bind(userId)
              .all();
            return toolResult(id, results ?? []);
          }

          if (toolName === "create_content") {
            const title = typeof args.title === "string" ? args.title.trim() : "";
            if (!title || title.length > 160) return rpcError(id, -32602, "Title must contain 1 to 160 characters.");
            const description = typeof args.description === "string" ? args.description.trim().slice(0, 4000) : null;
            const script = typeof args.script === "string" ? args.script.slice(0, 20000) : null;
            const channels = typeof args.channels === "string" ? args.channels.trim().slice(0, 200) : null;
            const type = typeof args.type === "string" ? args.type.trim().slice(0, 40) || "video" : "video";
            const contentId = newId();
            await getDb().prepare("INSERT INTO content_items (id, user_id, title, description, script, type, channels) VALUES (?, ?, ?, ?, ?, ?, ?)")
              .bind(contentId, userId, title, description, script, type, channels)
              .run();
            return toolResult(id, { id: contentId, state: "borrador" });
          }

          if (toolName === "upload_content_from_url") {
            if (typeof args.content_id !== "string" || typeof args.video_url !== "string" || typeof args.filename !== "string") {
              return rpcError(id, -32602, "A content ID, direct video URL and filename are required.");
            }
            const leafName = args.filename.replaceAll(String.fromCharCode(92), "/").split("/").pop() ?? "";
            const filename = Array.from(leafName).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("").slice(0, 200);
            if (!filename) return rpcError(id, -32602, "The filename is invalid.");
            let sourceUrl: URL;
            try { sourceUrl = new URL(args.video_url); }
            catch { return rpcError(id, -32602, "The video URL is invalid."); }
            const host = sourceUrl.hostname.toLowerCase().replace(/\.$/, "");
            if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password || !host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.startsWith("[") || /^[\d.]+$/.test(host)) {
              return rpcError(id, -32602, "Use a direct HTTPS link on a public domain. Local and IP-address links are not allowed.");
            }
            const content = await getDb().prepare("SELECT id, asset_key FROM content_items WHERE id = ? AND user_id = ?")
              .bind(args.content_id, userId)
              .first<{ id: string; asset_key: string | null }>();
            if (!content) return rpcError(id, -32004, "Content item not found.");
            const videoResponse = await fetch(sourceUrl, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
            if (videoResponse.status >= 300 && videoResponse.status < 400) return rpcError(id, -32602, "The video URL redirects. Use the final direct HTTPS file URL.");
            if (!videoResponse.ok || !videoResponse.body) return toolResult(id, "The video host returned HTTP " + videoResponse.status + ". Use a direct file URL that does not require login.", true);
            const headerType = videoResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
            const path = sourceUrl.pathname.toLowerCase();
            const assetType = headerType === "video/mp4" || path.endsWith(".mp4") ? "video/mp4" : headerType === "video/quicktime" || path.endsWith(".mov") ? "video/quicktime" : null;
            if (!assetType) return rpcError(id, -32602, "The URL must return an MP4 or MOV video.");
            const contentLength = videoResponse.headers.get("content-length");
            if (contentLength && Number(contentLength) > 1_000_000_000) return rpcError(id, -32602, "The video exceeds Nex's 1 GB upload limit.");
            let uploadedSize = 0;
            const limitedBody = videoResponse.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                uploadedSize += chunk.byteLength;
                if (uploadedSize > 1_000_000_000) {
                  controller.error(new Error("El video supera el máximo de 1 GB."));
                  return;
                }
                controller.enqueue(chunk);
              },
            }));
            const assetKey = "content/" + userId + "/" + content.id + "/" + newId();
            await getAssets().put(assetKey, limitedBody, { httpMetadata: { contentType: assetType } });
            try {
              const updated = await getDb().prepare("UPDATE content_items SET asset_key = ?, asset_name = ?, asset_content_type = ?, asset_size = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
                .bind(assetKey, filename, assetType, uploadedSize, content.id, userId)
                .run();
              if (!updated.meta.changes) throw new Error("No se encontró la pieza.");
            } catch (error) {
              await getAssets().delete(assetKey).catch(() => undefined);
              throw error;
            }
            if (content.asset_key) await getAssets().delete(content.asset_key).catch(() => undefined);
            return toolResult(id, { ok: true, content_id: content.id, filename, content_type: assetType, size: uploadedSize });
          }

          if (toolName === "schedule_content") {
            const parsedDate = z.string().datetime().safeParse(args.scheduled_at);
            if (typeof args.id !== "string" || !parsedDate.success) return rpcError(id, -32602, "A content ID and ISO date-time are required.");
            const date = new Date(parsedDate.data);
            if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return rpcError(id, -32602, "The scheduled date must be in the future.");
            const result = await getDb()
              .prepare("UPDATE content_items SET state = 'programada', scheduled_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
              .bind(date.toISOString(), args.id, userId)
              .run();
            if (!result.meta.changes) return rpcError(id, -32004, "Content item not found.");
            return toolResult(id, { ok: true, id: args.id, scheduled_at: date.toISOString() });
          }

          if (toolName === "list_instagram_accounts") {
            const { results } = await getDb()
              .prepare("SELECT id, handle, status, token_expires_at FROM social_accounts WHERE user_id = ? AND platform = 'Instagram' AND external_account_id IS NOT NULL ORDER BY connected_at DESC")
              .bind(userId)
              .all<{ id: string; handle: string; status: string; token_expires_at: string | null }>();
            return toolResult(id, results ?? []);
          }

          if (toolName === "publish_instagram_reel") {
            if (typeof args.content_id !== "string" || typeof args.account_id !== "string" || args.confirm_publish !== true) {
              return rpcError(id, -32602, "Provide content_id, account_id and confirm_publish=true after the user explicitly requests publication.");
            }
            const result = await readPublishResult(request, userId, { action: "start", contentId: args.content_id, accountId: args.account_id });
            return toolResult(id, result.data, result.status >= 400);
          }

          if (toolName === "check_instagram_publish") {
            if (typeof args.job_id !== "string") return rpcError(id, -32602, "A publication job ID is required.");
            const result = await readPublishResult(request, userId, { action: "check", jobId: args.job_id });
            return toolResult(id, result.data, result.status >= 400);
          }

          return rpcError(id, -32601, `Unknown tool: ${String(toolName)}`);
        } catch (error) {
          return toolResult(id, error instanceof Error ? error.message : "Nex could not complete the tool call.", true);
        }
      },
      GET: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
        if (!await getMcpUserId(request)) {
          return new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer realm="Nex MCP"' } });
        }
        return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      },
    },
  },
});
