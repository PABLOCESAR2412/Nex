import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, getCurrentSession } from "./auth";
import { getDb, newId } from "./db";
import { randomSecret, sha256Hex } from "./instagram";
import { isAllowedAccountEmail } from "./auth-policy";

export type McpTokenSummary = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
};

export const getMcpUserId = createServerOnlyFn(async (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer (nex_live_[A-Za-z0-9_-]{40,60})$/.exec(authorization);
  if (!match) return null;
  const tokenHash = await sha256Hex(match[1]);
  const db = getDb();
  const token = await db
    .prepare("SELECT t.id, t.user_id, u.email FROM mcp_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.revoked_at IS NULL")
    .bind(tokenHash)
    .first<{ id: string; user_id: string; email: string }>();
  if (!token || !isAllowedAccountEmail(token.email)) return null;
  await db.prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(token.id).run();
  return token.user_id;
});

export const listMcpTokensFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { results } = await getDb()
      .prepare("SELECT id, label, created_at, last_used_at FROM mcp_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
      .bind(context.session.userId)
      .all<McpTokenSummary>();
    return results ?? [];
  });

export const createMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ label: z.string().trim().min(1).max(60) }))
  .handler(async ({ data, context }) => {
    const token = "nex_live_" + randomSecret();
    await getDb()
      .prepare("INSERT INTO mcp_tokens (id, user_id, token_hash, label) VALUES (?, ?, ?, ?)")
      .bind(newId(), context.session.userId, await sha256Hex(token), data.label)
      .run();
    return { token };
  });

export const revokeMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await getDb()
      .prepare("UPDATE mcp_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .bind(data.id, context.session.userId)
      .run();
    if (!result.meta.changes) throw new Error("No se encontró la conexión MCP.");
    return { ok: true };
  });

export type McpAuth = { userId: string; scopes: string[] };
export type McpScopeName = "nex:read" | "nex:write" | "nex:publish";

export function hasScope(auth: McpAuth, scope: McpScopeName) {
  return auth.scopes.includes(scope);
}

/**
 * Quién hace una petición HTTP a una ruta que también usan los asistentes (subida de archivos, publicación).
 * Con cabecera `Authorization` solo cuenta ese token —un token OAuth o una clave antigua, con sus permisos—,
 * aunque el navegador envíe además la cookie de sesión. Sin ella vale la sesión web, con todos los permisos.
 * `resolveMcpAccessToken` se importa al usarse para que el código del servidor no entre en el bundle del cliente.
 */
export const getRequestAuth = createServerOnlyFn(async (request: Request): Promise<McpAuth | null> => {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer (\S+)$/.exec(authorization);
    if (!match) return null;
    const { resolveMcpAccessToken } = await import("./mcp-oauth");
    const info = await resolveMcpAccessToken(match[1], new URL(request.url).origin);
    return info ? { userId: info.extra.userId, scopes: [...info.scopes] } : null;
  }
  const session = await getCurrentSession();
  return session ? { userId: session.userId, scopes: ["nex:read", "nex:write", "nex:publish"] } : null;
});
