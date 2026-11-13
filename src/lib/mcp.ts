import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "./auth";
import { getDb, newId } from "./db";
import { randomSecret, sha256Hex } from "./instagram";

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
    .prepare("SELECT id, user_id FROM mcp_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(tokenHash)
    .first<{ id: string; user_id: string }>();
  if (!token) return null;
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
