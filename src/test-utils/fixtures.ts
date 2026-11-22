import { newId } from "../lib/db";
import { randomSecret, sha256Hex } from "../lib/instagram";

export async function seedUser(db: D1Database, email = "pablo@example.test") {
  const id = newId();
  await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x:x')").bind(id, email).run();
  return id;
}

/** Crea una clave MCP y devuelve el valor en claro, como lo vería el harness. */
export async function seedMcpToken(db: D1Database, userId: string, label = "Hermes", scopes?: string) {
  const token = "nex_live_" + randomSecret();
  await db.prepare("INSERT INTO mcp_tokens (id, user_id, token_hash, label, scopes) VALUES (?, ?, ?, ?, COALESCE(?, 'content:read content:write publish'))")
    .bind(newId(), userId, await sha256Hex(token), label, scopes ?? null)
    .run();
  return token;
}

export async function seedContent(db: D1Database, userId: string, fields: Partial<{ title: string; state: string; asset_key: string; asset_name: string; asset_content_type: string; asset_size: number; description: string }> = {}) {
  const id = newId();
  await db.prepare("INSERT INTO content_items (id, user_id, title, description, state, asset_key, asset_name, asset_content_type, asset_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, userId, fields.title ?? "Pieza de prueba", fields.description ?? null, fields.state ?? "borrador", fields.asset_key ?? null, fields.asset_name ?? null, fields.asset_content_type ?? null, fields.asset_size ?? null)
    .run();
  return id;
}

export function bearer(token: string) {
  return { authorization: "Bearer " + token };
}

export async function seedSocialAccount(db: D1Database, userId: string, fields: Partial<{ platform: string; handle: string; externalId: string; status: string; ciphertext: string; iv: string; expiresAt: string | null }> = {}) {
  const id = newId();
  await db.prepare("INSERT INTO social_accounts (id, user_id, platform, handle, status, external_account_id, token_ciphertext, token_iv, token_expires_at, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
    .bind(id, userId, fields.platform ?? "Instagram", fields.handle ?? "@nex", fields.status ?? "conectada", fields.externalId ?? "ext-" + id.slice(0, 8), fields.ciphertext ?? null, fields.iv ?? null, fields.expiresAt ?? null)
    .run();
  return id;
}

/** Una pieza lista para publicar: aprobada y con un video MP4 adjunto. */
export function approvedVideo() {
  return { state: "aprobada", asset_key: "content/test/video", asset_name: "reel.mp4", asset_content_type: "video/mp4", asset_size: 1024 };
}
