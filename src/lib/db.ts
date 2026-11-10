// src/lib/db.ts
import { env } from "cloudflare:workers";

export function getDb(): D1Database {
  return (env as { nex_db: D1Database }).nex_db;
}

export function getAssets(): R2Bucket {
  return (env as { nex_assets: R2Bucket }).nex_assets;
}

export function newId(): string {
  return crypto.randomUUID();
}