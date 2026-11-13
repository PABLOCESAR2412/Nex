// src/lib/content.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAssets, getDb, newId } from "./db";
import { authMiddleware } from "./auth";

export const CONTENT_STATES = ["borrador", "en_revision", "aprobada", "programada", "publicada"] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

export type ContentItem = {
  id: string;
  title: string;
  description: string | null;
  script: string | null;
  type: string;
  state: string;
  channels: string | null;
  asset_key: string | null;
  asset_name: string | null;
  asset_content_type: string | null;
  asset_size: number | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
};

const contentSelect = "id, title, description, script, type, state, channels, asset_key, asset_name, asset_content_type, asset_size, scheduled_at, created_at, updated_at";

export const listContentFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = getDb();
    const { results } = await db
      .prepare(`SELECT ${contentSelect} FROM content_items WHERE user_id = ? ORDER BY updated_at DESC`)
      .bind(context.session.userId)
      .all<ContentItem>();
    return (results ?? []).map((r: ContentItem) => ({ ...r }));
  });

export const createContentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().max(4000).optional(), script: z.string().max(20000).optional(), type: z.string().trim().min(1).max(40).optional(), channels: z.string().trim().max(200).optional() }))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const id = newId();
    await db
      .prepare("INSERT INTO content_items (id, user_id, title, description, script, type, channels) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, context.session.userId, data.title, data.description ?? null, data.script ?? null, data.type ?? "video", data.channels ?? null)
      .run();
    return { id };
  });

export const updateContentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4000),
    script: z.string().max(20000),
    channels: z.string().trim().max(200),
    state: z.enum(CONTENT_STATES),
    scheduledAt: z.string().datetime().nullable(),
  }))
  .handler(async ({ data, context }) => {
    if (data.state === "programada" && !data.scheduledAt) {
      throw new Error("Añade una fecha y hora para programar la pieza.");
    }
    if (data.state === "programada" && data.scheduledAt && new Date(data.scheduledAt).getTime() <= Date.now()) {
      throw new Error("La fecha de publicación debe estar en el futuro.");
    }
    const result = await getDb()
      .prepare("UPDATE content_items SET title = ?, description = ?, script = ?, channels = ?, state = ?, scheduled_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .bind(data.title, data.description || null, data.script || null, data.channels || null, data.state, data.state === "programada" ? data.scheduledAt : null, data.id, context.session.userId)
      .run();
    if (!result.meta.changes) throw new Error("No se encontró la pieza.");
    return { ok: true };
  });

export const deleteContentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const item = await db.prepare("SELECT asset_key FROM content_items WHERE id = ? AND user_id = ?").bind(data.id, context.session.userId).first<{ asset_key: string | null }>();
    const { results: uploads } = await db.prepare("SELECT asset_key, upload_id FROM content_uploads WHERE content_id = ? AND user_id = ?").bind(data.id, context.session.userId).all<{ asset_key: string; upload_id: string }>();
    for (const upload of uploads ?? []) {
      try { await getAssets().resumeMultipartUpload(upload.asset_key, upload.upload_id).abort(); } catch {}
    }
    await db.prepare("DELETE FROM content_items WHERE id = ? AND user_id = ?").bind(data.id, context.session.userId).run();
    let assetCleanupPending = false;
    if (item?.asset_key) {
      try { await getAssets().delete(item.asset_key); } catch { assetCleanupPending = true; }
    }
    return { ok: true, assetCleanupPending };
  });
