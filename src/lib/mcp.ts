import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, getCurrentSession } from "./auth";
import { getDb, newId } from "./db";
import { randomSecret, sha256Hex } from "./token-crypto";

/** Permisos de una clave MCP: leer, escribir borradores y archivos, y programar o publicar en redes. */
export const MCP_SCOPES = ["content:read", "content:write", "publish"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  "content:read": "Leer la biblioteca, el calendario, las cuentas conectadas y las publicaciones",
  "content:write": "Crear borradores, subir archivos y colocar piezas en el calendario",
  publish: "Programar publicaciones en tus cuentas y publicar Reels (solo piezas que tú aprobaste)",
};

export function parseScopes(value: string | null | undefined): McpScope[] {
  const requested = new Set((value ?? "").split(/[\s,]+/).filter(Boolean));
  return MCP_SCOPES.filter((scope) => requested.has(scope));
}

export type McpAuth = { userId: string; scopes: McpScope[]; tokenId: string | null };

export function hasScope(auth: McpAuth, scope: McpScope) {
  return auth.scopes.includes(scope);
}

export type McpTokenSummary = {
  id: string;
  label: string;
  scopes: string;
  oauth: boolean;
  created_at: string;
  last_used_at: string | null;
};

/** Identifica una petición con clave `Bearer nex_live_…`: usuario, permisos y clave. Una clave OAuth vencida no sirve. */
export const getMcpAuth = createServerOnlyFn(async (request: Request): Promise<McpAuth | null> => {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer (nex_live_[A-Za-z0-9_-]{40,60})$/.exec(authorization);
  if (!match) return null;
  const tokenHash = await sha256Hex(match[1]);
  const db = getDb();
  const token = await db
    .prepare("SELECT id, user_id, scopes, expires_at FROM mcp_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(tokenHash)
    .first<{ id: string; user_id: string; scopes: string; expires_at: string | null }>();
  if (!token) return null;
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) return null;
  await db.prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(token.id).run();
  return { userId: token.user_id, scopes: parseScopes(token.scopes), tokenId: token.id };
});

/**
 * Quién hace una petición HTTP: una clave MCP si la petición trae `Authorization` (y solo con los permisos de
 * esa clave, aunque el navegador también envíe la cookie de sesión) o, si no, la sesión web con todos los permisos.
 * Lo usan las rutas que un harness también necesita (por ejemplo la subida de archivos).
 */
export const getRequestAuth = createServerOnlyFn(async (request: Request): Promise<McpAuth | null> => {
  if (request.headers.get("authorization")) return getMcpAuth(request);
  const session = await getCurrentSession();
  if (session) return { userId: session.userId, scopes: [...MCP_SCOPES], tokenId: null };
  return getMcpAuth(request);
});

export const listMcpTokensFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { results } = await getDb()
      .prepare("SELECT id, label, scopes, client_id, refresh_expires_at, created_at, last_used_at FROM mcp_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
      .bind(context.session.userId)
      .all<{ id: string; label: string; scopes: string; client_id: string | null; refresh_expires_at: string | null; created_at: string; last_used_at: string | null }>();
    return (results ?? [])
      // Una conexión OAuth cuyo refresh token ya venció no puede renovarse: deja de contar como activa.
      .filter((row) => !row.client_id || !row.refresh_expires_at || Date.parse(row.refresh_expires_at) > Date.now())
      .map((row): McpTokenSummary => ({ id: row.id, label: row.label, scopes: row.scopes, oauth: !!row.client_id, created_at: row.created_at, last_used_at: row.last_used_at }));
  });

export const createMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({
    label: z.string().trim().min(1).max(60),
    scopes: z.array(z.enum(MCP_SCOPES)).min(1).default([...MCP_SCOPES]),
  }))
  .handler(async ({ data, context }) => {
    const token = "nex_live_" + randomSecret();
    await getDb()
      .prepare("INSERT INTO mcp_tokens (id, user_id, token_hash, label, scopes) VALUES (?, ?, ?, ?, ?)")
      .bind(newId(), context.session.userId, await sha256Hex(token), data.label, MCP_SCOPES.filter((scope) => data.scopes.includes(scope)).join(" "))
      .run();
    return { token };
  });

export const revokeMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await getDb()
      .prepare("UPDATE mcp_tokens SET revoked_at = datetime('now'), refresh_hash = NULL WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .bind(data.id, context.session.userId)
      .run();
    if (!result.meta.changes) throw new Error("No se encontró la conexión MCP.");
    return { ok: true };
  });
