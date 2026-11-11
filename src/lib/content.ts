// src/lib/content.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb, newId } from "./db";
import { authMiddleware } from "./auth";

export type ContentItem = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  state: string;
  channels: string | null;
  asset_key: string | null;
  created_at: string;
  updated_at: string;
};

export const listContentFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = getDb();
    const { results } = await db
      .prepare("SELECT id, title, description, type, state, channels, asset_key, created_at, updated_at FROM content_items WHERE user_id = ? ORDER BY updated_at DESC")
      .bind(context.session.userId)
      .all<ContentItem>();
    return (results ?? []).map((r: ContentItem) => ({ ...r }));
  });

export const createContentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ title: z.string().min(1), description: z.string().optional(), type: z.string().optional(), channels: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const id = newId();
    await db
      .prepare("INSERT INTO content_items (id, user_id, title, description, type, channels) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, context.session.userId, data.title, data.description ?? null, data.type ?? "video", data.channels ?? null)
      .run();
    return { id };
  });

export const deleteContentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    const db = getDb();
    await db.prepare("DELETE FROM content_items WHERE id = ? AND user_id = ?").bind(data.id, context.session.userId).run();
    return { ok: true };
  });