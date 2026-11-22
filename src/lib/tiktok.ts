import { createServerOnlyFn } from "@tanstack/react-start";
import { getAssets, getDb, getRuntimeEnv } from "./db";
import type { PublicationOutcome, PublicationRow } from "./publications";
import { decryptToken, encryptToken, randomSecret, sha256Hex, tokenEncryptionSecret } from "./token-crypto";

// Conector de TikTok (Content Posting API, flujo «Upload»): Nex sube el video a la bandeja de TikTok como
// borrador y la persona lo termina y publica desde la app de TikTok. No usa Direct Post, que exige auditoría.
const API = "https://open.tiktokapis.com";
const SCOPES = "user.info.basic,video.upload";
const MIN_CHUNK = 5 * 1024 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;
const MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024;
const TIKTOK_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const REFRESH_MARGIN_MS = 5 * 60_000;
const LEASE_MS = 5 * 60_000;

/**
 * Ajustes de la subida por trozos. TikTok exige trozos de 5 a 64 MB (el último puede llegar a 128 MB) y que se
 * suban en orden. Cada ciclo del cron sube como mucho `bytesPerCycle` (siempre al menos un trozo) y guarda el
 * avance, así una subida grande continúa en el ciclo siguiente. El enlace de subida de TikTok dura una hora.
 */
export const tiktokTuning = { chunkSize: MAX_CHUNK, bytesPerCycle: 2 * MAX_CHUNK, maxChunkAttempts: 3 };

export class TikTokError extends Error {
  constructor(message: string, readonly retryable = false, readonly code?: string) {
    super(message);
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  access_token_invalid: "La autorización de TikTok no es válida o venció. Vuelve a conectar la cuenta.",
  scope_not_authorized: "La cuenta no concedió el permiso para subir videos. Vuelve a conectarla aceptando todos los permisos.",
  spam_risk_too_many_pending_share: "TikTok permite como máximo 5 borradores pendientes cada 24 horas. Publica o descarta alguno en la app y vuelve a programar.",
  spam_risk_user_banned_from_posting: "TikTok bloqueó esta cuenta para publicar.",
  rate_limit_exceeded: "TikTok limitó temporalmente las solicitudes. Inténtalo de nuevo en unos minutos.",
  invalid_publish_id: "TikTok no reconoce esta publicación.",
  token_not_authorized_for_specified_publish_id: "El token actual no corresponde a esta publicación de TikTok.",
};

const FAIL_REASONS: Record<string, string> = {
  file_format_check_failed: "TikTok no admite el formato del video. Usa MP4 con H.264.",
  duration_check_failed: "La duración del video está fuera de lo que TikTok admite.",
  frame_rate_check_failed: "TikTok no admite la tasa de cuadros del video (de 23 a 60 FPS).",
  internal: "TikTok tuvo un error temporal. Vuelve a programar la publicación.",
  publish_cancelled: "La subida a TikTok se canceló.",
  auth_removed: "Se revocó el acceso de Nex a la cuenta de TikTok. Vuelve a conectarla.",
  spam_risk_too_many_posts: "Se superó el límite diario de TikTok para publicar por API. Publícalo desde la app.",
  spam_risk_user_banned_from_posting: "TikTok bloqueó esta cuenta para publicar.",
  spam_risk: "TikTok marcó la solicitud como riesgosa y no la procesó.",
  spam_risk_text: "TikTok marcó el texto como riesgoso y no lo procesó.",
};

function describeError(code: string | undefined, message: string | undefined) {
  return (code && ERROR_MESSAGES[code]) || message || "TikTok no pudo completar la solicitud.";
}

type TikTokEnvelope<T> = { data?: T; error?: { code?: string; message?: string } };

async function tiktokApi<T>(path: string, accessToken: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer " + accessToken,
        ...(body === undefined ? {} : { "content-type": "application/json; charset=UTF-8" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TikTokError("No se pudo contactar con TikTok.", true);
  }
  const json = await response.json().catch(() => null) as TikTokEnvelope<T> | null;
  const code = json?.error?.code;
  if (response.ok && json && (!code || code === "ok")) return (json.data ?? {}) as T;
  const retryable = response.status === 429 || response.status >= 500 || (response.ok && !json);
  throw new TikTokError(describeError(code, json?.error?.message), retryable, code);
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_token?: string;
  refresh_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function credentials() {
  const env = getRuntimeEnv();
  const clientKey = env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret) throw new Error("TikTok requiere configurar TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET.");
  return { clientKey, clientSecret };
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse & { access_token: string }> {
  const { clientKey, clientSecret } = credentials();
  let response: Response;
  try {
    response = await fetch(API + "/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, ...params }),
    });
  } catch {
    throw new TikTokError("No se pudo contactar con TikTok.", true);
  }
  const json = await response.json().catch(() => null) as TokenResponse | null;
  if (!response.ok || !json?.access_token || json.error) {
    throw new TikTokError(json?.error_description || "TikTok no entregó un token válido.", response.status === 429 || response.status >= 500, json?.error);
  }
  return json as TokenResponse & { access_token: string };
}

async function sealTokens(tokens: TokenResponse & { access_token: string }) {
  const now = Date.now();
  const access = await encryptToken(tokens.access_token);
  const refresh = tokens.refresh_token ? await encryptToken(tokens.refresh_token) : null;
  return {
    access,
    refresh,
    expiresAt: new Date(now + (typeof tokens.expires_in === "number" ? tokens.expires_in : 86_400) * 1000).toISOString(),
    refreshExpiresAt: tokens.refresh_token ? new Date(now + (typeof tokens.refresh_expires_in === "number" ? tokens.refresh_expires_in : 365 * 86_400) * 1000).toISOString() : null,
  };
}

/** Configuración de TikTok: credenciales de la app, clave de cifrado y URI de retorno (HTTPS, registrada en TikTok). */
export const tiktokConfig = createServerOnlyFn((requestOrigin?: string) => {
  const { clientKey, clientSecret } = credentials();
  tokenEncryptionSecret();
  const publicAppUrl = (getRuntimeEnv().PUBLIC_APP_URL?.trim() || requestOrigin?.trim() || "").replace(/\/+$/, "");
  let publicUrl: URL;
  try { publicUrl = new URL(publicAppUrl); } catch { throw new Error("TikTok requiere PUBLIC_APP_URL con el origen público de Nex."); }
  if (publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) throw new Error("PUBLIC_APP_URL debe ser solo el origen público de Nex.");
  if (publicUrl.protocol !== "https:") throw new Error("PUBLIC_APP_URL debe usar HTTPS para TikTok.");
  return { clientKey, clientSecret, publicAppUrl, redirectUri: publicAppUrl + "/api/social/tiktok/callback" };
});

export const isTikTokConfigured = createServerOnlyFn(() => {
  try {
    tiktokConfig("https://nex.invalid");
    return true;
  } catch {
    return false;
  }
});

/** Guarda un `state` de un solo uso y devuelve la URL de autorización de TikTok. */
export const startTikTokAuthorization = createServerOnlyFn(async (userId: string, requestOrigin: string) => {
  const config = tiktokConfig(requestOrigin);
  const state = randomSecret();
  const db = getDb();
  await db.prepare("DELETE FROM tiktok_oauth_states WHERE expires_at <= ?").bind(new Date().toISOString()).run();
  await db.prepare("INSERT INTO tiktok_oauth_states (state_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(state), userId, new Date(Date.now() + 10 * 60_000).toISOString())
    .run();
  const authorization = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authorization.searchParams.set("client_key", config.clientKey);
  authorization.searchParams.set("scope", SCOPES);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("redirect_uri", config.redirectUri);
  authorization.searchParams.set("state", state);
  return authorization.toString();
});

/** Termina la conexión: canjea el código, lee el perfil y guarda la cuenta con sus tokens cifrados. Devuelve un código de resultado. */
export const completeTikTokConnection = createServerOnlyFn(async (code: string, state: string, requestOrigin: string): Promise<string> => {
  const db = getDb();
  const stateRow = await db
    .prepare("DELETE FROM tiktok_oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING user_id")
    .bind(await sha256Hex(state), new Date().toISOString())
    .first<{ user_id: string }>();
  if (!stateRow) return "expired";

  const config = tiktokConfig(requestOrigin);
  let tokens: TokenResponse & { access_token: string };
  try {
    tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri });
  } catch {
    return "token_error";
  }
  if (!tokens.open_id) return "token_error";
  if (!(tokens.scope ?? "").split(",").includes("video.upload")) return "scope";

  let profile: { user?: { open_id?: string; display_name?: string } };
  try {
    profile = await tiktokApi("/v2/user/info/?fields=open_id,display_name", tokens.access_token);
  } catch {
    return "profile_error";
  }
  const openId = profile.user?.open_id || tokens.open_id;
  const handle = profile.user?.display_name?.trim() || "TikTok " + openId.slice(0, 6);
  const sealed = await sealTokens(tokens);
  await db.prepare(
    "INSERT INTO social_accounts (id, user_id, platform, handle, status, external_account_id, token_ciphertext, token_iv, token_expires_at, refresh_ciphertext, refresh_iv, refresh_expires_at, connected_at, updated_at) VALUES (?, ?, 'TikTok', ?, 'conectada', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')) ON CONFLICT(user_id, platform, external_account_id) WHERE external_account_id IS NOT NULL DO UPDATE SET handle = excluded.handle, status = 'conectada', token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv, token_expires_at = excluded.token_expires_at, refresh_ciphertext = excluded.refresh_ciphertext, refresh_iv = excluded.refresh_iv, refresh_expires_at = excluded.refresh_expires_at, connected_at = datetime('now'), updated_at = datetime('now')",
  ).bind(crypto.randomUUID(), stateRow.user_id, handle, openId, sealed.access.ciphertext, sealed.access.iv, sealed.expiresAt, sealed.refresh?.ciphertext ?? null, sealed.refresh?.iv ?? null, sealed.refreshExpiresAt).run();
  return "connected";
});

type AccountTokens = {
  status: string;
  token_ciphertext: string | null;
  token_iv: string | null;
  token_expires_at: string | null;
  refresh_ciphertext: string | null;
  refresh_iv: string | null;
  refresh_expires_at: string | null;
};

const ACCOUNT_TOKENS_SQL = "SELECT status, token_ciphertext, token_iv, token_expires_at, refresh_ciphertext, refresh_iv, refresh_expires_at FROM social_accounts WHERE id = ? AND user_id = ? AND platform = 'TikTok'";

function isFresh(account: AccountTokens) {
  return !!account.token_ciphertext && !!account.token_iv && !!account.token_expires_at && Date.parse(account.token_expires_at) - Date.now() > REFRESH_MARGIN_MS;
}

/** Devuelve un token de acceso vigente; si le quedan menos de 5 minutos lo renueva con el refresh token y guarda el nuevo par. */
export const getTikTokAccessToken = createServerOnlyFn(async (accountId: string, userId: string) => {
  const db = getDb();
  const account = await db.prepare(ACCOUNT_TOKENS_SQL).bind(accountId, userId).first<AccountTokens>();
  if (!account || account.status !== "conectada" || !account.token_ciphertext || !account.token_iv) {
    throw new TikTokError("La cuenta de TikTok no está conectada. Vuelve a conectarla.");
  }
  if (isFresh(account)) return decryptToken(account.token_ciphertext, account.token_iv);

  if (!account.refresh_ciphertext || !account.refresh_iv || (account.refresh_expires_at && Date.parse(account.refresh_expires_at) <= Date.now())) {
    throw new TikTokError("La autorización de TikTok venció. Vuelve a conectar la cuenta.");
  }
  try {
    const refreshToken = await decryptToken(account.refresh_ciphertext, account.refresh_iv);
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    const sealed = await sealTokens(tokens);
    // TikTok puede rotar el refresh token: si no devuelve uno nuevo se conserva el anterior.
    await db.prepare("UPDATE social_accounts SET token_ciphertext = ?, token_iv = ?, token_expires_at = ?, refresh_ciphertext = COALESCE(?, refresh_ciphertext), refresh_iv = COALESCE(?, refresh_iv), refresh_expires_at = COALESCE(?, refresh_expires_at), updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .bind(sealed.access.ciphertext, sealed.access.iv, sealed.expiresAt, sealed.refresh?.ciphertext ?? null, sealed.refresh?.iv ?? null, sealed.refreshExpiresAt, accountId, userId)
      .run();
    return tokens.access_token;
  } catch (error) {
    // Otro ciclo pudo renovar el token a la vez (el refresh token rota): si ya hay uno vigente, se usa.
    const latest = await db.prepare(ACCOUNT_TOKENS_SQL).bind(accountId, userId).first<AccountTokens>();
    if (latest && isFresh(latest)) return decryptToken(latest.token_ciphertext!, latest.token_iv!);
    if (error instanceof TikTokError) throw error;
    throw new TikTokError("No se pudo renovar la autorización de TikTok. Vuelve a conectar la cuenta.");
  }
});

/** Revoca (sin fallar si TikTok no responde) y borra los tokens de la cuenta. Devuelve false si la cuenta no existe. */
export const disconnectTikTokAccount = createServerOnlyFn(async (userId: string, accountId: string) => {
  const db = getDb();
  const account = await db.prepare(ACCOUNT_TOKENS_SQL).bind(accountId, userId).first<AccountTokens>();
  if (!account) return false;
  if (account.token_ciphertext && account.token_iv) {
    try {
      const { clientKey, clientSecret } = credentials();
      const token = await decryptToken(account.token_ciphertext, account.token_iv);
      await fetch(API + "/v2/oauth/revoke/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
        body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, token }),
      });
    } catch {
      // La revocación es un cortesía: aunque falle, Nex olvida los tokens.
    }
  }
  await db.prepare("UPDATE social_accounts SET status = 'desconectada', token_ciphertext = NULL, token_iv = NULL, token_expires_at = NULL, refresh_ciphertext = NULL, refresh_iv = NULL, refresh_expires_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND platform = 'TikTok'")
    .bind(accountId, userId)
    .run();
  return true;
});

type UploadRow = {
  publication_id: string;
  publish_id: string;
  upload_url: string;
  asset_key: string;
  content_type: string;
  video_size: number;
  chunk_size: number;
  total_chunks: number;
  next_offset: number;
  attempts: number;
};

/** Pide a TikTok un destino de subida para el video de la pieza (flujo «Upload», borrador en la bandeja). */
export const startTikTokPublication = createServerOnlyFn(async (publication: PublicationRow) => {
  const db = getDb();
  const content = await db.prepare("SELECT asset_key, asset_content_type FROM content_items WHERE id = ? AND user_id = ?")
    .bind(publication.content_id, publication.user_id)
    .first<{ asset_key: string | null; asset_content_type: string | null }>();
  if (!content?.asset_key) throw new TikTokError("La pieza no tiene un video adjunto.");
  if (!TIKTOK_VIDEO_TYPES.includes(content.asset_content_type ?? "")) throw new TikTokError("TikTok admite video MP4, MOV o WebM.");
  const object = await getAssets().head(content.asset_key);
  if (!object) throw new TikTokError("El video ya no está disponible en Nex.");
  const size = object.size;
  if (size < 1) throw new TikTokError("El video está vacío.");
  if (size > MAX_VIDEO_SIZE) throw new TikTokError("El video supera los 4 GB que admite TikTok.");

  const configuredChunk = tiktokTuning.chunkSize;
  if (configuredChunk < MIN_CHUNK || configuredChunk > MAX_CHUNK) throw new Error("El tamaño de trozo para TikTok debe estar entre 5 y 64 MB.");
  // Un video menor que el trozo se sube entero; si no, TikTok cuenta floor(video / trozo) y el último trozo absorbe el resto.
  const chunkSize = Math.min(size, configuredChunk);
  const totalChunks = Math.max(1, Math.floor(size / chunkSize));

  const accessToken = await getTikTokAccessToken(publication.account_id, publication.user_id);
  const init = await tiktokApi<{ publish_id?: string; upload_url?: string }>("/v2/post/publish/inbox/video/init/", accessToken, {
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks },
  });
  if (!init.publish_id || !init.upload_url) throw new TikTokError("TikTok no devolvió el destino de la subida.");
  await db.prepare("INSERT INTO tiktok_uploads (publication_id, publish_id, upload_url, asset_key, content_type, video_size, chunk_size, total_chunks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(publication.id, init.publish_id, init.upload_url, content.asset_key, content.asset_content_type, size, chunkSize, totalChunks)
    .run();
  return init.publish_id;
});

/** Sube trozos en orden desde R2 hasta agotar el presupuesto del ciclo. Devuelve true si el video quedó completo en TikTok. */
async function uploadChunks(upload: UploadRow): Promise<boolean> {
  const db = getDb();
  let offset = upload.next_offset;
  let uploadedThisCycle = 0;
  while (offset < upload.video_size) {
    const isLast = Math.floor(offset / upload.chunk_size) >= upload.total_chunks - 1;
    const end = isLast ? upload.video_size : offset + upload.chunk_size;
    const length = end - offset;

    const object = await getAssets().get(upload.asset_key, { range: { offset, length } });
    if (!object) throw new TikTokError("El video ya no está disponible en Nex.");
    if (object.size !== upload.video_size) throw new TikTokError("El video cambió mientras se subía a TikTok. Vuelve a programar la publicación.");

    const body = new FixedLengthStream(length);
    const copy = object.body.pipeTo(body.writable);
    copy.catch(() => undefined);
    let response: Response;
    try {
      response = await fetch(upload.upload_url, {
        method: "PUT",
        headers: { "content-type": upload.content_type, "content-range": `bytes ${offset}-${end - 1}/${upload.video_size}` },
        body: body.readable,
      });
    } catch {
      response = new Response(null, { status: 599 });
    }
    await response.body?.cancel().catch(() => undefined);

    if (response.status === 206 || response.status === 201) {
      offset = end;
      uploadedThisCycle += length;
      await db.prepare("UPDATE tiktok_uploads SET next_offset = ?, attempts = 0, updated_at = datetime('now') WHERE publication_id = ?").bind(offset, upload.publication_id).run();
      if (response.status === 201 && offset < upload.video_size) throw new TikTokError("TikTok dio la subida por completa antes de recibir todo el video. Vuelve a programar la publicación.");
      if (offset < upload.video_size && uploadedThisCycle >= tiktokTuning.bytesPerCycle) return false;
      continue;
    }
    if (response.status === 403) throw new TikTokError("El enlace de subida de TikTok venció (dura una hora). Vuelve a programar la publicación.");
    if (response.status === 429 || response.status >= 500) {
      const attempts = upload.attempts + 1;
      if (attempts >= tiktokTuning.maxChunkAttempts) throw new TikTokError("TikTok no aceptó el video tras varios intentos. Vuelve a programar la publicación.");
      await db.prepare("UPDATE tiktok_uploads SET attempts = ?, updated_at = datetime('now') WHERE publication_id = ?").bind(attempts, upload.publication_id).run();
      upload.attempts = attempts;
      return false;
    }
    throw new TikTokError("TikTok rechazó un trozo del video (código " + response.status + "). Vuelve a programar la publicación.");
  }
  return true;
}

async function advanceUpload(publication: PublicationRow, upload: UploadRow): Promise<PublicationOutcome> {
  if (upload.next_offset < upload.video_size && !(await uploadChunks(upload))) return { status: "en_curso" };

  const accessToken = await getTikTokAccessToken(publication.account_id, publication.user_id);
  const data = await tiktokApi<{ status?: string; fail_reason?: string }>("/v2/post/publish/status/fetch/", accessToken, { publish_id: upload.publish_id });
  switch (data.status) {
    case "SEND_TO_USER_INBOX":
      return { status: "borrador_enviado" };
    case "PUBLISH_COMPLETE":
      return { status: "publicada" };
    case "FAILED":
      return { status: "fallida", error: (data.fail_reason && FAIL_REASONS[data.fail_reason]) || "TikTok no pudo procesar el video" + (data.fail_reason ? " (" + data.fail_reason + ")" : "") + "." };
    default:
      return { status: "en_curso" };
  }
}

/** Avanza una publicación de TikTok: sube los trozos pendientes y consulta el estado en TikTok. */
export const checkTikTokPublication = createServerOnlyFn(async (publication: PublicationRow & { job_id: string }): Promise<PublicationOutcome> => {
  const db = getDb();
  const upload = await db.prepare("SELECT publication_id, publish_id, upload_url, asset_key, content_type, video_size, chunk_size, total_chunks, next_offset, attempts FROM tiktok_uploads WHERE publication_id = ?")
    .bind(publication.id)
    .first<UploadRow>();
  if (!upload || upload.publish_id !== publication.job_id) {
    return { status: "requiere_revision", error: "Nex perdió el estado de la subida a TikTok. Revisa la bandeja de TikTok antes de reintentar." };
  }
  const lease = await db.prepare("UPDATE tiktok_uploads SET lease_until = ? WHERE publication_id = ? AND (lease_until IS NULL OR lease_until < ?)")
    .bind(new Date(Date.now() + LEASE_MS).toISOString(), publication.id, new Date().toISOString())
    .run();
  if (!lease.meta.changes) return { status: "en_curso" };

  let outcome: PublicationOutcome;
  try {
    outcome = await advanceUpload(publication, upload);
  } catch (error) {
    if (error instanceof TikTokError && error.retryable) outcome = { status: "en_curso" };
    else outcome = { status: "fallida", error: error instanceof TikTokError ? error.message : "No se pudo continuar la publicación en TikTok. Vuelve a conectar la cuenta y reintenta." };
  }
  if (outcome.status === "en_curso") {
    await db.prepare("UPDATE tiktok_uploads SET lease_until = NULL WHERE publication_id = ?").bind(publication.id).run();
  } else {
    await db.prepare("DELETE FROM tiktok_uploads WHERE publication_id = ?").bind(publication.id).run();
  }
  return outcome;
});
