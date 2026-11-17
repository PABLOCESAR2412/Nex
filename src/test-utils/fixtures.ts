import { newId } from "../lib/db";
import { randomSecret, sha256Hex } from "../lib/instagram";

export async function seedUser(db: D1Database, email = "pablo@example.test") {
  const id = newId();
  await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x:x')").bind(id, email).run();
  return id;
}

/** Crea una clave MCP y devuelve el valor en claro, como lo vería el harness. */
export async function seedMcpToken(db: D1Database, userId: string, label = "Hermes") {
  const token = "nex_live_" + randomSecret();
  await db.prepare("INSERT INTO mcp_tokens (id, user_id, token_hash, label) VALUES (?, ?, ?, ?)")
    .bind(newId(), userId, await sha256Hex(token), label)
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
