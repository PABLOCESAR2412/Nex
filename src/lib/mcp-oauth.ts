import type { AuthInfo } from "@modelcontextprotocol/server";
import { getCurrentSession } from "./auth";
import { getDb, getRuntimeEnv, newId } from "./db";
import { randomSecret, sha256Hex } from "./instagram";
import {
  MCP_OAUTH_SCOPES,
  parseRequestedScopes,
  validateClientRegistration,
  validateOAuthAuthorizeParams,
  verifyPkce,
  type McpOAuthScope,
  type OAuthAuthorizeRequest,
  type RegisteredOAuthClient,
} from "./mcp-oauth-protocol";

const ACCESS_TOKEN_SECONDS = 60 * 60;
const REFRESH_TOKEN_SECONDS = 60 * 60 * 24 * 30;
const AUTH_CODE_SECONDS = 5 * 60;
const AUTH_REQUEST_SECONDS = 10 * 60;
const MAX_REGISTERED_OAUTH_CLIENTS = 5_000;
const LEGACY_SCOPES: McpOAuthScope[] = ["nex:read", "nex:write", "nex:publish"];

type OAuthClientRow = {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
  grant_types_json: string;
  response_types_json: string;
  scopes: string;
  revoked_at: string | null;
};

type OAuthCodeRow = {
  user_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  expires_at: string;
  consumed_by: string | null;
};

type OAuthGrantRow = {
  id: string;
  user_id: string;
  client_id: string;
  client_name: string;
  resource: string;
  scopes: string;
  access_token_hash: string;
  refresh_token_hash: string;
  access_expires_at: string;
  refresh_expires_at: string;
};

function noStoreHeaders(extra: HeadersInit = {}) {
  return {
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function oauthJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: noStoreHeaders() });
}

function oauthError(error: string, description: string, status = 400) {
  return oauthJson({ error, error_description: description }, status);
}

function resourceUrl(origin: string) {
  return new URL("/api/mcp", origin).toString();
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: new URL("/oauth/authorize", origin).toString(),
    token_endpoint: new URL("/oauth/token", origin).toString(),
    registration_endpoint: new URL("/oauth/register", origin).toString(),
    revocation_endpoint: new URL("/oauth/revoke", origin).toString(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    client_id_metadata_document_supported: false,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

function parseClientRow(row: OAuthClientRow): RegisteredOAuthClient | null {
  if (row.revoked_at) return null;
  try {
    const redirectUris = JSON.parse(row.redirect_uris_json) as unknown;
    const grantTypes = JSON.parse(row.grant_types_json) as unknown;
    const responseTypes = JSON.parse(row.response_types_json) as unknown;
    if (!Array.isArray(redirectUris) || redirectUris.some((uri) => typeof uri !== "string")) return null;
    if (!Array.isArray(grantTypes) || grantTypes.some((grant) => typeof grant !== "string")) return null;
    if (!Array.isArray(responseTypes) || responseTypes.some((response) => typeof response !== "string")) return null;
    return {
      clientId: row.client_id,
      redirectUris: redirectUris as string[],
      grantTypes: grantTypes as string[],
      responseTypes: responseTypes as string[],
      scopes: parseRequestedScopes(row.scopes),
    };
  } catch {
    return null;
  }
}

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function consentPage(input: { requestId: string; clientName: string; email: string; scopes: McpOAuthScope[] }) {
  const labels: Record<McpOAuthScope, string> = {
    "nex:read": "Consultar piezas, calendario y cuentas conectadas",
    "nex:write": "Crear borradores, cargar archivos y programar contenido",
    "nex:publish": "Iniciar publicaciones en Instagram y consultar su estado",
    offline_access: "Mantener esta conexión activa renovando el acceso",
  };
  const permissions = input.scopes.map((scope) => `<li>${htmlEscape(labels[scope])}</li>`).join("");
  const clientName = htmlEscape(input.clientName);
  const email = htmlEscape(input.email);
  const requestId = htmlEscape(input.requestId);
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorizar asistente · Nex</title><style>body{margin:0;background:#101812;color:#eef2e9;font:16px/1.5 system-ui,sans-serif}.wrap{max-width:520px;margin:9vh auto;padding:28px}main{border:1px solid #344239;border-radius:16px;padding:28px;background:#18221b}h1{font-size:25px;line-height:1.2}p,li{color:#c2cdbf}ul{padding-left:22px}button{padding:12px 16px;border:0;border-radius:9px;font:inherit;cursor:pointer}.allow{background:#b8d7a5;color:#162016}.deny{background:transparent;color:#d4aaa0;border:1px solid #68514d;margin-left:8px}.account{font-size:13px}</style><div class="wrap"><main><h1>Conectar ${clientName} con Nex</h1><p>${clientName} solicita acceso a tu estudio Nex.</p><ul>${permissions}</ul><p class="account">Cuenta: ${email}</p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${requestId}"><button class="allow" type="submit" name="decision" value="allow">Autorizar conexión</button><button class="deny" type="submit" name="decision" value="deny">Cancelar</button></form></main></div></html>`;
  return new Response(html, {
    headers: noStoreHeaders({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    }),
  });
}

function loginRedirect(request: Request, nextPath?: string) {
  const target = new URL("/login", request.url);
  const requestUrl = new URL(request.url);
  const next = nextPath ?? requestUrl.pathname + requestUrl.search;
  target.searchParams.set("next", next);
  return Response.redirect(target, 302);
}

function authorizationRedirect(uri: string, values: Record<string, string>) {
  const target = new URL(uri);
  for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
  return Response.redirect(target, 303);
}

async function readForm(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return null;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32_768) return null;
  const body = await request.text();
  if (body.length > 32_768) return null;
  return new URLSearchParams(body);
}

export async function registerOAuthClient(request: Request) {
  const rateLimiter = getRuntimeEnv().NEX_OAUTH_REGISTRATION_LIMITER;
  const clientIp = request.headers.get("cf-connecting-ip");
  if (!rateLimiter || !clientIp) {
    return oauthError("temporarily_unavailable", "El registro OAuth no está disponible temporalmente.", 503);
  }

  let rateResult: { success: boolean };
  try {
    rateResult = await rateLimiter.limit({ key: `nex-oauth-register:${clientIp}` });
  } catch {
    return oauthError("temporarily_unavailable", "El registro OAuth no está disponible temporalmente.", 503);
  }
  if (!rateResult.success) {
    return Response.json(
      { error: "rate_limit_exceeded", error_description: "Se alcanzó el límite temporal de registros OAuth." },
      { status: 429, headers: noStoreHeaders({ "retry-after": "60" }) },
    );
  }

  const db = getDb();
  let input: unknown;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384) return oauthError("invalid_client_metadata", "La solicitud excede el tamaño permitido.");
    const body = await request.text();
    if (body.length > 16_384) return oauthError("invalid_client_metadata", "La solicitud excede el tamaño permitido.");
    input = JSON.parse(body);
  } catch {
    return oauthError("invalid_client_metadata", "El registro debe ser JSON válido.");
  }

  let client;
  try {
    client = validateClientRegistration(input);
  } catch (error) {
    return oauthError("invalid_client_metadata", error instanceof Error ? error.message : "Los metadatos del cliente no son válidos.");
  }

  const clientId = "nex_client_" + randomSecret();
  const now = Math.floor(Date.now() / 1000);
  let inserted;
  try {
    inserted = await db.prepare(
      "INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json, grant_types_json, response_types_json, scopes) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM mcp_oauth_clients) < ?",
    ).bind(clientId, client.clientName, JSON.stringify(client.redirectUris), JSON.stringify(client.grantTypes), JSON.stringify(client.responseTypes), client.scopes.join(" "), MAX_REGISTERED_OAUTH_CLIENTS).run();
  } catch {
    return oauthError("server_error", "No se pudo registrar el cliente OAuth.", 500);
  }
  if (inserted.meta.changes !== 1) {
    return oauthError("temporarily_unavailable", "Se alcanzó el límite de clientes OAuth registrados.", 503);
  }

  return oauthJson({
    client_id: clientId,
    client_id_issued_at: now,
    client_name: client.clientName,
    application_type: client.applicationType,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: "none",
    scope: client.scopes.join(" "),
  }, 201);
}

export async function beginOAuthAuthorization(request: Request) {
  const url = new URL(request.url);
  const resumeId = url.searchParams.get("resume");
  if (resumeId !== null) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(resumeId)) {
      return new Response("Solicitud OAuth inválida.", { status: 400, headers: noStoreHeaders() });
    }
    const session = await getCurrentSession();
    if (!session) return loginRedirect(request);
    const db = getDb();
    const pending = await db.prepare(
      "SELECT id, client_name, scope FROM mcp_oauth_requests WHERE id = ? AND user_id = ? AND completed_at IS NULL AND expires_at > ?",
    ).bind(resumeId, session.userId, new Date().toISOString()).first<{ id: string; client_name: string; scope: string }>();
    if (!pending) {
      return new Response("La solicitud expiró o ya fue utilizada. Inicia la conexión nuevamente.", { status: 400, headers: noStoreHeaders() });
    }
    const account = await db.prepare("SELECT email FROM users WHERE id = ?").bind(session.userId).first<{ email: string }>();
    let scopes: McpOAuthScope[];
    try {
      scopes = parseRequestedScopes(pending.scope);
    } catch {
      return new Response("Los permisos de la solicitud no son válidos.", { status: 500, headers: noStoreHeaders() });
    }
    return consentPage({
      requestId: pending.id,
      clientName: pending.client_name,
      email: account?.email ?? "Cuenta Nex autenticada",
      scopes,
    });
  }

  const clientId = url.searchParams.get("client_id") ?? "";
  if (!clientId) return new Response("Solicitud OAuth inválida.", { status: 400, headers: noStoreHeaders() });

  const clientRow = await getDb().prepare(
    "SELECT client_id, client_name, redirect_uris_json, grant_types_json, response_types_json, scopes, revoked_at FROM mcp_oauth_clients WHERE client_id = ?",
  ).bind(clientId).first<OAuthClientRow>();
  const client = clientRow && parseClientRow(clientRow);
  if (!client || !clientRow) return new Response("Cliente OAuth no registrado.", { status: 400, headers: noStoreHeaders() });

  let authorization: OAuthAuthorizeRequest;
  try {
    authorization = validateOAuthAuthorizeParams(url.searchParams, {
      resource: resourceUrl(url.origin),
      client,
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Solicitud OAuth inválida.", { status: 400, headers: noStoreHeaders() });
  }

  const session = await getCurrentSession();
  if (!session) return loginRedirect(request);

  const db = getDb();
  const now = new Date();
  const requestId = randomSecret();
  const expiresAt = new Date(now.getTime() + AUTH_REQUEST_SECONDS * 1000).toISOString();
  try {
    await db.prepare("DELETE FROM mcp_oauth_requests WHERE expires_at <= ? OR completed_at IS NOT NULL").bind(now.toISOString()).run();
    await db.prepare(
      "INSERT INTO mcp_oauth_requests (id, user_id, client_id, client_name, redirect_uri, state, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(requestId, session.userId, clientId, clientRow.client_name, authorization.redirectUri, authorization.state, authorization.codeChallenge, authorization.scope.join(" "), authorization.resource, expiresAt).run();
  } catch {
    return new Response("No se pudo iniciar la autorización MCP.", { status: 500, headers: noStoreHeaders() });
  }

  const account = await db.prepare("SELECT email FROM users WHERE id = ?").bind(session.userId).first<{ email: string }>();
  return consentPage({
    requestId,
    clientName: clientRow.client_name,
    email: account?.email ?? "Cuenta Nex autenticada",
    scopes: authorization.scope,
  });
}

export async function completeOAuthAuthorization(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  if (request.headers.get("origin") !== requestOrigin) return new Response("Origen no permitido.", { status: 403, headers: noStoreHeaders() });
  const form = await readForm(request);
  const requestId = form?.get("request_id") ?? "";
  const session = await getCurrentSession();
  if (!session) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(requestId)) {
      return new Response("La sesión expiró. Inicia sesión e intenta de nuevo.", { status: 401, headers: noStoreHeaders() });
    }
    const resume = new URL("/oauth/authorize", request.url);
    resume.searchParams.set("resume", requestId);
    return loginRedirect(request, resume.pathname + resume.search);
  }
  const decision = form?.get("decision");
  if (!requestId || (decision !== "allow" && decision !== "deny")) return new Response("Solicitud de autorización inválida.", { status: 400, headers: noStoreHeaders() });

  const db = getDb();
  const now = new Date().toISOString();
  const tx = await db.prepare(
    "SELECT id, user_id, client_id, client_name, redirect_uri, state, code_challenge, scope, resource, expires_at FROM mcp_oauth_requests WHERE id = ? AND user_id = ? AND completed_at IS NULL AND expires_at > ?",
  ).bind(requestId, session.userId, now).first<{
    id: string; user_id: string; client_id: string; client_name: string; redirect_uri: string;
    state: string; code_challenge: string; scope: string; resource: string; expires_at: string;
  }>();
  if (!tx) return new Response("La solicitud expiró o ya fue utilizada. Inicia la conexión nuevamente.", { status: 400, headers: noStoreHeaders() });

  const completionId = randomSecret();
  if (decision === "deny") {
    const result = await db.prepare(
      "UPDATE mcp_oauth_requests SET completed_at = ?, completed_by = ? WHERE id = ? AND user_id = ? AND completed_at IS NULL AND expires_at > ?",
    ).bind(now, completionId, requestId, session.userId, now).run();
    if (!result.meta.changes) return new Response("La solicitud expiró o ya fue utilizada.", { status: 400, headers: noStoreHeaders() });
    return authorizationRedirect(tx.redirect_uri, { error: "access_denied", state: tx.state, iss: requestOrigin });
  }

  const code = "nex_code_" + randomSecret();
  const codeHash = await sha256Hex(code);
  const codeExpires = new Date(Date.now() + AUTH_CODE_SECONDS * 1000).toISOString();
  const results = await db.batch([
    db.prepare(
      "UPDATE mcp_oauth_requests SET completed_at = ?, completed_by = ? WHERE id = ? AND user_id = ? AND completed_at IS NULL AND expires_at > ?",
    ).bind(now, completionId, requestId, session.userId, now),
    db.prepare(
      "INSERT INTO mcp_oauth_codes (code_hash, user_id, client_id, redirect_uri, code_challenge, scope, resource, expires_at) SELECT ?, user_id, client_id, redirect_uri, code_challenge, scope, resource, ? FROM mcp_oauth_requests WHERE id = ? AND completed_by = ?",
    ).bind(codeHash, codeExpires, requestId, completionId),
  ]);
  if (results[1]?.meta.changes !== 1) return new Response("La solicitud expiró o ya fue utilizada.", { status: 400, headers: noStoreHeaders() });
  return authorizationRedirect(tx.redirect_uri, { code, state: tx.state, iss: requestOrigin });
}

function tokenResponse(input: { accessToken: string; refreshToken: string; scopes: string[]; resource: string }) {
  return oauthJson({
    access_token: input.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: input.refreshToken,
    scope: input.scopes.join(" "),
    resource: input.resource,
  });
}

export async function exchangeOAuthToken(request: Request) {
  const form = await readForm(request);
  if (!form) return oauthError("invalid_request", "El cuerpo del token excede el tamaño permitido.");
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  const resource = form.get("resource") ?? "";
  if (!clientId || !resource) return oauthError("invalid_request", "Se requieren client_id y resource.");

  const clientRow = await getDb().prepare(
    "SELECT client_id, client_name, redirect_uris_json, grant_types_json, response_types_json, scopes, revoked_at FROM mcp_oauth_clients WHERE client_id = ?",
  ).bind(clientId).first<OAuthClientRow>();
  if (!clientRow || clientRow.revoked_at) return oauthError("invalid_client", "El cliente OAuth no está activo.");
  const client = parseClientRow(clientRow);
  if (!client) return oauthError("invalid_client", "Los metadatos del cliente OAuth no son válidos.");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return oauthError("unsupported_grant_type", "Solo se admiten authorization_code y refresh_token.");
  }
  if (!client.grantTypes.includes(grantType)) {
    return oauthError("unauthorized_client", "El cliente no está autorizado para este tipo de concesión.");
  }

  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    if (!code || !redirectUri || !verifier) return oauthError("invalid_request", "Faltan datos del intercambio de código.");
    if (!client.redirectUris.includes(redirectUri)) return oauthError("invalid_grant", "La URI de redirección no coincide con el cliente.");
    const codeHash = await sha256Hex(code);
    const now = new Date().toISOString();
    const db = getDb();
    const authorizationCode = await db.prepare(
      "SELECT code_hash, user_id, client_id, redirect_uri, code_challenge, scope, resource, expires_at, consumed_by FROM mcp_oauth_codes WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND expires_at > ? AND consumed_by IS NULL",
    ).bind(codeHash, clientId, redirectUri, now).first<OAuthCodeRow>();
    if (!authorizationCode || authorizationCode.resource !== resource) return oauthError("invalid_grant", "El código de autorización expiró o no coincide.");
    if (!await verifyPkce(verifier, authorizationCode.code_challenge, "S256")) return oauthError("invalid_grant", "La verificación PKCE falló.");

    const operationId = randomSecret();
    const accessToken = "nex_access_" + randomSecret();
    const refreshToken = "nex_refresh_" + randomSecret();
    const [accessHash, refreshHash] = await Promise.all([sha256Hex(accessToken), sha256Hex(refreshToken)]);
    const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_SECONDS * 1000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000).toISOString();
    const results = await db.batch([
      db.prepare("UPDATE mcp_oauth_codes SET consumed_by = ? WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND expires_at > ? AND consumed_by IS NULL")
        .bind(operationId, codeHash, clientId, redirectUri, now),
      db.prepare(
        "INSERT INTO mcp_oauth_grants (id, user_id, client_id, client_name, resource, scopes, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at) SELECT ?, c.user_id, c.client_id, cl.client_name, c.resource, c.scope, ?, ?, ?, ? FROM mcp_oauth_codes c JOIN mcp_oauth_clients cl ON cl.client_id = c.client_id WHERE changes() = 1 AND c.code_hash = ? AND c.consumed_by = ? AND cl.revoked_at IS NULL",
      ).bind(newId(), accessHash, refreshHash, accessExpiresAt, refreshExpiresAt, codeHash, operationId),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return oauthError("invalid_grant", "El código de autorización ya fue utilizado.");
    }
    return tokenResponse({ accessToken, refreshToken, scopes: authorizationCode.scope.split(" "), resource });
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token") ?? "";
    if (!refreshToken) return oauthError("invalid_request", "Se requiere refresh_token.");
    const refreshHash = await sha256Hex(refreshToken);
    const now = new Date().toISOString();
    const grant = await getDb().prepare(
      "SELECT id, user_id, client_id, client_name, resource, scopes, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at FROM mcp_oauth_grants WHERE refresh_token_hash = ? AND client_id = ? AND resource = ? AND revoked_at IS NULL AND refresh_expires_at > ?",
    ).bind(refreshHash, clientId, resource, now).first<OAuthGrantRow>();
    if (!grant) return oauthError("invalid_grant", "La sesión OAuth expiró, fue revocada o no coincide.");

    let scopes: McpOAuthScope[];
    try {
      const currentScopes = parseRequestedScopes(grant.scopes);
      scopes = form.has("scope") ? parseRequestedScopes(form.get("scope")) : currentScopes;
      if (scopes.some((scope) => !currentScopes.includes(scope))) return oauthError("invalid_scope", "No se pueden ampliar los permisos de una sesión existente.");
    } catch {
      return oauthError("invalid_scope", "El scope solicitado no es válido.");
    }

    const accessToken = "nex_access_" + randomSecret();
    const nextRefreshToken = "nex_refresh_" + randomSecret();
    const [accessHash, nextRefreshHash] = await Promise.all([sha256Hex(accessToken), sha256Hex(nextRefreshToken)]);
    const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_SECONDS * 1000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000).toISOString();
    const updated = await getDb().prepare(
      "UPDATE mcp_oauth_grants SET scopes = ?, access_token_hash = ?, refresh_token_hash = ?, access_expires_at = ?, refresh_expires_at = ?, last_used_at = ? WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL AND refresh_expires_at > ?",
    ).bind(scopes.join(" "), accessHash, nextRefreshHash, accessExpiresAt, refreshExpiresAt, now, grant.id, refreshHash, now).run();
    if (!updated.meta.changes) return oauthError("invalid_grant", "La sesión OAuth ya fue renovada o revocada.");
    return tokenResponse({ accessToken, refreshToken: nextRefreshToken, scopes, resource });
  }

  return oauthError("unsupported_grant_type", "Solo se admiten authorization_code y refresh_token.");
}

export async function revokeOAuthToken(request: Request) {
  const form = await readForm(request);
  if (!form) return oauthError("invalid_request", "El cuerpo de revocación debe usar application/x-www-form-urlencoded.");
  const token = form.get("token") ?? "";
  const clientId = form.get("client_id") ?? "";
  if (!token || !clientId) return oauthError("invalid_request", "Se requieren token y client_id.");

  const db = getDb();
  const client = await db.prepare(
    "SELECT client_id, revoked_at FROM mcp_oauth_clients WHERE client_id = ?",
  ).bind(clientId).first<{ client_id: string; revoked_at: string | null }>();
  if (!client || client.revoked_at) return oauthError("invalid_client", "El cliente OAuth no está activo.", 401);

  const hash = await sha256Hex(token);
  await db.prepare(
    "UPDATE mcp_oauth_grants SET revoked_at = datetime('now') WHERE (access_token_hash = ? OR refresh_token_hash = ?) AND client_id = ? AND revoked_at IS NULL",
  ).bind(hash, hash, clientId).run();
  return new Response(null, { status: 200, headers: noStoreHeaders() });
}

export async function resolveMcpAccessToken(token: string, origin: string): Promise<(AuthInfo & { extra: { userId: string } }) | null> {
  if (!/^nex_(?:access|live)_[A-Za-z0-9_-]{40,80}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const db = getDb();
  const resource = resourceUrl(origin);
  const resourceMetadataUrl = new URL("/.well-known/oauth-protected-resource/api/mcp", origin).toString();

  if (token.startsWith("nex_live_")) {
    const legacy = await db.prepare("SELECT id, user_id FROM mcp_tokens WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(tokenHash).first<{ id: string; user_id: string }>();
    if (!legacy) return null;
    await db.prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(legacy.id).run();
    return {
      token,
      clientId: `nex-legacy-${legacy.id}`,
      scopes: [...LEGACY_SCOPES],
      expiresAt: Number.MAX_SAFE_INTEGER,
      resource: new URL(resource),
      resourceMetadataUrl,
      extra: { userId: legacy.user_id },
    };
  }

  const now = new Date().toISOString();
  const grant = await db.prepare(
    "SELECT id, user_id, client_id, scopes, access_expires_at FROM mcp_oauth_grants WHERE access_token_hash = ? AND resource = ? AND revoked_at IS NULL AND access_expires_at > ?",
  ).bind(tokenHash, resource, now).first<{
    id: string; user_id: string; client_id: string; scopes: string; access_expires_at: string;
  }>();
  if (!grant) return null;

  const expiryMs = Date.parse(grant.access_expires_at);
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) return null;
  let scopes: McpOAuthScope[];
  try { scopes = parseRequestedScopes(grant.scopes); }
  catch { return null; }

  await db.prepare("UPDATE mcp_oauth_grants SET last_used_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(grant.id).run();
  return {
    token,
    clientId: grant.client_id,
    scopes,
    expiresAt: Math.floor(expiryMs / 1000),
    resource: new URL(resource),
    resourceMetadataUrl,
    extra: { userId: grant.user_id },
  };
}

export async function listMcpOAuthGrants(userId: string) {
  const { results } = await getDb().prepare(
    "SELECT id, client_name, scopes, created_at, last_used_at FROM mcp_oauth_grants WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
  ).bind(userId).all<{
    id: string;
    client_name: string;
    scopes: string;
    created_at: string;
    last_used_at: string | null;
  }>();
  return results ?? [];
}

export async function revokeMcpOAuthGrant(userId: string, id: string) {
  const result = await getDb().prepare(
    "UPDATE mcp_oauth_grants SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
  ).bind(id, userId).run();
  if (!result.meta.changes) throw new Error("No se encontró la autorización MCP.");
  return { ok: true };
}
