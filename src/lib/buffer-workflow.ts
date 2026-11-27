import { createServerOnlyFn } from "@tanstack/react-start";
import { BufferApiError, createBufferVideoPost, getBufferChannels, getBufferPost, type BufferPost } from "./buffer";
import { getDb, getRuntimeEnv, newId } from "./db";
import { randomSecret, sha256Hex } from "./instagram";

type BufferAccount = { id: string; platform: "Instagram" | "TikTok"; external_account_id: string; status: string };
type BufferJob = {
  id: string; account_id: string; content_id: string; status: string; created_at: string;
  provider_post_id: string | null; scheduling_type: string | null; external_link: string | null;
  title: string; description: string | null; caption: string; error: string | null; detail: string | null;
};
const videoTypes = ["video/mp4", "video/quicktime"];
const mediaLifetimeMs = 7 * 24 * 60 * 60_000;
const timestamp = (delta = 0) => new Date(Date.now() + delta).toISOString();
const externalId = (channelId: string) => `buffer:${channelId}`;
const failure = (error: string, status = 400) => Response.json({ error }, { status });

function config() {
  const env = getRuntimeEnv();
  const apiKey = env.BUFFER_API_KEY?.trim();
  const orgId = env.BUFFER_ORGANIZATION_ID?.trim();
  return apiKey && orgId ? { apiKey, orgId } : null;
}

export const syncBufferAccounts = createServerOnlyFn(async (userId: string) => {
  const settings = config();
  if (!settings) return failure("Configura la clave y la organización de Buffer en Nex.", 503);
  try {
    const channels = await getBufferChannels(settings.apiKey, settings.orgId);
    const db = getDb();
    const now = timestamp();
    await db.batch([
      db.prepare(`UPDATE social_accounts SET status = 'requiere_atencion', updated_at = datetime('now')
        WHERE user_id = ? AND provider = 'buffer' AND status <> 'desconectada'`).bind(userId),
      ...channels.map((channel) => db.prepare(`INSERT INTO social_accounts
          (id, user_id, platform, provider, external_account_id, buffer_organization_id, handle, status, connected_at)
          VALUES (?, ?, ?, 'buffer', ?, ?, ?, ?, ?)
          ON CONFLICT (user_id, platform, external_account_id) WHERE external_account_id IS NOT NULL
          DO UPDATE SET buffer_organization_id = excluded.buffer_organization_id, handle = excluded.handle,
            status = excluded.status, connected_at = excluded.connected_at, updated_at = datetime('now')
          WHERE social_accounts.provider = 'buffer'`)
        .bind(newId(), userId, channel.service === "instagram" ? "Instagram" : "TikTok", externalId(channel.id), settings.orgId,
          channel.name, channel.isDisconnected || channel.isLocked ? "requiere_atencion" : "conectada", now)),
    ]);
    return Response.json({ ok: true, synced: channels.length });
  } catch (error) {
    return failure(error instanceof BufferApiError ? error.message : "No se pudieron sincronizar las cuentas de Buffer.", 502);
  }
});

export const disconnectBufferAccount = createServerOnlyFn(async (userId: string, accountId: string) => {
  const result = await getDb().prepare(`UPDATE social_accounts SET status = 'desconectada', updated_at = datetime('now')
      WHERE user_id = ? AND id = ? AND provider = 'buffer'`).bind(userId, accountId).run();
  return result.meta.changes ? Response.json({ ok: true }) : failure("No se encontró la cuenta de Buffer.", 404);
});

function jobResponse(job: BufferJob, status = 200) {
  return Response.json({
    provider: "buffer", jobId: job.id, accountId: job.account_id, status: job.status, postId: job.provider_post_id,
    url: job.external_link, title: job.title, description: job.description, caption: job.caption, error: job.error, detail: job.detail,
  }, { status });
}

function publicMediaUrl(request: Request, token: string) {
  const origin = new URL(getRuntimeEnv().PUBLIC_APP_URL?.trim() || new URL(request.url).origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Configura el origen HTTPS público de Nex para que Buffer pueda leer el video.");
  }
  return new URL(`/api/social/buffer/media/${token}`, origin).href;
}

function bufferStatus(post: BufferPost, oldSchedulingType: string | null) {
  if (post.status === "error") return { status: "failed", error: "Buffer no pudo publicar el video. Revisa el envío en Buffer.", detail: null };
  if (post.status === "needs_approval") return { status: "awaiting_user", error: null, detail: "El envío necesita aprobación en Buffer." };
  if (post.status === "draft") return { status: "awaiting_user", error: null, detail: "Abre el borrador en Buffer para terminar el envío." };
  if (post.status === "sent") {
    if ((post.schedulingType ?? oldSchedulingType) === "notification" && post.notificationStatus !== "markedAsPublished") {
      return { status: "awaiting_user", error: null, detail: "Abre la notificación de Buffer y termina de publicar en la app de la red social." };
    }
    return { status: "published", error: null, detail: null };
  }
  return { status: "processing", error: null, detail: null };
}

async function recordPost(job: BufferJob, post: BufferPost) {
  const next = { ...job, ...bufferStatus(post, job.scheduling_type), provider_post_id: post.id,
    scheduling_type: post.schedulingType ?? job.scheduling_type, external_link: post.externalLink };
  const done = next.status === "published" || next.status === "failed";
  const db = getDb();
  const update = db.prepare(`UPDATE buffer_publish_jobs SET status = ?, provider_post_id = ?, scheduling_type = ?, external_link = ?, error = ?, detail = ?,
      media_hash = CASE WHEN ? THEN NULL ELSE media_hash END
      WHERE id = ? AND user_id = (SELECT user_id FROM content_items WHERE id = ?) AND status = ?`)
    .bind(next.status, post.id, next.scheduling_type, next.external_link, next.error, next.detail, done ? 1 : 0, job.id, job.content_id, job.status);
  if (next.status === "published") {
    await db.batch([update, db.prepare(`UPDATE content_items SET state = 'publicada', scheduled_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND EXISTS (SELECT 1 FROM buffer_publish_jobs WHERE id = ? AND status = 'published')`).bind(job.content_id, job.id)]);
  } else {
    await update.run();
  }
  return await db.prepare("SELECT * FROM buffer_publish_jobs WHERE id = ? AND content_id = ?").bind(job.id, job.content_id).first<BufferJob>() ?? next;
}

export const handleBufferPublishRequest = createServerOnlyFn(async (request: Request, userId: string) => {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const settings = config();
  if (!settings) return failure("Configura Buffer en Nex antes de enviar videos.", 503);
  const db = getDb();

  if (input?.action === "start" && typeof input.contentId === "string" && typeof input.accountId === "string") {
    const previous = () => db.prepare(`SELECT * FROM buffer_publish_jobs
      WHERE user_id = ? AND content_id = ? AND account_id = ? AND status <> 'failed'`).bind(userId, input.contentId, input.accountId).first<BufferJob>();
    const [content, account, existing] = await Promise.all([
      db.prepare("SELECT id, title, description, state, asset_key, asset_content_type FROM content_items WHERE id = ? AND user_id = ?")
        .bind(input.contentId, userId).first<{ id: string; title: string; description: string | null; state: string; asset_key: string | null; asset_content_type: string | null }>(),
      db.prepare(`SELECT id, platform, external_account_id, status FROM social_accounts WHERE id = ? AND user_id = ?
        AND provider = 'buffer' AND buffer_organization_id = ?`).bind(input.accountId, userId, settings.orgId).first<BufferAccount>(),
      previous(),
    ]);
    if (!account || (input.platform !== undefined && input.platform !== account.platform.toLowerCase())) return failure("No se encontró ese destino de Buffer.", 404);
    if (existing) return jobResponse(existing);
    if (!content) return failure("No se encontró la pieza.", 404);
    if (!["aprobada", "publicada"].includes(content.state)) return failure("Aprueba la pieza antes de enviarla a Buffer.", 409);
    if (!content.asset_key || !videoTypes.includes(content.asset_content_type ?? "")) return failure("Adjunta un video MP4 o MOV.");
    if (account.status !== "conectada") return failure("Revisa este canal en Buffer y vuelve a sincronizar tus cuentas.", 409);

    let channel;
    try {
      const channels = await getBufferChannels(settings.apiKey, settings.orgId);
      channel = channels.find((row) => externalId(row.id) === account.external_account_id && row.service === account.platform.toLowerCase());
    } catch (error) {
      return failure(error instanceof BufferApiError ? error.message : "No se pudo consultar la cuenta en Buffer.", 502);
    }
    if (!channel || channel.isLocked || channel.isDisconnected) return failure("El canal no está disponible en Buffer. Revisa su conexión y sincroniza Cuentas.", 409);

    const caption = [content.title.trim(), content.description?.trim()].filter(Boolean).join("\n\n");
    if (caption.length > 2200) return failure("Acorta el título y la descripción. Buffer admite hasta 2200 caracteres en este envío.");
    const token = randomSecret();
    let videoUrl: string;
    try { videoUrl = publicMediaUrl(request, token); }
    catch (error) { return failure(error instanceof Error ? error.message : "Configura el origen HTTPS de Nex.", 503); }
    const now = timestamp();
    const job: BufferJob = { id: newId(), account_id: account.id, content_id: content.id, status: "creating", created_at: now,
      provider_post_id: null, scheduling_type: null, external_link: null, title: content.title, description: content.description, caption, error: null, detail: null };
    const reserve = await db.prepare(`INSERT INTO buffer_publish_jobs
      (id, user_id, content_id, account_id, status, media_hash, media_expires_at, asset_key, asset_content_type, title, description, caption, created_at)
      SELECT ?, c.user_id, c.id, a.id, 'creating', ?, ?, c.asset_key, c.asset_content_type, c.title, c.description, ?, ?
      FROM content_items c JOIN social_accounts a ON a.user_id = c.user_id
      WHERE c.id = ? AND c.user_id = ? AND c.asset_key = ? AND c.title = ? AND c.description IS ? AND c.state IN ('aprobada', 'publicada')
        AND a.id = ? AND a.provider = 'buffer' AND a.buffer_organization_id = ? AND a.status = 'conectada'
      ON CONFLICT (content_id, account_id) WHERE status <> 'failed' DO NOTHING`)
      .bind(job.id, await sha256Hex(token), timestamp(mediaLifetimeMs), caption, now, content.id, userId,
        content.asset_key, content.title, content.description, account.id, settings.orgId).run();
    if (!reserve.meta.changes) {
      const pending = await previous();
      return pending ? jobResponse(pending) : failure("La pieza o la cuenta cambió. Revisa el destino y vuelve a intentarlo.", 409);
    }

    try {
      const post = await createBufferVideoPost(settings.apiKey, { channel, caption, videoUrl });
      if (post.channelId !== channel.id) throw new Error("Buffer devolvió otro destino.");
      return jobResponse(await recordPost(job, post));
    } catch (error) {
      const rejected = error instanceof BufferApiError && error.definitive;
      const status = rejected ? "failed" : "needs_review";
      const message = rejected ? error.message : "Buffer no confirmó el envío. Revisa el canal en Buffer antes de repetirlo.";
      await db.prepare(`UPDATE buffer_publish_jobs SET status = ?, error = ?, media_hash = CASE WHEN ? THEN NULL ELSE media_hash END
        WHERE id = ? AND user_id = ? AND status = 'creating'`).bind(status, message, rejected ? 1 : 0, job.id, userId).run();
      const saved = await db.prepare("SELECT * FROM buffer_publish_jobs WHERE id = ? AND user_id = ?").bind(job.id, userId).first<BufferJob>();
      return jobResponse(saved ?? { ...job, status, error: message });
    }
  }

  if (input?.action === "check" && typeof input.jobId === "string") {
    const found = await db.prepare(`SELECT j.*, a.external_account_id, a.platform FROM buffer_publish_jobs j
      JOIN social_accounts a ON a.id = j.account_id AND a.user_id = j.user_id
      WHERE j.id = ? AND j.user_id = ? AND a.provider = 'buffer' AND a.buffer_organization_id = ?`)
      .bind(input.jobId, userId, settings.orgId).first<BufferJob & Pick<BufferAccount, "external_account_id" | "platform">>();
    if (!found || (input.platform !== undefined && input.platform !== found.platform.toLowerCase())) return failure("No se encontró el envío a Buffer.", 404);
    if (found.status === "creating" && found.created_at < timestamp(-120_000)) {
      const error = "Buffer no confirmó el envío. Revisa su historial antes de intentarlo otra vez.";
      const changed = await db.prepare("UPDATE buffer_publish_jobs SET status = 'needs_review', error = ? WHERE id = ? AND user_id = ? AND status = 'creating'")
        .bind(error, found.id, userId).run();
      if (changed.meta.changes) return jobResponse({ ...found, status: "needs_review", error });
    }
    if (!found.provider_post_id || ["published", "failed"].includes(found.status)) return jobResponse(found);
    try {
      const post = await getBufferPost(settings.apiKey, found.provider_post_id);
      if (post.id !== found.provider_post_id || externalId(post.channelId) !== found.external_account_id) {
        return failure("Buffer devolvió una publicación distinta. Revisa el envío en Buffer.", 502);
      }
      return jobResponse(await recordPost(found, post));
    } catch (error) {
      return failure(error instanceof BufferApiError ? error.message : "No se pudo consultar el envío en Buffer.", 502);
    }
  }

  return failure("Indica el video y la cuenta de Buffer, o el identificador del envío.");
});
