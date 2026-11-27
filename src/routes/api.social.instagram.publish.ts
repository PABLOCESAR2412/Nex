import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { getDb, newId } from "../lib/db";
import { decryptInstagramToken, instagramConfig, instagramRequest, randomSecret, sha256Hex } from "../lib/instagram";
import { getMcpUserId } from "../lib/mcp";
import { createServerOnlyFn } from "@tanstack/react-start";

type InstagramAccountRow = {
  id: string;
  external_account_id: string;
  token_ciphertext: string;
  token_iv: string;
  token_expires_at: string | null;
};

type PublishJobRow = {
  id: string;
  user_id: string;
  content_id: string;
  account_id: string;
  status: string;
  container_id: string | null;
  media_id: string | null;
  error: string | null;
  updated_at: string;
  external_account_id: string;
  token_ciphertext: string;
  token_iv: string;
};

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function existingJob(contentId: string, accountId: string) {
  const job = await getDb().prepare(`SELECT id, status, media_id FROM instagram_publish_jobs
    WHERE content_id = ? AND account_id = ?
    AND status IN ('creating', 'processing', 'publishing', 'published', 'needs_review')
    ORDER BY CASE status WHEN 'needs_review' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, created_at DESC LIMIT 1`)
    .bind(contentId, accountId)
    .first<{ id: string; status: string; media_id: string | null }>();
  if (!job) return null;
  if (job.status === "needs_review") return fail("Revisa en Instagram si esta pieza se publicó antes de volver a intentarlo.", 409);
  return Response.json(
    { jobId: job.id, status: job.status, mediaId: job.media_id, reused: true },
    { status: job.status === "published" ? 200 : 202 },
  );
}

async function requestBody(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
}

export const handleInstagramPublishRequest = createServerOnlyFn(async (request: Request, userId: string) => {
        const session = { userId };
        let config;
        try { config = instagramConfig(new URL(request.url).origin); } catch (error) { return fail(error instanceof Error ? error.message : "Instagram no está configurado.", 503); }
        const input = await requestBody(request);
        if (input?.action === "start") {
          if (typeof input.contentId !== "string" || typeof input.accountId !== "string") return fail("Elige una pieza y una cuenta.");
          const db = getDb();
          const [content, account] = await Promise.all([
            db.prepare("SELECT id, title, description, state, asset_key, asset_content_type, asset_size FROM content_items WHERE id = ? AND user_id = ?")
              .bind(input.contentId, session.userId)
              .first<{ id: string; title: string; description: string | null; state: string; asset_key: string | null; asset_content_type: string | null; asset_size: number | null }>(),
            db.prepare("SELECT id, external_account_id, token_ciphertext, token_iv, token_expires_at FROM social_accounts WHERE id = ? AND user_id = ? AND platform = 'Instagram' AND status = 'conectada'")
              .bind(input.accountId, session.userId)
              .first<InstagramAccountRow>(),
          ]);
          if (!content) return fail("No se encontró la pieza.", 404);
          if (!account?.token_ciphertext || !account.token_iv || !account.external_account_id) return fail("Vuelve a conectar la cuenta de Instagram.", 409);
          const existing = await existingJob(content.id, account.id);
          if (existing) return existing;
          if (content.state !== "aprobada" && content.state !== "publicada") return fail("Aprueba la pieza antes de publicarla.");
          if (!content.asset_key || !["video/mp4", "video/quicktime"].includes(content.asset_content_type ?? "")) return fail("Instagram requiere un video MP4 o MOV en la pieza.");
          if (content.asset_size !== null && content.asset_size > 1_000_000_000) return fail("El video supera el máximo de 1 GB admitido para un Reel.");
          if (account.token_expires_at && new Date(account.token_expires_at).getTime() <= Date.now()) return fail("La autorización de Instagram venció. Vuelve a conectar la cuenta.", 409);

          const jobId = newId();
          const grantToken = randomSecret();
          const tokenHash = await sha256Hex(grantToken);
          const grantExpiry = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
          try {
            const [created] = await db.batch([
              db.prepare(`INSERT INTO instagram_publish_jobs (id, user_id, content_id, account_id, status)
                SELECT ?, c.user_id, c.id, a.id, 'creating'
                FROM content_items c JOIN social_accounts a ON a.user_id = c.user_id
                WHERE c.id = ? AND c.user_id = ? AND c.asset_key = ? AND c.state IN ('aprobada', 'publicada')
                AND a.id = ? AND a.platform = 'Instagram' AND a.status = 'conectada' AND a.token_ciphertext = ?
                AND NOT EXISTS (
                  SELECT 1 FROM instagram_publish_jobs j WHERE j.content_id = c.id AND j.account_id = a.id
                  AND j.status IN ('published', 'needs_review')
                )`).bind(jobId, content.id, session.userId, content.asset_key, account.id, account.token_ciphertext),
              db.prepare(`INSERT INTO instagram_media_grants (token_hash, user_id, content_id, expires_at, job_id, asset_key, asset_content_type)
                SELECT ?, user_id, content_id, ?, id, ?, ? FROM instagram_publish_jobs WHERE id = ?`)
                .bind(tokenHash, grantExpiry, content.asset_key, content.asset_content_type, jobId),
            ]);
            if (!created.meta.changes) {
              return await existingJob(content.id, account.id) ?? fail("La pieza o la cuenta cambió. Revisa los datos e inténtalo de nuevo.", 409);
            }
          } catch {
            return await existingJob(content.id, account.id) ?? fail("No se pudo iniciar la publicación.", 500);
          }

          try {
            const token = await decryptInstagramToken(account.token_ciphertext, account.token_iv);
            const assetUrl = config.publicAppUrl + "/api/social/instagram/media/" + encodeURIComponent(grantToken);
            const params = new URLSearchParams({
              media_type: "REELS",
              video_url: assetUrl,
              caption: (content.description?.trim() || content.title).slice(0, 2200),
              share_to_feed: "true",
            });
            const container = await instagramRequest<{ id?: string }>(account.external_account_id + "/media", token, { method: "POST", body: params });
            if (!container.id) throw new Error("Instagram no devolvió el identificador del video.");
            const updated = await db.prepare("UPDATE instagram_publish_jobs SET status = 'processing', container_id = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'creating'")
              .bind(container.id, jobId, session.userId)
              .run();
            if (!updated.meta.changes) return fail("La publicación se canceló mientras Instagram preparaba el Reel.", 409);
            return Response.json({ jobId, status: "processing" }, { status: 202 });
          } catch (error) {
            await db.prepare("UPDATE instagram_publish_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'creating'")
              .bind(error instanceof Error ? error.message.slice(0, 500) : "No se pudo crear el video en Instagram.", jobId, session.userId)
              .run();
            await db.prepare("DELETE FROM instagram_media_grants WHERE token_hash = ?").bind(tokenHash).run();
            return fail(error instanceof Error ? error.message : "No se pudo crear el video en Instagram.", 502);
          }
        }

        if (input?.action === "check" && typeof input.jobId === "string") {
          const db = getDb();
          const job = await db.prepare("SELECT j.id, j.user_id, j.content_id, j.account_id, j.status, j.container_id, j.media_id, j.error, j.updated_at, a.external_account_id, a.token_ciphertext, a.token_iv FROM instagram_publish_jobs j JOIN social_accounts a ON a.id = j.account_id WHERE j.id = ? AND j.user_id = ? AND a.user_id = ?")
            .bind(input.jobId, session.userId, session.userId)
            .first<PublishJobRow>();
          if (!job) return fail("No se encontró la publicación.", 404);
          if (["published", "failed", "needs_review"].includes(job.status)) {
            return Response.json({ jobId: job.id, status: job.status, mediaId: job.media_id, error: job.error });
          }
          if (job.status === "creating" || job.status === "publishing") {
            const updatedAt = new Date(job.updated_at.replace(" ", "T") + "Z").getTime();
            if (Number.isFinite(updatedAt) && Date.now() - updatedAt > 300_000) {
              const creating = job.status === "creating";
              const status = creating ? "failed" : "needs_review";
              const message = creating
                ? "Instagram no confirmó la preparación del video. Puedes volver a intentarlo."
                : "Instagram no confirmó el resultado. Revisa la cuenta antes de intentar publicar otra vez.";
              const [changed] = await db.batch([
                db.prepare(`UPDATE instagram_publish_jobs SET status = ?, error = ?, updated_at = datetime('now')
                  WHERE id = ? AND status = ?`).bind(status, message, job.id, job.status),
                db.prepare(`DELETE FROM instagram_media_grants WHERE job_id = ? AND EXISTS (
                  SELECT 1 FROM instagram_publish_jobs WHERE id = ? AND status = ?
                )`).bind(job.id, job.id, status),
              ]);
              if (changed.meta.changes) return Response.json({ jobId: job.id, status, error: message });
            }
            return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
          }
          if (!job.container_id) {
            return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
          }

          let token: string;
          try { token = await decryptInstagramToken(job.token_ciphertext, job.token_iv); }
          catch { return fail("No se pudo descifrar el token de Instagram. Vuelve a conectar la cuenta.", 409); }

          let container: { status_code?: string; status?: string };
          try {
            container = await instagramRequest<{ status_code?: string; status?: string }>(job.container_id + "?fields=status_code,status", token);
          } catch (error) {
            return fail(error instanceof Error ? error.message : "No se pudo consultar Instagram.", 502);
          }
          const containerStatus = container.status_code?.toUpperCase();
          if (containerStatus === "ERROR" || containerStatus === "EXPIRED") {
            const message = container.status || "Instagram no pudo procesar el video.";
            await db.prepare("UPDATE instagram_publish_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'processing'")
              .bind(message.slice(0, 500), job.id)
              .run();
            await db.prepare("DELETE FROM instagram_media_grants WHERE job_id = ?").bind(job.id).run();
            return Response.json({ jobId: job.id, status: "failed", error: message });
          }
          if (containerStatus !== "FINISHED") {
            return Response.json({ jobId: job.id, status: "processing", detail: container.status ?? "Instagram está procesando el video." }, { status: 202 });
          }

          const lock = await db.prepare("UPDATE instagram_publish_jobs SET status = 'publishing', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'processing'")
            .bind(job.id, session.userId)
            .run();
          if (!lock.meta.changes) return Response.json({ jobId: job.id, status: "publishing" }, { status: 202 });
          try {
            const published = await instagramRequest<{ id?: string }>(
              job.external_account_id + "/media_publish",
              token,
              { method: "POST", body: new URLSearchParams({ creation_id: job.container_id }) },
            );
            if (!published.id) throw new Error("Instagram no devolvió el identificador publicado.");
            await db.batch([
              db.prepare("UPDATE instagram_publish_jobs SET status = 'published', media_id = ?, error = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
                .bind(published.id, job.id, session.userId),
              db.prepare("UPDATE content_items SET state = 'publicada', scheduled_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
                .bind(job.content_id, session.userId),
              db.prepare("DELETE FROM instagram_media_grants WHERE job_id = ?").bind(job.id),
            ]);
            return Response.json({ jobId: job.id, status: "published", mediaId: published.id });
          } catch {
            const message = "Instagram no confirmó el resultado. Revisa la cuenta antes de intentar publicar otra vez.";
            await db.prepare("UPDATE instagram_publish_jobs SET status = 'needs_review', error = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'publishing'")
              .bind(message, job.id, session.userId)
              .run();
            await db.prepare("DELETE FROM instagram_media_grants WHERE job_id = ?").bind(job.id).run();
            return Response.json({ jobId: job.id, status: "needs_review", error: message }, { status: 502 });
          }
        }

        return fail("Acción de publicación desconocida.");
});

export const Route = createFileRoute("/api/social/instagram/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getCurrentSession();
        if (session?.passwordChangeRequired) return fail("Cambia la contraseña antes de publicar.", 403);
        const userId = session?.userId ?? await getMcpUserId(request);
        if (!userId) return fail("Conecta una sesión o una clave MCP válida para publicar.", 401);
        return handleInstagramPublishRequest(request, userId);
      },
    },
  },
});
