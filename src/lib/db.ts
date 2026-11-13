// src/lib/db.ts
import { env } from "cloudflare:workers";

export function getDb(): D1Database {
  return (env as { nex_db: D1Database }).nex_db;
}

export function getAssets(): R2Bucket {
  return (env as { nex_assets: R2Bucket }).nex_assets;
}

export type RuntimeEnv = {
  nex_db: D1Database;
  nex_assets: R2Bucket;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  INSTAGRAM_TOKEN_ENCRYPTION_KEY?: string;
  INSTAGRAM_GRAPH_VERSION?: string;
  PUBLIC_APP_URL?: string;
};

export function getRuntimeEnv(): RuntimeEnv {
  return env as RuntimeEnv;
}

export function newId(): string {
  return crypto.randomUUID();
}

// Types needed by Cloudflare Workers (provided by wrangler types)
interface __BaseEnv_Env {
  nex_db: D1Database;
  nex_assets: R2Bucket;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  INSTAGRAM_TOKEN_ENCRYPTION_KEY?: string;
  INSTAGRAM_GRAPH_VERSION?: string;
  PUBLIC_APP_URL?: string;
}

declare module "cloudflare:workers" {
  interface Env extends __BaseEnv_Env {}
  interface Env extends __BaseEnv_Env {}
  export interface D1Database {}
  export interface R2Bucket {}
}
