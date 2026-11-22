// @vitest-environment node
/// <reference types="vitest/globals" />
import { env } from "cloudflare:workers";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as AuthorizeRoute } from "./routes/oauth.authorize";
import { Route as InstagramPublishRoute } from "./routes/api.social.instagram.publish";
import { Route as McpRoute } from "./routes/api/mcp";
import { Route as ProtectedResourceRoute } from "./routes/[.]well-known.oauth-protected-resource";
import { Route as ProtectedResourceSplatRoute } from "./routes/[.]well-known.oauth-protected-resource.$";
import { Route as AuthorizationServerRoute } from "./routes/[.]well-known.oauth-authorization-server";
import { Route as RegisterRoute } from "./routes/oauth.register";
import { Route as TokenRoute } from "./routes/oauth.token";
import { Route as UploadRoute } from "./routes/api/content.$id.upload";
import { approvedVideo, bearer, seedContent, seedMcpToken, seedSocialAccount, seedUser } from "./test-utils/fixtures";
import { createFakeBucket, createTestDatabase, FixedLengthStreamPolyfill } from "./test-utils/worker-env";

const session = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("./lib/session", () => ({ readSessionToken: () => session.token, setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

type Handler = (context: { request: Request; params?: Record<string, string> }) => Promise<Response>;
const handlersOf = (route: unknown) => (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers;
const ORIGIN = "https://nex.test";
const REDIRECT = "https://client.test/callback";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let userId: string;

beforeAll(async () => { testDb = await createTestDatabase(); });
afterAll(async () => { await testDb.dispose(); });
beforeEach(async () => {
  Object.assign(env as object, { nex_db: testDb.db, nex_assets: createFakeBucket().bucket, PUBLIC_APP_URL: ORIGIN });
  await testDb.db.prepare("DELETE FROM oauth_clients").run();
  await testDb.db.prepare("DELETE FROM users").run();
  userId = await seedUser(testDb.db);
  session.token = null;
  vi.unstubAllGlobals();
});

const getJson = async (route: unknown, path: string) => {
  const response = await handlersOf(route).GET({ request: new Request(ORIGIN + path) });
  return { response, body: await response.json() as Record<string, unknown> };
};

async function register(body: unknown) {
  const response = await handlersOf(RegisterRoute).POST({ request: new Request(ORIGIN + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  return { response, body: await response.json() as Record<string, any> };
}

async function signIn() {
  await testDb.db.prepare("INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES ('sess-oauth', ?, ?)").bind(userId, new Date(Date.now() + 3_600_000).toISOString()).run();
  session.token = "sess-oauth";
}

function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz-state", ...extra });
}

async function tokenRequest(form: Record<string, string>) {
  const response = await handlersOf(TokenRoute).POST({ request: new Request(ORIGIN + "/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() }) });
  return { response, body: await response.json() as Record<string, any> };
}

/** Recorre registro, consentimiento y canje de código; devuelve los tokens. */
async function connect(options: { name?: string; grants?: string[]; scope?: string } = {}) {
  const client = (await register({ client_name: options.name ?? "Claude", redirect_uris: [REDIRECT] })).body.client_id as string;
  const { verifier, challenge } = pkce();
  await signIn();
  const form = authorizeQuery(client, challenge, options.scope ? { scope: options.scope } : {});
  form.set("decision", "approve");
  for (const grant of options.grants ?? ["content:read", "content:write", "publish"]) form.append("grant", grant);
  const approve = await handlersOf(AuthorizeRoute).POST({ request: new Request(ORIGIN + "/oauth/authorize", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: form.toString() }) });
  const code = new URL(approve.headers.get("location")!).searchParams.get("code")!;
  const tokens = await tokenRequest({ grant_type: "authorization_code", client_id: client, code, redirect_uri: REDIRECT, code_verifier: verifier });
  return { client, tokens: tokens.body, approve };
}

async function rpc(token: string, method: string, params?: unknown, headers: Record<string, string> = {}) {
  const response = await handlersOf(McpRoute).POST({ request: new Request(ORIGIN + "/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...bearer(token), ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }) });
  return { response, body: await response.json() as Record<string, any> };
}

const toolNames = async (token: string) => ((await rpc(token, "tools/list")).body.result.tools as Array<{ name: string }>).map((tool) => tool.name);
const callTool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const { body } = await rpc(token, "tools/call", { name, arguments: args });
  return { isError: body.result?.isError === true, text: body.result?.content?.[0]?.text as string | undefined, error: body.error?.message as string | undefined };
};

describe("metadatos de descubrimiento", () => {
  it("publica los metadatos del recurso protegido (también con la ruta añadida) y del servidor de autorización", async () => {
    const plain = await getJson(ProtectedResourceRoute, "/.well-known/oauth-protected-resource");
    const suffixed = await handlersOf(ProtectedResourceSplatRoute).GET({ request: new Request(ORIGIN + "/.well-known/oauth-protected-resource/api/mcp") });
    expect(plain.body).toMatchObject({ resource: ORIGIN + "/api/mcp", authorization_servers: [ORIGIN], bearer_methods_supported: ["header"] });
    expect(await suffixed.json()).toEqual(plain.body);
    expect(plain.response.headers.get("access-control-allow-origin")).toBe("*");

    const server = (await getJson(AuthorizationServerRoute, "/.well-known/oauth-authorization-server")).body;
    expect(server).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: ORIGIN + "/oauth/authorize",
      token_endpoint: ORIGIN + "/oauth/token",
      registration_endpoint: ORIGIN + "/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("el 401 del MCP apunta a los metadatos para que el cliente inicie OAuth", async () => {
    const anonymous = await handlersOf(McpRoute).POST({ request: new Request(ORIGIN + "/api/mcp", { method: "POST", body: "{}" }) });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toBe(`Bearer realm="Nex MCP", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
    const wrong = await rpc("nex_live_" + "a".repeat(43), "ping");
    expect(wrong.response.status).toBe(401);
    expect(wrong.response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});

describe("registro dinámico de clientes", () => {
  it("registra un cliente público y rechaza redirecciones inseguras o autenticación con secreto", async () => {
    const ok = await register({ client_name: "Claude", redirect_uris: [REDIRECT, "http://localhost:3118/cb"], token_endpoint_auth_method: "none" });
    expect(ok.response.status).toBe(201);
    expect(ok.body).toMatchObject({ client_name: "Claude", redirect_uris: [REDIRECT, "http://localhost:3118/cb"], token_endpoint_auth_method: "none", response_types: ["code"] });
    expect(ok.body.client_id).toMatch(/^nexc_/);

    expect((await register({ redirect_uris: ["http://evil.test/cb"] })).response.status).toBe(400);
    expect((await register({ redirect_uris: ["javascript:alert(1)"] })).response.status).toBe(400);
    expect((await register({ redirect_uris: [REDIRECT + "#frag"] })).response.status).toBe(400);
    expect((await register({ redirect_uris: [] })).response.status).toBe(400);
    const secret = await register({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" });
    expect(secret.response.status).toBe(400);
    expect(secret.body.error).toBe("invalid_client_metadata");
  });
});

describe("autorización con código y PKCE", () => {
  it("manda a iniciar sesión y luego muestra el consentimiento con el nombre escapado", async () => {
    const { body: client } = await register({ client_name: "<b>Claude</b>", redirect_uris: [REDIRECT] });
    const url = ORIGIN + "/oauth/authorize?" + authorizeQuery(client.client_id, pkce().challenge, { scope: "content:read publish" });
    const anonymous = await handlersOf(AuthorizeRoute).GET({ request: new Request(url) });
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("location")).toBe(ORIGIN + "/login?next=" + encodeURIComponent(new URL(url).pathname + new URL(url).search));

    await signIn();
    const page = await handlersOf(AuthorizeRoute).GET({ request: new Request(url) });
    expect(page.status).toBe(200);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    const html = await page.text();
    expect(html).toContain("&lt;b&gt;Claude&lt;/b&gt;");
    expect(html).not.toContain("<b>Claude</b>");
    expect(html).toContain('value="content:read"');
    expect(html).toContain('value="publish"');
    expect(html).not.toContain('value="content:write"');
    expect(html).toContain("pablo@example.test");
  });

  it("no redirige si el cliente, la redirección o PKCE no son válidos", async () => {
    const { body: client } = await register({ redirect_uris: [REDIRECT] });
    await signIn();
    const get = (query: URLSearchParams) => handlersOf(AuthorizeRoute).GET({ request: new Request(ORIGIN + "/oauth/authorize?" + query) });
    const { challenge } = pkce();
    for (const query of [
      authorizeQuery("nexc_desconocido", challenge),
      authorizeQuery(client.client_id, challenge, { redirect_uri: "https://evil.test/callback" }),
      authorizeQuery(client.client_id, challenge, { code_challenge_method: "plain" }),
      authorizeQuery(client.client_id, "corto"),
      authorizeQuery(client.client_id, challenge, { response_type: "token" }),
      authorizeQuery(client.client_id, challenge, { resource: "https://otro.test/api/mcp" }),
    ]) {
      const response = await get(query);
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("aprobar con permisos parciales entrega un código y rechazar devuelve access_denied", async () => {
    const { client, approve } = await connect({ grants: ["content:read", "content:write"] });
    const location = new URL(approve.headers.get("location")!);
    expect(approve.status).toBe(303);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz-state");

    const form = authorizeQuery(client, pkce().challenge);
    form.set("decision", "deny");
    const deny = await handlersOf(AuthorizeRoute).POST({ request: new Request(ORIGIN + "/oauth/authorize", { method: "POST", headers: { origin: ORIGIN }, body: form.toString() }) });
    expect(deny.status).toBe(303);
    expect(deny.headers.get("location")).toBe(REDIRECT + "?error=access_denied&state=xyz-state");
  });

  it("rechaza el consentimiento enviado desde otro origen o sin ningún permiso", async () => {
    const { body: client } = await register({ redirect_uris: [REDIRECT] });
    await signIn();
    const form = authorizeQuery(client.client_id, pkce().challenge);
    form.set("decision", "approve");
    form.append("grant", "publish");
    const post = (origin: string, body: URLSearchParams) => handlersOf(AuthorizeRoute).POST({ request: new Request(ORIGIN + "/oauth/authorize", { method: "POST", headers: { origin }, body: body.toString() }) });
    expect((await post("https://evil.test", form)).status).toBe(400);
    const noGrants = authorizeQuery(client.client_id, pkce().challenge);
    noGrants.set("decision", "approve");
    expect((await post(ORIGIN, noGrants)).status).toBe(400);
    expect((await testDb.db.prepare("SELECT COUNT(*) AS total FROM oauth_codes").first<{ total: number }>())?.total).toBe(0);
  });
});

describe("endpoint de token", () => {
  it("canjea el código con PKCE y entrega una clave con los permisos concedidos", async () => {
    const { tokens } = await connect({ grants: ["content:read", "content:write"] });
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "content:read content:write" });
    expect(tokens.access_token).toMatch(/^nex_live_/);
    expect(tokens.refresh_token).toMatch(/^nex_refresh_/);
    const row = await testDb.db.prepare("SELECT label, scopes, client_id, token_hash, refresh_hash FROM mcp_tokens WHERE user_id = ?").bind(userId).first<Record<string, string>>();
    expect(row).toMatchObject({ label: "Claude", scopes: "content:read content:write" });
    expect(row!.token_hash).not.toBe(tokens.access_token);
    expect(row!.refresh_hash).not.toBe(tokens.refresh_token);
    expect((await rpc(tokens.access_token, "ping")).response.status).toBe(200);
  });

  it("un verifier incorrecto, otra redirección o reutilizar el código fallan y el código se consume", async () => {
    const { body: client } = await register({ redirect_uris: [REDIRECT] });
    await signIn();
    const { verifier, challenge } = pkce();
    async function newCode() {
      const form = authorizeQuery(client.client_id, challenge);
      form.set("decision", "approve");
      form.append("grant", "content:read");
      const approve = await handlersOf(AuthorizeRoute).POST({ request: new Request(ORIGIN + "/oauth/authorize", { method: "POST", headers: { origin: ORIGIN }, body: form.toString() }) });
      return new URL(approve.headers.get("location")!).searchParams.get("code")!;
    }
    const base = { grant_type: "authorization_code", client_id: client.client_id, redirect_uri: REDIRECT };

    const wrongVerifier = await newCode();
    expect((await tokenRequest({ ...base, code: wrongVerifier, code_verifier: pkce().verifier })).body.error).toBe("invalid_grant");
    expect((await tokenRequest({ ...base, code: wrongVerifier, code_verifier: verifier })).body.error).toBe("invalid_grant");

    const wrongRedirect = await newCode();
    expect((await tokenRequest({ ...base, code: wrongRedirect, redirect_uri: "https://client.test/otra", code_verifier: verifier })).body.error).toBe("invalid_grant");

    const good = await newCode();
    expect((await tokenRequest({ ...base, code: good, code_verifier: verifier })).response.status).toBe(200);
    expect((await tokenRequest({ ...base, code: good, code_verifier: verifier })).body.error).toBe("invalid_grant");

    const otherClient = (await register({ redirect_uris: [REDIRECT] })).body.client_id;
    const stolen = await newCode();
    expect((await tokenRequest({ ...base, client_id: otherClient, code: stolen, code_verifier: verifier })).body.error).toBe("invalid_grant");
    expect((await tokenRequest({ ...base, client_id: "nexc_nadie", code: "x", code_verifier: verifier })).response.status).toBe(401);
  });

  it("un código vencido no se canjea", async () => {
    const { client, approve } = await connect();
    expect(approve.status).toBe(303);
    const { body: other } = await register({ redirect_uris: [REDIRECT] });
    const { verifier, challenge } = pkce();
    await signIn();
    const form = authorizeQuery(other.client_id, challenge);
    form.set("decision", "approve");
    form.append("grant", "content:read");
    const response = await handlersOf(AuthorizeRoute).POST({ request: new Request(ORIGIN + "/oauth/authorize", { method: "POST", headers: { origin: ORIGIN }, body: form.toString() }) });
    await testDb.db.prepare("UPDATE oauth_codes SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const code = new URL(response.headers.get("location")!).searchParams.get("code")!;
    expect((await tokenRequest({ grant_type: "authorization_code", client_id: other.client_id, code, redirect_uri: REDIRECT, code_verifier: verifier })).body.error).toBe("invalid_grant");
    expect(client).toBeTruthy();
  });

  it("el refresh token rota: el anterior y la clave anterior dejan de servir", async () => {
    const { client, tokens } = await connect();
    const refreshed = await tokenRequest({ grant_type: "refresh_token", client_id: client, refresh_token: tokens.refresh_token });
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(tokens.access_token);
    expect(refreshed.body.refresh_token).not.toBe(tokens.refresh_token);
    expect(refreshed.body.scope).toBe("content:read content:write publish");

    expect((await rpc(tokens.access_token, "ping")).response.status).toBe(401);
    expect((await rpc(refreshed.body.access_token, "ping")).response.status).toBe(200);
    expect((await tokenRequest({ grant_type: "refresh_token", client_id: client, refresh_token: tokens.refresh_token })).body.error).toBe("invalid_grant");
    expect((await tokenRequest({ grant_type: "refresh_token", client_id: "nexc_otro", refresh_token: refreshed.body.refresh_token })).response.status).toBe(401);
    const count = await testDb.db.prepare("SELECT COUNT(*) AS total FROM mcp_tokens WHERE user_id = ?").bind(userId).first<{ total: number }>();
    expect(count?.total).toBe(1);
  });

  it("la clave OAuth vence a la hora y revocarla corta también el refresh", async () => {
    const { client, tokens } = await connect();
    await testDb.db.prepare("UPDATE mcp_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").bind(userId).run();
    expect((await rpc(tokens.access_token, "ping")).response.status).toBe(401);
    // Vencida la clave, el cliente renueva con el refresh token y vuelve a funcionar.
    const refreshed = await tokenRequest({ grant_type: "refresh_token", client_id: client, refresh_token: tokens.refresh_token });
    expect((await rpc(refreshed.body.access_token, "ping")).response.status).toBe(200);

    await testDb.db.prepare("UPDATE mcp_tokens SET revoked_at = datetime('now'), refresh_hash = NULL WHERE user_id = ?").bind(userId).run();
    expect((await rpc(refreshed.body.access_token, "ping")).response.status).toBe(401);
    expect((await tokenRequest({ grant_type: "refresh_token", client_id: client, refresh_token: refreshed.body.refresh_token })).body.error).toBe("invalid_grant");
  });

  it("exige formulario y un grant_type conocido", async () => {
    const json = await handlersOf(TokenRoute).POST({ request: new Request(ORIGIN + "/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }) });
    expect(json.status).toBe(400);
    const { body: client } = await register({ redirect_uris: [REDIRECT] });
    expect((await tokenRequest({ grant_type: "password", client_id: client.client_id })).body.error).toBe("unsupported_grant_type");
  });
});

describe("permisos por clave", () => {
  it("una clave de solo lectura ve y usa solo las herramientas de lectura", async () => {
    const readOnly = await seedMcpToken(testDb.db, userId, "Lectura", "content:read");
    const names = await toolNames(readOnly);
    expect(names).toEqual(expect.arrayContaining(["list_content", "list_social_accounts", "list_publications"]));
    expect(names).not.toEqual(expect.arrayContaining(["create_content"]));
    expect(names).not.toEqual(expect.arrayContaining(["publish_instagram_reel"]));

    expect((await callTool(readOnly, "list_content")).isError).toBe(false);
    const denied = await callTool(readOnly, "create_content", { title: "Nada" });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("content:write");
    expect((await testDb.db.prepare("SELECT COUNT(*) AS total FROM content_items").first<{ total: number }>())?.total).toBe(0);
  });

  it("escribir no basta para publicar: programar en cuentas, cancelar y publicar piden «publish»", async () => {
    const writer = await seedMcpToken(testDb.db, userId, "Escritura", "content:read content:write");
    const names = await toolNames(writer);
    expect(names).toContain("create_content");
    expect(names).toContain("schedule_content");
    expect(names).not.toContain("publish_instagram_reel");
    expect(names).not.toContain("cancel_publication");

    const contentId = await seedContent(testDb.db, userId, approvedVideo());
    const account = await seedSocialAccount(testDb.db, userId);
    const when = new Date(Date.now() + 3_600_000).toISOString();
    const onAccount = await callTool(writer, "schedule_content", { id: contentId, scheduled_at: when, account_ids: [account] });
    expect(onAccount.isError).toBe(true);
    expect(onAccount.text).toContain("publish");
    expect((await testDb.db.prepare("SELECT COUNT(*) AS total FROM publications").first<{ total: number }>())?.total).toBe(0);
    expect((await callTool(writer, "schedule_content", { id: contentId, scheduled_at: when })).isError).toBe(false);
    expect((await callTool(writer, "publish_instagram_reel", { content_id: contentId, account_id: account, confirm_publish: true })).isError).toBe(true);
    expect((await callTool(writer, "cancel_publication", { id: "x" })).text).toContain("publish");
  });

  it("las claves anteriores conservan todos los permisos", async () => {
    const legacy = await seedMcpToken(testDb.db, userId);
    expect(await toolNames(legacy)).toHaveLength(10);
  });

  it("la subida de archivos pide content:write y la publicación de Instagram pide publish", async () => {
    vi.stubGlobal("FixedLengthStream", FixedLengthStreamPolyfill);
    const contentId = await seedContent(testDb.db, userId);
    const upload = (token: string) => handlersOf(UploadRoute).POST({ request: new Request(`${ORIGIN}/api/content/${contentId}/upload?action=start`, { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({ filename: "a.mp4", contentType: "video/mp4", size: 3 }) }), params: { id: contentId } });
    expect((await upload(await seedMcpToken(testDb.db, userId, "Lectura", "content:read"))).status).toBe(403);
    expect((await upload(await seedMcpToken(testDb.db, userId, "Escritura", "content:write"))).status).toBe(200);

    const publish = (token: string) => handlersOf(InstagramPublishRoute).POST({ request: new Request(ORIGIN + "/api/social/instagram/publish", { method: "POST", headers: bearer(token), body: JSON.stringify({ action: "check", jobId: "x" }) }) });
    expect((await publish(await seedMcpToken(testDb.db, userId, "Escritura", "content:read content:write"))).status).toBe(403);
    expect((await publish(await seedMcpToken(testDb.db, userId, "Publicar", "publish"))).status).not.toBe(403);
  });

  it("la clave OAuth hereda solo lo que la persona concedió", async () => {
    const { tokens } = await connect({ grants: ["content:read"] });
    expect(await toolNames(tokens.access_token)).not.toContain("create_content");
    expect((await callTool(tokens.access_token, "create_content", { title: "x" })).isError).toBe(true);
  });
});

describe("versión del protocolo MCP", () => {
  it("responde con la versión que pide el cliente si la conoce y con la más reciente si no", async () => {
    const key = await seedMcpToken(testDb.db, userId);
    for (const version of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
      expect((await rpc(key, "initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } })).body.result.protocolVersion).toBe(version);
    }
    expect((await rpc(key, "initialize", { protocolVersion: "1999-01-01" })).body.result.protocolVersion).toBe("2025-11-25");
    expect((await rpc(key, "initialize")).body.result.protocolVersion).toBe("2025-11-25");
  });

  it("rechaza una cabecera MCP-Protocol-Version desconocida", async () => {
    const key = await seedMcpToken(testDb.db, userId);
    expect((await rpc(key, "ping", undefined, { "mcp-protocol-version": "2024-11-05" })).response.status).toBe(200);
    expect((await rpc(key, "ping", undefined, { "mcp-protocol-version": "1999-01-01" })).response.status).toBe(400);
  });
});
