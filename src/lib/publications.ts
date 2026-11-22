import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "./auth";
import { getDb, getRuntimeEnv, newId } from "./db";
import { handleInstagramPublishRequest } from "./instagram-publish";
import { checkTikTokPublication, startTikTokPublication } from "./tiktok";

export type PublicationStatus = "programada" | "en_curso" | "publicada" | "borrador_enviado" | "fallida" | "requiere_revision" | "cancelada";

export type PublicationSummary = {
  id: string;
  content_id: string;
  account_id: string;
  platform: string;
  handle: string | null;
  scheduled_at: string;
  status: PublicationStatus;
  error: string | null;
  updated_at: string;
};

export type PublicationRow = { id: string; user_id: string; content_id: string; account_id: string; platform: string; job_id: string | null; updated_at: string };

/** Resultado de consultar una publicación en curso en la red social. */
export type PublicationOutcome = { status: "en_curso" | "publicada" | "borrador_enviado" | "fallida" | "requiere_revision"; error?: string };

export type PublicationAdapter = {
  /** Inicia el envío y devuelve el identificador del trabajo. Lanza un Error si no pudo empezar. */
  start(publication: PublicationRow): Promise<string>;
  /** Consulta (y avanza) el trabajo. */
  check(publication: PublicationRow & { job_id: string }): Promise<PublicationOutcome>;
};

const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const RUNNABLE_CONTENT_STATES = ["aprobada", "programada", "publicada"];
const MAX_DUE_PER_CYCLE = 10;
const MAX_ACTIVE_PER_CYCLE = 20;
const START_CONFIRMATION_LIMIT_MS = 5 * 60_000;
const IN_PROGRESS_LIMIT_MS = 2 * 60 * 60_000;

function parseDbTime(value: string) {
  return new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z").getTime();
}

const PUBLICATION_SELECT = "SELECT p.id, p.content_id, p.account_id, p.platform, a.handle, p.scheduled_at, p.status, p.error, p.updated_at FROM publications p LEFT JOIN social_accounts a ON a.id = p.account_id";

export const listPublications = createServerOnlyFn(async (userId: string, contentId?: string): Promise<PublicationSummary[]> => {
  const statement = contentId
    ? getDb().prepare(PUBLICATION_SELECT + " WHERE p.user_id = ? AND p.content_id = ? ORDER BY p.created_at DESC, p.rowid DESC").bind(userId, contentId)
    : getDb().prepare(PUBLICATION_SELECT + " WHERE p.user_id = ? ORDER BY p.created_at DESC, p.rowid DESC LIMIT 200").bind(userId);
  const { results } = await statement.all<PublicationSummary>();
  return results ?? [];
});

/**
 * Programa una pieza aprobada en una o varias cuentas conectadas. Solo una pieza en estado «aprobada»
 * (que una persona aprobó en Nex) puede entrar en la cola; una pieza ya programada o publicada puede
 * añadir cuentas o cambiar la fecha porque ya tiene publicaciones.
 */
export const schedulePublications = createServerOnlyFn(async (userId: string, input: { contentId: string; accountIds: string[]; scheduledAt: string }) => {
  const scheduledAt = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new Error("La fecha de publicación debe estar en el futuro.");
  const accountIds = [...new Set(input.accountIds)];
  if (accountIds.length < 1 || accountIds.length > 10) throw new Error("Elige entre 1 y 10 cuentas.");

  const db = getDb();
  const content = await db.prepare("SELECT id, state, asset_key, asset_content_type FROM content_items WHERE id = ? AND user_id = ?")
    .bind(input.contentId, userId)
    .first<{ id: string; state: string; asset_key: string | null; asset_content_type: string | null }>();
  if (!content) throw new Error("No se encontró la pieza.");
  if (!content.asset_key || !VIDEO_TYPES.includes(content.asset_content_type ?? "")) throw new Error("La pieza necesita un video MP4 o MOV adjunto.");

  const { results: accounts } = await db
    .prepare(`SELECT id, platform FROM social_accounts WHERE user_id = ? AND status = 'conectada' AND external_account_id IS NOT NULL AND id IN (${accountIds.map(() => "?").join(",")})`)
    .bind(userId, ...accountIds)
    .all<{ id: string; platform: string }>();
  if ((accounts ?? []).length !== accountIds.length) throw new Error("Alguna cuenta no existe o no está conectada.");

  const { results: existing } = await db
    .prepare("SELECT id, account_id, status FROM publications WHERE content_id = ? AND user_id = ? AND status != 'cancelada'")
    .bind(content.id, userId)
    .all<{ id: string; account_id: string; status: string }>();
  const previous = existing ?? [];
  if (content.state !== "aprobada" && !(["programada", "publicada"].includes(content.state) && previous.length > 0)) {
    throw new Error("Aprueba la pieza en Nex antes de programar su publicación.");
  }

  const iso = scheduledAt.toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const account of accounts ?? []) {
    const open = previous.find((row) => row.account_id === account.id && ["programada", "en_curso"].includes(row.status));
    if (open?.status === "en_curso") throw new Error("Una publicación de esta pieza ya está en curso en esa cuenta.");
    statements.push(open
      ? db.prepare("UPDATE publications SET scheduled_at = ?, error = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'programada'").bind(iso, open.id, userId)
      : db.prepare("INSERT INTO publications (id, user_id, content_id, account_id, platform, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)").bind(newId(), userId, content.id, account.id, account.platform, iso));
  }
  statements.push(db.prepare("UPDATE content_items SET state = CASE WHEN state = 'publicada' THEN 'publicada' ELSE 'programada' END, scheduled_at = (SELECT MIN(scheduled_at) FROM publications WHERE content_id = ? AND status = 'programada'), updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(content.id, content.id, userId));
  await db.batch(statements);
  return listPublications(userId, content.id);
});

export const cancelPublication = createServerOnlyFn(async (userId: string, id: string) => {
  const db = getDb();
  const publication = await db.prepare("SELECT id, content_id, status FROM publications WHERE id = ? AND user_id = ?").bind(id, userId).first<{ id: string; content_id: string; status: string }>();
  if (!publication) throw new Error("No se encontró la publicación.");
  if (publication.status !== "programada") throw new Error("Solo se puede cancelar una publicación programada que aún no ha empezado.");
  const result = await db.prepare("UPDATE publications SET status = 'cancelada', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'programada'").bind(id, userId).run();
  if (!result.meta.changes) throw new Error("La publicación ya empezó y no se puede cancelar.");
  await settleContent(publication.content_id);
  return { ok: true };
});

/** Si ya no quedan publicaciones abiertas, la pieza deja de estar «programada» y pierde la fecha pendiente. */
async function settleContent(contentId: string) {
  await getDb()
    .prepare("UPDATE content_items SET state = CASE WHEN state = 'programada' THEN 'aprobada' ELSE state END, scheduled_at = NULL, updated_at = datetime('now') WHERE id = ? AND NOT EXISTS (SELECT 1 FROM publications WHERE content_id = ? AND status IN ('programada', 'en_curso'))")
    .bind(contentId, contentId)
    .run();
}

async function finish(publication: { id: string; content_id: string }, status: Exclude<PublicationStatus, "programada" | "en_curso">, error?: string) {
  const db = getDb();
  await db
    .prepare("UPDATE publications SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, error ? error.slice(0, 500) : null, publication.id)
    .run();
  // Una publicación confirmada por la red marca la pieza como publicada (Instagram ya lo hace por su cuenta; es idempotente).
  if (status === "publicada") {
    await db.prepare("UPDATE content_items SET state = 'publicada', scheduled_at = NULL, updated_at = datetime('now') WHERE id = ?").bind(publication.content_id).run();
  }
  await settleContent(publication.content_id);
}

/** Cierra las publicaciones abiertas de una cuenta que se desconecta, para que el cron no intente usarla. */
export const failOpenPublicationsForAccount = createServerOnlyFn(async (userId: string, accountId: string, message: string) => {
  const db = getDb();
  const { results } = await db
    .prepare("SELECT id, content_id FROM publications WHERE user_id = ? AND account_id = ? AND status IN ('programada', 'en_curso')")
    .bind(userId, accountId)
    .all<{ id: string; content_id: string }>();
  for (const publication of results ?? []) await finish(publication, "fallida", message);
  return (results ?? []).length;
});

async function callInstagram(userId: string, payload: Record<string, unknown>) {
  const origin = getRuntimeEnv().PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!origin) throw new Error("Configura PUBLIC_APP_URL para publicar en Instagram de forma programada.");
  const response = await handleInstagramPublishRequest(new Request(origin + "/api/social/instagram/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), userId);
  const data = await response.json().catch(() => ({})) as { jobId?: string; status?: string; error?: string };
  return { ok: response.ok, status: response.status, data };
}

const instagramAdapter: PublicationAdapter = {
  async start(publication) {
    const result = await callInstagram(publication.user_id, { action: "start", contentId: publication.content_id, accountId: publication.account_id, publicationId: publication.id });
    if (!result.data.jobId) throw new Error(result.data.error ?? "Instagram no pudo iniciar la publicación.");
    return result.data.jobId;
  },
  async check(publication) {
    const result = await callInstagram(publication.user_id, { action: "check", jobId: publication.job_id });
    if (result.data.status === "published") return { status: "publicada" };
    if (result.data.status === "failed") return { status: "fallida", error: result.data.error };
    if (result.data.status === "needs_review") return { status: "requiere_revision", error: result.data.error };
    // 404 o 409 no se resuelven solos (trabajo o token perdidos); el resto (502, 202) se reintenta en el siguiente ciclo.
    if ([404, 409].includes(result.status)) return { status: "fallida", error: result.data.error };
    return { status: "en_curso" };
  },
};

const tiktokAdapter: PublicationAdapter = { start: startTikTokPublication, check: checkTikTokPublication };

const adapters: Record<string, PublicationAdapter> = {
  Instagram: instagramAdapter,
  TikTok: tiktokAdapter,
};

/** Permite registrar o sustituir el adaptador de una red (los tests lo simulan). */
export const registerPublicationAdapter = createServerOnlyFn((platform: string, adapter: PublicationAdapter) => {
  adapters[platform] = adapter;
});

async function startDuePublications(now: Date) {
  const db = getDb();
  const { results } = await db
    .prepare("SELECT id, user_id, content_id, account_id, platform, job_id, updated_at FROM publications WHERE status = 'programada' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT ?")
    .bind(now.toISOString(), MAX_DUE_PER_CYCLE)
    .all<PublicationRow>();
  let started = 0;
  for (const publication of results ?? []) {
    // Reclamar la fila evita que dos ciclos solapados publiquen lo mismo dos veces.
    const claimed = await db.prepare("UPDATE publications SET status = 'en_curso', error = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'programada'").bind(publication.id).run();
    if (!claimed.meta.changes) continue;
    started++;
    try {
      const content = await db.prepare("SELECT state, asset_key FROM content_items WHERE id = ? AND user_id = ?").bind(publication.content_id, publication.user_id).first<{ state: string; asset_key: string | null }>();
      if (!content || !content.asset_key || !RUNNABLE_CONTENT_STATES.includes(content.state)) {
        await finish(publication, "cancelada", "La pieza ya no está aprobada o programada, así que no se publicó.");
        continue;
      }
      const adapter = adapters[publication.platform];
      if (!adapter) throw new Error("Nex todavía no publica en " + publication.platform + ".");
      const jobId = await adapter.start(publication);
      await db.prepare("UPDATE publications SET job_id = ?, updated_at = datetime('now') WHERE id = ?").bind(jobId, publication.id).run();
    } catch (error) {
      await finish(publication, "fallida", error instanceof Error ? error.message : "No se pudo iniciar la publicación.");
    }
  }
  return started;
}

async function advanceActivePublications(now: Date) {
  const db = getDb();
  const { results } = await db
    .prepare("SELECT id, user_id, content_id, account_id, platform, job_id, updated_at FROM publications WHERE status = 'en_curso' ORDER BY updated_at LIMIT ?")
    .bind(MAX_ACTIVE_PER_CYCLE)
    .all<PublicationRow>();
  let settled = 0;
  for (const publication of results ?? []) {
    try {
      const age = now.getTime() - parseDbTime(publication.updated_at);
      if (!publication.job_id) {
        if (age > START_CONFIRMATION_LIMIT_MS) {
          await finish(publication, "requiere_revision", "No se pudo confirmar que la publicación empezó. Revisa la cuenta antes de reintentar.");
          settled++;
        }
        continue;
      }
      const adapter = adapters[publication.platform];
      if (!adapter) continue;
      const outcome = await adapter.check({ ...publication, job_id: publication.job_id });
      if (outcome.status !== "en_curso") {
        await finish(publication, outcome.status, outcome.error);
        settled++;
      } else if (age > IN_PROGRESS_LIMIT_MS) {
        await finish(publication, "requiere_revision", "La red social no confirmó el resultado en dos horas. Revisa la cuenta.");
        settled++;
      }
    } catch (error) {
      console.error("publication check failed", publication.id, error instanceof Error ? error.message : error);
    }
  }
  return settled;
}

/** Un ciclo del cron: lanza lo que venció y avanza lo que está en curso. */
export const runPublicationCycle = createServerOnlyFn(async (now = new Date()) => {
  const started = await startDuePublications(now);
  const settled = await advanceActivePublications(now);
  return { started, settled };
});

export const listPublicationsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listPublications(context.session.userId));

export const schedulePublicationsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ contentId: z.string().uuid(), accountIds: z.array(z.string().uuid()).min(1).max(10), scheduledAt: z.string().datetime() }))
  .handler(async ({ data, context }) => schedulePublications(context.session.userId, data));

export const cancelPublicationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => cancelPublication(context.session.userId, data.id));
