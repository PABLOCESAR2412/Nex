import { ALLOWED_ACCOUNT_EMAIL } from "../lib/auth-policy";
import { newId } from "../lib/db";
import { randomSecret, sha256Hex } from "../lib/instagram";

export async function seedUser(db: D1Database, email = ALLOWED_ACCOUNT_EMAIL) {
  const id = newId();
  await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x:x')").bind(id, email).run();
  return id;
}

/**
 * Crea una conexión OAuth ya autorizada (cliente, concesión y token de acceso vigente) y devuelve el token en claro,
 * como lo enviaría un asistente. El recurso es `<origin>/api/mcp`, igual que en una autorización real.
 */
export async function seedOAuthAccess(db: D1Database, userId: string, scopes = "nex:read nex:write nex:publish", origin = "https://nex.test") {
  const token = "nex_access_" + randomSecret();
  const clientId = "cliente-" + newId();
  await db.prepare("INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json, grant_types_json, response_types_json, scopes) VALUES (?, 'Cliente de prueba', '[]', '[\"authorization_code\"]', '[\"code\"]', ?)")
    .bind(clientId, scopes)
    .run();
  await db.prepare("INSERT INTO mcp_oauth_grants (id, user_id, client_id, client_name, resource, scopes, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at) VALUES (?, ?, ?, 'Cliente de prueba', ?, ?, ?, ?, ?, ?)")
    .bind(newId(), userId, clientId, origin + "/api/mcp", scopes, await sha256Hex(token), await sha256Hex("refresh-" + token), new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 30 * 86_400_000).toISOString())
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
