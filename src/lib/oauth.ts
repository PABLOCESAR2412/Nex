import { createServerOnlyFn } from "@tanstack/react-start";
import { getDb, getRuntimeEnv, newId } from "./db";
import { MCP_SCOPES, MCP_SCOPE_LABELS, parseScopes, type McpScope } from "./mcp";
import { randomSecret, sha256Hex } from "./token-crypto";

// OAuth 2.1 mínimo para que conectores remotos (claude.ai, ChatGPT, etc.) se autentiquen contra /api/mcp:
// metadatos RFC 9728 y RFC 8414, registro dinámico de clientes públicos RFC 7591, código + PKCE S256 y refresh
// tokens rotativos. Las claves que emite son filas de mcp_tokens, así que la revocación y los permisos son los mismos.
const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 60 * 24 * 3600_000;
const MAX_CLIENTS = 1000;

const CORS_HEADERS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization, mcp-protocol-version", "access-control-max-age": "86400" };

/** Origen público de Nex: PUBLIC_APP_URL si está definido; si no, el de la petición. */
export const publicOrigin = createServerOnlyFn((request: Request) => {
  return getRuntimeEnv().PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || new URL(request.url).origin;
});

export function resourceMetadataUrl(origin: string) {
  return origin + "/.well-known/oauth-protected-resource/api/mcp";
}

/** Respuesta JSON de los endpoints OAuth: sin caché y con CORS, porque no usan cookies (los usan clientes del navegador, como el Inspector de MCP). */
export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...CORS_HEADERS, ...headers } });
}

export function oauthPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: origin + "/api/mcp",
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Nex",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: origin + "/oauth/authorize",
    token_endpoint: origin + "/oauth/token",
    registration_endpoint: origin + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
  };
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pkceChallenge(verifier: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** HTTPS, o HTTP solo hacia el propio equipo (clientes de escritorio con servidor local). Sin fragmento. */
export function isValidRedirectUri(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

type ClientRow = { client_id: string; client_name: string; redirect_uris: string };

/** Registro dinámico de un cliente público (RFC 7591). */
export const registerOAuthClient = createServerOnlyFn(async (input: unknown) => {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length < 1 || redirectUris.length > 10 || !redirectUris.every(isValidRedirectUri)) {
    return { status: 400, body: { error: "invalid_redirect_uri", error_description: "redirect_uris debe listar de 1 a 10 URI HTTPS (o http://localhost)." } };
  }
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") {
    return { status: 400, body: { error: "invalid_client_metadata", error_description: "Solo se admiten clientes públicos (token_endpoint_auth_method=none)." } };
  }
  if (Array.isArray(body.grant_types) && !body.grant_types.includes("authorization_code")) {
    return { status: 400, body: { error: "invalid_client_metadata", error_description: "grant_types debe incluir authorization_code." } };
  }
  const name = typeof body.client_name === "string" ? body.client_name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) : "";
  const db = getDb();
  const count = await db.prepare("SELECT COUNT(*) AS total FROM oauth_clients").first<{ total: number }>();
  if ((count?.total ?? 0) >= MAX_CLIENTS) {
    await db.prepare("DELETE FROM oauth_clients WHERE created_at < datetime('now', '-30 days') AND NOT EXISTS (SELECT 1 FROM mcp_tokens WHERE mcp_tokens.client_id = oauth_clients.client_id)").run();
    const again = await db.prepare("SELECT COUNT(*) AS total FROM oauth_clients").first<{ total: number }>();
    if ((again?.total ?? 0) >= MAX_CLIENTS) return { status: 429, body: { error: "temporarily_unavailable", error_description: "Demasiados clientes registrados." } };
  }
  const clientId = "nexc_" + randomSecret().slice(0, 32);
  const clientName = name || "Aplicación MCP";
  await db.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)").bind(clientId, clientName, JSON.stringify(redirectUris)).run();
  return {
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  };
});

export type AuthorizeRequest = {
  client: { id: string; name: string };
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  requestedScopes: McpScope[];
};

/** Valida una solicitud de autorización. Los errores no redirigen: el redirect_uri aún no es de fiar. */
export const readAuthorizeRequest = createServerOnlyFn(async (params: URLSearchParams, origin: string): Promise<{ ok: true; request: AuthorizeRequest } | { ok: false; message: string }> => {
  const clientId = params.get("client_id") ?? "";
  const client = clientId ? await getDb().prepare("SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(clientId).first<ClientRow>() : null;
  if (!client) return { ok: false, message: "La aplicación que pide acceso no está registrada." };
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) return { ok: false, message: "La dirección de retorno no coincide con la registrada por la aplicación." };
  if (params.get("response_type") !== "code") return { ok: false, message: "La aplicación pidió un tipo de respuesta no admitido." };
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return { ok: false, message: "La aplicación debe usar PKCE con S256." };
  const resource = params.get("resource");
  if (resource && resource.replace(/\/+$/, "") !== origin && resource.replace(/\/+$/, "") !== origin + "/api/mcp") return { ok: false, message: "La aplicación pidió acceso a otro servidor." };
  const requested = parseScopes(params.get("scope"));
  return {
    ok: true,
    request: { client: { id: client.client_id, name: client.client_name }, redirectUri, state: params.get("state"), codeChallenge: challenge, requestedScopes: requested.length ? requested : [...MCP_SCOPES] },
  };
});

/** Guarda un código de un solo uso para el usuario y devuelve la URL de retorno con el código y el state. */
export const createAuthorizationCode = createServerOnlyFn(async (userId: string, request: AuthorizeRequest, scopes: McpScope[]) => {
  const db = getDb();
  await db.prepare("DELETE FROM oauth_codes WHERE expires_at <= ?").bind(new Date().toISOString()).run();
  const code = randomSecret();
  await db.prepare("INSERT INTO oauth_codes (code_hash, user_id, client_id, redirect_uri, code_challenge, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(code), userId, request.client.id, request.redirectUri, request.codeChallenge, scopes.join(" "), new Date(Date.now() + CODE_TTL_MS).toISOString())
    .run();
  return redirectWith(request, { code });
});

export function redirectWith(request: AuthorizeRequest, values: Record<string, string>) {
  const url = new URL(request.redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  if (request.state !== null) url.searchParams.set("state", request.state);
  return url.toString();
}

function tokenError(error: string, description: string, status = 400) {
  return { status, body: { error, error_description: description } };
}

async function mintTokens() {
  const accessToken = "nex_live_" + randomSecret();
  const refreshToken = "nex_refresh_" + randomSecret();
  return {
    accessToken,
    refreshToken,
    accessHash: await sha256Hex(accessToken),
    refreshHash: await sha256Hex(refreshToken),
    expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
  };
}

function tokenResponse(tokens: { accessToken: string; refreshToken: string }, scopes: McpScope[]) {
  return { status: 200, body: { access_token: tokens.accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: tokens.refreshToken, scope: scopes.join(" ") } };
}

/** Endpoint de token: canjea un código (con PKCE) o rota un refresh token. */
export const exchangeOAuthToken = createServerOnlyFn(async (form: URLSearchParams) => {
  const db = getDb();
  const clientId = form.get("client_id") ?? "";
  const client = clientId ? await db.prepare("SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(clientId).first<ClientRow>() : null;
  if (!client) return tokenError("invalid_client", "Cliente desconocido.", 401);

  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    // El código se consume siempre: un intento fallido no deja reintentar con el mismo código.
    const row = code ? await db.prepare("DELETE FROM oauth_codes WHERE code_hash = ? RETURNING user_id, client_id, redirect_uri, code_challenge, scopes, expires_at").bind(await sha256Hex(code)).first<{ user_id: string; client_id: string; redirect_uri: string; code_challenge: string; scopes: string; expires_at: string }>() : null;
    if (!row || Date.parse(row.expires_at) <= Date.now() || row.client_id !== client.client_id) return tokenError("invalid_grant", "El código no es válido o venció.");
    if (form.get("redirect_uri") !== row.redirect_uri) return tokenError("invalid_grant", "redirect_uri no coincide con la solicitud de autorización.");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || await pkceChallenge(verifier) !== row.code_challenge) return tokenError("invalid_grant", "code_verifier no coincide con el desafío PKCE.");
    const scopes = parseScopes(row.scopes);
    const tokens = await mintTokens();
    await db.prepare("INSERT INTO mcp_tokens (id, user_id, token_hash, label, scopes, expires_at, client_id, refresh_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(newId(), row.user_id, tokens.accessHash, client.client_name, scopes.join(" "), tokens.expiresAt, client.client_id, tokens.refreshHash, tokens.refreshExpiresAt)
      .run();
    return tokenResponse(tokens, scopes);
  }

  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token") ?? "";
    const current = refresh ? await db.prepare("SELECT id, client_id, scopes, refresh_expires_at FROM mcp_tokens WHERE refresh_hash = ? AND revoked_at IS NULL").bind(await sha256Hex(refresh)).first<{ id: string; client_id: string | null; scopes: string; refresh_expires_at: string | null }>() : null;
    if (!current || current.client_id !== client.client_id || !current.refresh_expires_at || Date.parse(current.refresh_expires_at) <= Date.now()) return tokenError("invalid_grant", "El refresh token no es válido o venció.");
    const scopes = parseScopes(current.scopes);
    const tokens = await mintTokens();
    // Rotación de un solo uso: solo gana quien aún presente el refresh token vigente.
    const rotated = await db.prepare("UPDATE mcp_tokens SET token_hash = ?, refresh_hash = ?, expires_at = ?, refresh_expires_at = ? WHERE id = ? AND refresh_hash = ? AND revoked_at IS NULL")
      .bind(tokens.accessHash, tokens.refreshHash, tokens.expiresAt, tokens.refreshExpiresAt, current.id, await sha256Hex(refresh))
      .run();
    if (!rotated.meta.changes) return tokenError("invalid_grant", "El refresh token ya se usó.");
    return tokenResponse(tokens, scopes);
  }

  return tokenError("unsupported_grant_type", "Usa authorization_code o refresh_token.");
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const PAGE_STYLE = `
:root{color-scheme:dark;--bg:#0c1510;--card:#142219;--text:#e5e9dc;--muted:#a4b1a1;--line:rgb(201 218 185/25%);--sage:#a9c094;--sage-light:#c5d6b2}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:15px/1.5 "Segoe UI Variable","Segoe UI",Arial,sans-serif}
main{width:min(460px,100%);padding:28px;border:1px solid var(--line);border-radius:18px;background:var(--card)}
h1{margin:0 0 6px;font-size:24px}p{margin:0 0 14px;color:var(--muted)}strong{color:var(--text)}
fieldset{margin:0 0 18px;padding:0;border:0}legend{margin-bottom:8px;color:var(--sage);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
label{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;color:var(--text)}input[type=checkbox]{margin-top:5px;accent-color:var(--sage)}
.actions{display:flex;gap:10px}button{flex:1;min-height:44px;border-radius:11px;border:1px solid var(--line);background:transparent;color:var(--text);font:inherit;cursor:pointer}
button.approve{background:var(--sage-light);border-color:var(--sage-light);color:#0c1510;font-weight:700}button:focus-visible{outline:2px solid var(--sage);outline-offset:2px}
small{display:block;margin-top:14px;color:var(--muted)}
@media(prefers-color-scheme:light){:root{--bg:#f4f3ea;--card:#fff;--text:#1d2a20;--muted:#52614f;--line:rgb(60 80 55/25%);--sage:#3f5f45;--sage-light:#3f5f45}button.approve{color:#fff}}
`;

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Nex</title><style>${PAGE_STYLE}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'", "referrer-policy": "no-referrer" } });
}

export function authorizeErrorPage(message: string) {
  return page("No se pudo autorizar", `<h1>No se pudo autorizar</h1><p>${escapeHtml(message)}</p><small>Cierra esta ventana y vuelve a intentarlo desde la aplicación.</small>`, 400);
}

/** Pantalla de consentimiento: la persona elige qué permisos concede o rechaza la conexión. */
export function consentPage(request: AuthorizeRequest, params: URLSearchParams, email: string) {
  const hidden = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"]
    .filter((key) => params.has(key))
    .map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(params.get(key)!)}">`)
    .join("");
  const redirectHost = new URL(request.redirectUri).host;
  const scopes = request.requestedScopes.map((scope) => `<label><input type="checkbox" name="grant" value="${scope}" checked><span>${escapeHtml(MCP_SCOPE_LABELS[scope])}</span></label>`).join("");
  return page("Conectar una aplicación", `<h1>Conectar con Nex</h1>
<p><strong>${escapeHtml(request.client.name)}</strong> quiere acceder a tu estudio como <strong>${escapeHtml(email)}</strong>.</p>
<form method="post" action="/oauth/authorize">${hidden}
<fieldset><legend>Permisos</legend>${scopes}</fieldset>
<div class="actions"><button type="submit" name="decision" value="deny">Cancelar</button><button class="approve" type="submit" name="decision" value="approve">Permitir acceso</button></div>
</form>
<small>Volverás a ${escapeHtml(redirectHost)}. Puedes revocar esta conexión cuando quieras desde Nex. Las publicaciones públicas siguen necesitando piezas que tú aprobaste.</small>`);
}
