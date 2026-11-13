import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { getDb, getRuntimeEnv, newId } from "../lib/db";
import { decryptInstagramToken, instagramConfig, instagramRequest, randomSecret, sha256Hex } from "../lib/instagram";

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

async function requestBody(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
}

export const Route = createFileRoute("/api/social/instagram/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getCurrentSession();
        if (!session) return fail("Inicia sesión para publicar.", 401);
        let config;
        try { config = instagramConfig(); } catch (error) { return fail(error instanceof Error ? error.message : "Instagram no está configurado.", 503); }
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
          if (content.state !== "aprobada") return fail("Aprueba la pieza antes de publicarla.");
          if (!content.asset_key || !["video/mp4", "video/quicktime"].includes(content.asset_content_type ?? "")) return fail("Instagram requiere un video MP4 o MOV en la pieza.");
          if (content.asset_size !== null && content.asset_size > 1_000_000_000) return fail("El video supera el máximo de 1 GB admitido para un Reel.");
          if (!account?.token_ciphertext || !account.token_iv || !account.external_account_id) return fail("Vuelve a conectar la cuenta de Instagram.", 409);
          if (account.token_expires_at && new Date(account.token_expires_at).getTime() <= Date.now()) return fail("La autorización de Instagram venció. Vuelve a conectar la cuenta.", 409);

          const unresolved = await db.prepare("SELECT id FROM instagram_publish_jobs WHERE content_id = ? AND account_id = ? AND status = 'needs_review' ORDER BY created_at DESC LIMIT 1")
            .bind(content.id, account.id)
            .first<{ id: string }>();
          if (unresolved) return fail("Revisa en Instagram si esta pieza se publicó antes de volver a intentarlo.", 409);

          const existing = await db.prepare("SELECT id, status FROM instagram_publish_jobs WHERE content_id = ? AND account_id = ? AND status IN ('creating', 'processing', 'publishing') ORDER BY created_at DESC LIMIT 1")
            .bind(content.id, account.id)
            .first<{ id: string; status: string }>();
          if (existing) return Response.json({ jobId: existing.id, status: existing.status, reused: true }, { status: 202 });

          const jobId = newId();
          const grantToken = randomSecret();
          const grantExpiry = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
          try {
            await db.prepare("INSERT INTO instagram_publish_jobs (id, user_id, content_id, account_id, status) VALUES (?, ?, ?, ?, 'creating')")
              .bind(jobId, session.userId, content.id, account.id)
              .run();
          } catch {
            const active = await db.prepare("SELECT id, status FROM instagram_publish_jobs WHERE content_id = ? AND account_id = ? AND status IN ('creating', 'processing', 'publishing') ORDER BY created_at DESC LIMIT 1")
              .bind(content.id, account.id)
              .first<{ id: string; status: string }>();
            if (active) return Response.json({ jobId: active.id, status: active.status, reused: true }, { status: 202 });
            return fail("No se pudo iniciar la publicación.", 500);
          }

          const tokenHash = await sha256Hex(grantToken);
          await db.prepare("INSERT INTO instagram_media_grants (token_hash, user_id, content_id, expires_at) VALUES (?, ?, ?, ?)")
            .bind(tokenHash, session.userId, content.id, grantExpiry)
            .run();

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
            await db.prepare("UPDATE instagram_publish_jobs SET status = 'processing', container_id = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
              .bind(container.id, jobId, session.userId)
              .run();
            return Response.json({ jobId, status: "processing" }, { status: 202 });
          } catch (error) {
            await db.prepare("UPDATE instagram_publish_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
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
          if (job.status === "publishing") {
            const updatedAt = new Date(job.updated_at.replace(" ", "T") + "Z").getTime();
            if (Number.isFinite(updatedAt) && Date.now() - updatedAt > 120_000) {
              const message = "Instagram no confirmó el resultado. Revisa la cuenta antes de intentar publicar otra vez.";
              await db.prepare("UPDATE instagram_publish_jobs SET status = 'needs_review', error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'publishing'")
                .bind(message, job.id)
                .run();
              return Response.json({ jobId: job.id, status: "needs_review", error: message });
            }
            return Response.json({ jobId: job.id, status: "publishing" }, { status: 202 });
          }
          if (job.status === "creating" || !job.container_id) {
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
            await db.prepare("DELETE FROM instagram_media_grants WHERE user_id = ? AND content_id = ?").bind(session.userId, job.content_id).run();
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
              db.prepare("DELETE FROM instagram_media_grants WHERE user_id = ? AND content_id = ?")
                .bind(session.userId, job.content_id),
            ]);
            return Response.json({ jobId: job.id, status: "published", mediaId: published.id });
          } catch {
            const message = "Instagram no confirmó el resultado. Revisa la cuenta antes de intentar publicar otra vez.";
            await db.prepare("UPDATE instagram_publish_jobs SET status = 'needs_review', error = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
              .bind(message, job.id, session.userId)
              .run();
            await db.prepare("DELETE FROM instagram_media_grants WHERE user_id = ? AND content_id = ?").bind(session.userId, job.content_id).run();
            return Response.json({ jobId: job.id, status: "needs_review", error: message }, { status: 502 });
          }
        }

        return fail("Acción de publicación desconocida.");
      },
    },
  },
});
