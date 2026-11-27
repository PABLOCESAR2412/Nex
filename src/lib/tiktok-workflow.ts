import { createServerOnlyFn } from "@tanstack/react-start";
import { getDb, newId } from "./db";
import { randomSecret, sha256Hex } from "./instagram";
import {
  decryptTikTokToken, encryptTikTokToken, exchangeTikTokCode, fetchTikTokUploadStatus,
  getTikTokProfile, initializeTikTokUpload, refreshTikTokToken, tikTokAuthorizationUrl, tikTokConfig, TikTokApiError,
} from "./tiktok";

type Tokens = Awaited<ReturnType<typeof exchangeTikTokCode>>;
type Account = {
  id: string;
  external_account_id: string;
  handle: string;
  token_ciphertext: string | null;
  token_iv: string | null;
  token_expires_at: string | null;
};
type Job = {
  id: string;
  status: string;
  account_id: string;
  content_id: string;
  publish_id: string | null;
  media_id: string | null;
  title: string;
  description: string | null;
  error: string | null;
  created_at: string;
};

const after = (milliseconds: number) => new Date(Date.now() + milliseconds).toISOString();
const approvedStates = ["aprobada", "publicada"];
const videoTypes = ["video/mp4", "video/quicktime", "video/webm"];

export const beginTikTokAuthorization = createServerOnlyFn(async (userId: string, origin: string) => {
  const state = randomSecret();
  const url = tikTokAuthorizationUrl(state, origin);
  const db = getDb();
  await db.batch([
    db.prepare("DELETE FROM tiktok_oauth_states WHERE expires_at <= ?").bind(after(0)),
    db.prepare("INSERT INTO tiktok_oauth_states (state_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256Hex(state), userId, after(10 * 60_000)),
  ]);
  return url;
});

async function protectTokens(tokens: Tokens) {
  const { ciphertext, iv } = await encryptTikTokToken(JSON.stringify({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    refreshExpiresAt: after(tokens.refresh_expires_in * 1000),
  }));
  return { ciphertext, iv, expiresAt: after(tokens.expires_in * 1000) };
}

export const completeTikTokAuthorization = createServerOnlyFn(async (userId: string, origin: string, code: string, state: string) => {
  const db = getDb();
  const consumed = await db.prepare("DELETE FROM tiktok_oauth_states WHERE state_hash = ? AND user_id = ? AND expires_at > ? RETURNING state_hash")
    .bind(await sha256Hex(state), userId, after(0)).first();
  if (!consumed) return "expired";

  const tokens = await exchangeTikTokCode(code, origin);
  const profile = await getTikTokProfile(tokens.access_token);
  if (profile.open_id !== tokens.open_id) throw new Error("La cuenta devuelta por TikTok no coincide.");
  const handle = profile.display_name;
  const newAccountId = newId();
  const { ciphertext, iv, expiresAt } = await protectTokens(tokens);
  const account = await db.prepare(`INSERT INTO social_accounts
      (id, user_id, platform, handle, status, external_account_id, token_ciphertext, token_iv, token_expires_at, connected_at)
      VALUES (?, ?, 'TikTok', ?, 'conectada', ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, platform, external_account_id) WHERE external_account_id IS NOT NULL
      DO UPDATE SET handle = excluded.handle, status = 'conectada', token_ciphertext = excluded.token_ciphertext,
        token_iv = excluded.token_iv, token_expires_at = excluded.token_expires_at, connected_at = excluded.connected_at,
        tiktok_refresh_lock = NULL, updated_at = datetime('now')
      RETURNING id`)
    .bind(newAccountId, userId, handle, profile.open_id, ciphertext, iv, expiresAt, after(0)).first<{ id: string }>();
  return account?.id === newAccountId ? "connected" : "reconnected";
});

export const disconnectTikTokAccount = createServerOnlyFn(async (userId: string, accountId: string) => {
  const db = getDb();
  const [result] = await db.batch([
    db.prepare(`UPDATE social_accounts SET status = 'desconectada', token_ciphertext = NULL, token_iv = NULL,
        token_expires_at = NULL, tiktok_refresh_lock = NULL, updated_at = datetime('now')
        WHERE id = ? AND user_id = ? AND platform = 'TikTok' AND provider = 'nex'`).bind(accountId, userId),
    db.prepare(`UPDATE tiktok_upload_jobs SET media_hash = NULL, media_expires_at = NULL, status = 'needs_review',
        error = 'Cuenta desconectada. Revisa la bandeja de TikTok antes de volver a enviar el video.'
        WHERE account_id = ? AND user_id = ? AND status IN ('creating', 'processing')`).bind(accountId, userId),
  ]);
  return !!result.meta.changes;
});

function findAccount(userId: string, accountId: string) {
  return getDb().prepare(`SELECT id, external_account_id, handle, token_ciphertext, token_iv, token_expires_at
      FROM social_accounts WHERE id = ? AND user_id = ? AND platform = 'TikTok' AND provider = 'nex' AND status = 'conectada'`)
    .bind(accountId, userId).first<Account>();
}

async function accessToken(userId: string, account: Account) {
  if (!account.token_ciphertext || !account.token_iv) throw new Error("Vuelve a conectar la cuenta de TikTok.");
  const saved = JSON.parse(await decryptTikTokToken(account.token_ciphertext, account.token_iv)) as {
    accessToken: string; refreshToken: string; refreshExpiresAt: string;
  };
  if (account.token_expires_at && account.token_expires_at > after(30_000)) return saved.accessToken;
  if (saved.refreshExpiresAt <= after(0)) throw new Error("La autorización venció. Vuelve a conectar TikTok.");

  const db = getDb();
  const lease = after(60_000);
  const lock = await db.prepare(`UPDATE social_accounts SET tiktok_refresh_lock = ? WHERE id = ? AND user_id = ?
      AND token_ciphertext = ? AND (tiktok_refresh_lock IS NULL OR tiktok_refresh_lock <= ?)`)
    .bind(lease, account.id, userId, account.token_ciphertext, after(0)).run();
  if (!lock.meta.changes) throw new Error("La autorización de TikTok se está actualizando. Inténtalo de nuevo en unos segundos.");

  try {
    const refreshed = await refreshTikTokToken(saved.refreshToken);
    if (refreshed.open_id !== account.external_account_id) throw new Error("La cuenta devuelta por TikTok no coincide.");
    const { ciphertext, iv, expiresAt } = await protectTokens(refreshed);
    const result = await db.prepare(`UPDATE social_accounts SET token_ciphertext = ?, token_iv = ?, token_expires_at = ?,
        tiktok_refresh_lock = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND tiktok_refresh_lock = ?`)
      .bind(ciphertext, iv, expiresAt, account.id, userId, lease).run();
    if (!result.meta.changes) throw new Error("La cuenta de TikTok cambió durante la renovación. Inténtalo de nuevo.");
    return refreshed.access_token;
  } finally {
    await db.prepare("UPDATE social_accounts SET tiktok_refresh_lock = NULL WHERE id = ? AND user_id = ? AND tiktok_refresh_lock = ?")
      .bind(account.id, userId, lease).run();
  }
}

function jobResponse(job: Job, httpStatus = 200) {
  return Response.json({
    jobId: job.id, status: job.status, accountId: job.account_id, mediaId: job.media_id,
    title: job.title, description: job.description,
    caption: [job.title, job.description?.trim()].filter(Boolean).join("\n\n"), error: job.error,
  }, { status: httpStatus });
}

const failure = (error: string, status = 400) => Response.json({ error }, { status });

export const handleTikTokUploadRequest = createServerOnlyFn(async (request: Request, userId: string) => {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const db = getDb();
  if (input?.action === "start" && typeof input.contentId === "string" && typeof input.accountId === "string") {
    const existing = () => db.prepare("SELECT * FROM tiktok_upload_jobs WHERE user_id = ? AND content_id = ? AND account_id = ? AND status <> 'failed'")
      .bind(userId, input.contentId, input.accountId).first<Job>();
    const [previous, content, account] = await Promise.all([
      existing(),
      db.prepare("SELECT id, title, description, state, asset_key, asset_content_type, asset_size FROM content_items WHERE id = ? AND user_id = ?")
        .bind(input.contentId, userId).first<{ id: string; title: string; description: string | null; state: string; asset_key: string | null; asset_content_type: string | null; asset_size: number | null }>(),
      findAccount(userId, input.accountId),
    ]);
    if (previous) return jobResponse(previous);
    if (!content) return failure("No se encontró la pieza.", 404);
    if (!approvedStates.includes(content.state)) return failure("Aprueba la pieza antes de enviarla a TikTok.", 409);
    if (!content.asset_key || !content.asset_content_type || !videoTypes.includes(content.asset_content_type)) return failure("Adjunta un video MP4, MOV o WebM.");
    if (content.asset_size !== null && content.asset_size > 4_000_000_000) return failure("El video supera los 4 GB de TikTok.");
    if (!account) return failure("Vuelve a conectar la cuenta de TikTok.", 409);

    let publicAppUrl: string;
    try { ({ publicAppUrl } = tikTokConfig(new URL(request.url).origin)); }
    catch { return failure("TikTok todavía no está configurado en Nex.", 503); }
    let token: string;
    try { token = await accessToken(userId, account); }
    catch (error) { return failure(error instanceof Error ? error.message : "No se pudo autorizar la cuenta de TikTok.", 409); }

    const job: Job = { id: newId(), status: "creating", account_id: account.id, content_id: content.id,
      publish_id: null, media_id: null, title: content.title, description: content.description, error: null, created_at: after(0) };
    const mediaToken = randomSecret();
    const insert = await db.prepare(`INSERT INTO tiktok_upload_jobs
        (id, user_id, content_id, account_id, status, media_hash, media_expires_at, asset_key, asset_content_type, title, description)
        SELECT ?, c.user_id, c.id, a.id, 'creating', ?, ?, c.asset_key, c.asset_content_type, ?, ?
        FROM content_items c JOIN social_accounts a ON a.user_id = c.user_id
        WHERE c.id = ? AND c.user_id = ? AND c.asset_key = ? AND c.state IN ('aprobada', 'publicada')
          AND a.id = ? AND a.platform = 'TikTok' AND a.provider = 'nex' AND a.status = 'conectada'
        ON CONFLICT (content_id, account_id) WHERE status <> 'failed' DO NOTHING`)
      .bind(job.id, await sha256Hex(mediaToken), after(2 * 60 * 60_000), content.title, content.description,
        content.id, userId, content.asset_key, account.id).run();
    if (!insert.meta.changes) {
      const active = await existing();
      return active ? jobResponse(active) : failure("La pieza o la cuenta cambió. Revisa el destino y vuelve a intentarlo.", 409);
    }

    try {
      const result = await initializeTikTokUpload(token, `${publicAppUrl}/api/social/tiktok/media/${mediaToken}`);
      const saved = await db.prepare("UPDATE tiktok_upload_jobs SET status = 'processing', publish_id = ? WHERE id = ? AND status = 'creating'")
        .bind(result.publish_id, job.id).run();
      if (saved.meta.changes) return jobResponse({ ...job, status: "processing" }, 202);
      return jobResponse(await existing() ?? { ...job, status: "needs_review" });
    } catch (error) {
      const rejected = error instanceof TikTokApiError && error.httpStatus >= 400 && error.httpStatus < 500 && error.code !== "invalid_response";
      const status = rejected ? "failed" : "needs_review";
      const message = rejected ? error.message : "TikTok no confirmó el envío. Revisa su bandeja antes de volver a enviar el video.";
      await db.prepare(`UPDATE tiktok_upload_jobs SET status = ?, error = ?,
          media_hash = CASE WHEN ? = 'failed' THEN NULL ELSE media_hash END WHERE id = ? AND status = 'creating'`)
        .bind(status, message, status, job.id).run();
      return jobResponse({ ...job, status, error: message });
    }
  }

  if (input?.action === "check" && typeof input.jobId === "string") {
    const findJob = () => db.prepare("SELECT * FROM tiktok_upload_jobs WHERE id = ? AND user_id = ?").bind(input.jobId, userId).first<Job>();
    const job = await findJob();
    if (!job) return failure("No se encontró el envío a TikTok.", 404);
    if (job.status === "creating" && job.created_at < after(-120_000).replace("T", " ").slice(0, 19)) {
      const error = "TikTok no confirmó el envío. Revisa su bandeja antes de volver a enviar el video.";
      const updated = await db.prepare("UPDATE tiktok_upload_jobs SET status = 'needs_review', error = ? WHERE id = ? AND status = 'creating'")
        .bind(error, job.id).run();
      if (updated.meta.changes) return jobResponse({ ...job, status: "needs_review", error });
      return jobResponse(await findJob() ?? job);
    }
    if (!job.publish_id || !["processing", "awaiting_user"].includes(job.status)) return jobResponse(job);
    const account = await findAccount(userId, job.account_id);
    if (!account) return failure("Vuelve a conectar la cuenta de TikTok para consultar el estado.", 409);
    let result;
    try { result = await fetchTikTokUploadStatus(await accessToken(userId, account), job.publish_id); }
    catch (error) { return failure(error instanceof Error ? error.message : "No se pudo consultar TikTok.", 502); }

    const status = result.status === "PUBLISH_COMPLETE" ? "published" : result.status === "SEND_TO_USER_INBOX" ? "awaiting_user" : result.status === "FAILED" ? "failed" : job.status;
    if (status === job.status) return jobResponse(job);
    const mediaId = result.postIds?.[0] ?? null;
    const error = status === "failed" ? result.fail_reason ?? "TikTok no pudo procesar el video." : null;
    const update = db.prepare(`UPDATE tiktok_upload_jobs SET status = ?, media_id = ?, error = ?, media_hash = NULL
        WHERE id = ? AND user_id = ? AND status = ?`).bind(status, mediaId, error, job.id, userId, job.status);
    const changed = status === "published"
      ? (await db.batch([update, db.prepare(`UPDATE content_items SET state = 'publicada', scheduled_at = NULL, updated_at = datetime('now')
          WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM tiktok_upload_jobs WHERE id = ? AND status = 'published')`)
        .bind(job.content_id, userId, job.id)]))[0]
      : await update.run();
    if (!changed.meta.changes) return jobResponse(await findJob() ?? job);
    return jobResponse({ ...job, status, error, media_id: mediaId });
  }

  return failure("Indica el video y la cuenta de TikTok, o el identificador del envío.");
});
