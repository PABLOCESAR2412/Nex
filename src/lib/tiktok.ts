import { z } from "zod/v4";
import { getRuntimeEnv } from "./db";

const apiOrigin = "https://open.tiktokapis.com";
const requestTimeoutMs = 8_000;
const scopes = ["user.info.basic", "video.upload"];
const encoder = new TextEncoder();
const tokenSalt = encoder.encode("nex-tiktok-token-v1");

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  open_id: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_expires_in: z.number().int().positive(),
  scope: z.string(),
});

const profileResponse = z.object({
  user: z.object({ open_id: z.string().min(1), display_name: z.string().trim().min(1) }),
});

const uploadResponse = z.object({ publish_id: z.string().min(1).max(64) });
const statusResponse = z.object({
  status: z.string().min(1),
  fail_reason: z.string().optional(),
  publicaly_available_post_id: z.array(z.union([z.string(), z.number()])).optional(),
});

const errorDetails: Record<string, string> = {
  access_token_invalid: "Vuelve a conectar la cuenta de TikTok.",
  invalid_grant: "La autorización de TikTok venció. Vuelve a conectar la cuenta.",
  scope_not_authorized: "Autoriza el permiso video.upload en TikTok.",
  url_ownership_unverified: "Verifica el dominio o el prefijo de los videos en TikTok for Developers.",
  spam_risk_too_many_pending_share: "Completa o descarta una de las cargas pendientes en TikTok antes de enviar otra.",
  rate_limit_exceeded: "TikTok limitó las solicitudes. Espera un momento y vuelve a intentarlo.",
};

export class TikTokApiError extends Error {
  readonly code: string;

  constructor(code: string, readonly httpStatus: number) {
    const safeCode = /^[a-z][a-z0-9_]{0,99}$/.test(code) ? code : "invalid_response";
    super(Object.hasOwn(errorDetails, safeCode) ? errorDetails[safeCode] : "TikTok no pudo completar la solicitud.");
    this.name = "TikTokApiError";
    this.code = safeCode;
  }
}

export function tikTokConfig(requestOrigin?: string) {
  const env = getRuntimeEnv();
  const clientKey = env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = env.TIKTOK_CLIENT_SECRET?.trim();
  const encryptionSecret = env.TIKTOK_TOKEN_ENCRYPTION_KEY?.trim();
  if (!clientKey || !clientSecret || !encryptionSecret) {
    throw new Error("TikTok requiere configurar TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET y TIKTOK_TOKEN_ENCRYPTION_KEY.");
  }
  if (encoder.encode(encryptionSecret).length < 32) {
    throw new Error("TIKTOK_TOKEN_ENCRYPTION_KEY debe tener al menos 32 bytes.");
  }
  const origin = env.PUBLIC_APP_URL?.trim() || requestOrigin;
  if (!origin) return { clientKey, clientSecret, encryptionSecret, publicAppUrl: "", redirectUri: "" };
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("PUBLIC_APP_URL debe ser el origen HTTPS de Nex para conectar TikTok.");
  }
  return {
    clientKey,
    clientSecret,
    encryptionSecret,
    publicAppUrl: url.origin,
    redirectUri: new URL("/api/social/tiktok/callback", url).href,
  };
}

export function isTikTokConfigured() {
  try {
    tikTokConfig("https://nex.invalid");
    return true;
  } catch {
    return false;
  }
}

export function tikTokAuthorizationUrl(state: string, requestOrigin?: string) {
  const config = tikTokConfig(requestOrigin);
  if (!config.redirectUri) throw new Error("Configura un origen público HTTPS para conectar TikTok.");
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.search = new URLSearchParams({
    client_key: config.clientKey,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes.join(","),
    state,
    disable_auto_auth: "1",
  }).toString();
  return url;
}

function oauthRequest(path: string, data: Record<string, string>) {
  const config = tikTokConfig();
  return fetch(apiOrigin + path, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, ...data }),
  });
}

async function requestToken(data: Record<string, string>) {
  const response = await oauthRequest("/v2/oauth/token/", data);
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  const parsed = tokenResponse.safeParse(payload);
  if (!response.ok || !parsed.success || payload?.error) {
    throw new TikTokApiError(typeof payload?.error === "string" ? payload.error : "invalid_response", response.status);
  }
  const granted = parsed.data.scope.split(",").map((scope) => scope.trim());
  if (!scopes.every((scope) => granted.includes(scope))) throw new TikTokApiError("scope_not_authorized", 403);
  return parsed.data;
}

export function exchangeTikTokCode(code: string, requestOrigin?: string) {
  const { redirectUri } = tikTokConfig(requestOrigin);
  if (!redirectUri) throw new Error("Configura un origen público HTTPS para conectar TikTok.");
  return requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function refreshTikTokToken(refreshToken: string) {
  return requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

async function apiRequest<T>(path: string, accessToken: string, schema: z.ZodType<T>, input?: object): Promise<T> {
  const response = await fetch(apiOrigin + path, {
    method: input ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: { authorization: `Bearer ${accessToken}`, ...(input ? { "content-type": "application/json; charset=UTF-8" } : {}) },
    body: input ? JSON.stringify(input) : undefined,
  });
  const raw = await response.text();
  let payload: { data?: unknown; error?: { code?: string } } | null = null;
  try {
    // TikTok returns post IDs as int64. Keep their source digits instead of reserializing a rounded number.
    payload = JSON.parse(raw, (_key, value, context?: { source?: string }) => {
      const source = context?.source;
      return typeof value === "number" && !Number.isSafeInteger(value) && source && /^\d+$/.test(source) ? source : value;
    });
  } catch {
    throw new TikTokApiError("invalid_response", response.status);
  }
  const code = payload?.error?.code;
  const parsed = schema.safeParse(payload?.data);
  if (!response.ok || code !== "ok" || !parsed.success) {
    throw new TikTokApiError(typeof code === "string" && code !== "ok" ? code : "invalid_response", response.status);
  }
  return parsed.data;
}

export async function getTikTokProfile(accessToken: string) {
  const response = await apiRequest("/v2/user/info/?fields=open_id,display_name", accessToken, profileResponse);
  return response.user;
}

export function initializeTikTokUpload(accessToken: string, videoUrl: string) {
  return apiRequest("/v2/post/publish/inbox/video/init/", accessToken, uploadResponse, {
    source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
  });
}

export async function fetchTikTokUploadStatus(accessToken: string, publishId: string) {
  const response = await apiRequest("/v2/post/publish/status/fetch/", accessToken, statusResponse, { publish_id: publishId });
  const postIds = response.publicaly_available_post_id?.filter((id) =>
    typeof id === "string" ? /^\d+$/.test(id) : Number.isSafeInteger(id),
  ).map(String);
  const failure = response.fail_reason;
  const fail_reason = failure && /^[a-z][a-z0-9_]{0,99}$/.test(failure) ? failure : undefined;
  return { status: response.status, fail_reason, postIds };
}

async function encryptionKey() {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(tikTokConfig().encryptionSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: tokenSalt, info: tokenSalt },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function encryptTikTokToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(token));
  return { ciphertext: toBase64(new Uint8Array(encrypted)), iv: toBase64(iv) };
}

export async function decryptTikTokToken(ciphertext: string, ivValue: string) {
  const cleartext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivValue) }, await encryptionKey(), fromBase64(ciphertext));
  return new TextDecoder().decode(cleartext);
}
