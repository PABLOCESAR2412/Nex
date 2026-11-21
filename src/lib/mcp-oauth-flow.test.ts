import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginOAuthAuthorization,
  completeOAuthAuthorization,
  exchangeOAuthToken,
  registerOAuthClient,
  revokeOAuthToken,
} from "./mcp-oauth";

const fakeDb = vi.hoisted(() => ({
  queries: [] as string[],
  binds: [] as unknown[][],
  first: vi.fn(),
  run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 0 } }]),
  limit: vi.fn().mockResolvedValue({ success: true }),
  limiterEnabled: true,
  session: null as null | { id: string; userId: string },
}));

vi.mock("./auth", () => ({ getCurrentSession: async () => fakeDb.session }));

vi.mock("./db", () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      fakeDb.queries.push(sql);
      return {
        bind: (...args: unknown[]) => {
          fakeDb.binds.push(args);
          return { first: fakeDb.first, run: fakeDb.run };
        },
      };
    },
    batch: fakeDb.batch,
  }),
  getRuntimeEnv: () => fakeDb.limiterEnabled
    ? { NEX_OAUTH_REGISTRATION_LIMITER: { limit: fakeDb.limit } }
    : {},
  newId: () => "test-grant-id",
}));

vi.mock("./instagram", () => ({
  randomSecret: () => "r".repeat(43),
  sha256Hex: async (value: string) => `hash:${value}`,
}));

const resource = "https://nex.example/api/mcp";
const redirectUri = "http://127.0.0.1:27890/callback";
const verifier = "v".repeat(43);

async function challengeFor(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function clientRow(grantTypes: string[]) {
  return {
    client_id: "client-test-id",
    client_name: "Hermes",
    redirect_uris_json: JSON.stringify([redirectUri]),
    grant_types_json: JSON.stringify(grantTypes),
    response_types_json: JSON.stringify(["code"]),
    scopes: "nex:read",
    revoked_at: null,
  };
}

function tokenRequest(fields: Record<string, string>) {
  return new Request("https://nex.example/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

function revocationRequest(fields: Record<string, string>) {
  return new Request("https://nex.example/oauth/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

function registrationRequest() {
  return new Request("https://nex.example/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.4" },
    body: JSON.stringify({
      client_name: "Hermes Agent",
      application_type: "native",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "nex:read",
    }),
  });
}

describe("MCP OAuth token client policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb.first.mockReset();
    fakeDb.run.mockReset().mockResolvedValue({ meta: { changes: 1 } });
    fakeDb.batch.mockReset().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 0 } }]);
    fakeDb.limit.mockReset().mockResolvedValue({ success: true });
    fakeDb.limiterEnabled = true;
    fakeDb.queries.length = 0;
    fakeDb.binds.length = 0;
    fakeDb.session = null;
  });

  it("preserves a pending consent request across login without carrying the allow decision", async () => {
    const requestId = "r".repeat(43);
    const request = new Request("https://nex.example/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://nex.example",
      },
      body: new URLSearchParams({ request_id: requestId, decision: "allow" }),
    });

    const response = await completeOAuthAuthorization(request);
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(302);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(`/oauth/authorize?resume=${requestId}`);
  });

  it.each(["missing", "null"])("accepts consent POSTs from an embedded browser with %s Origin", async (originMode) => {
    const requestId = "r".repeat(43);
    const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
    if (originMode === "null") headers.set("origin", "null");
    const response = await completeOAuthAuthorization(new Request("https://nex.example/oauth/authorize", {
      method: "POST",
      headers,
      body: new URLSearchParams({ request_id: requestId, decision: "allow" }),
    }));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(302);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(`/oauth/authorize?resume=${requestId}`);
  });

  it("rejects consent POSTs from an unrelated browser origin", async () => {
    const response = await completeOAuthAuthorization(new Request("https://nex.example/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
      },
      body: new URLSearchParams({ request_id: "r".repeat(43), decision: "allow" }),
    }));

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Origen no permitido.");
  });

  it("resumes pending consent for the same authenticated user", async () => {
    const requestId = "pending-request-1234567890";
    fakeDb.session = { id: "session-test-id", userId: "user-test-id" };
    fakeDb.first
      .mockResolvedValueOnce({
        id: requestId,
        user_id: "user-test-id",
        client_id: "client-test-id",
        client_name: "Hermes Agent",
        redirect_uri: redirectUri,
        state: "opaque-state-1234567890",
        code_challenge: "A".repeat(43),
        scope: "nex:read",
        resource,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .mockResolvedValueOnce({ email: "pablocesar.t.g@gmail.com" });

    const response = await beginOAuthAuthorization(
      new Request(`https://nex.example/oauth/authorize?resume=${requestId}`),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Conectar Hermes Agent con Nex");
    expect(body).toContain("pablocesar.t.g@gmail.com");
    expect(body).toContain(requestId);
  });

  it("rate-limits public client registration before any D1 write", async () => {
    fakeDb.limit.mockResolvedValueOnce({ success: false });

    const response = await registerOAuthClient(registrationRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "rate_limit_exceeded" });
    expect(fakeDb.queries).toHaveLength(0);
    expect(fakeDb.limit).toHaveBeenCalledWith({ key: "nex-oauth-register:198.51.100.4" });
  });

  it("registers ChatGPT as a public web client with its HTTPS callback", async () => {
    const response = await registerOAuthClient(new Request("https://nex.example/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.5" },
      body: JSON.stringify({
        client_name: "ChatGPT",
        application_type: "web",
        redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "nex:read nex:write nex:publish offline_access",
      }),
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      client_name: "ChatGPT",
      application_type: "web",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_method: "none",
    });
  });

  it("fails closed if the registration rate limiter is missing", async () => {
    fakeDb.limiterEnabled = false;

    const response = await registerOAuthClient(registrationRequest());

    expect(response.status).toBe(503);
    expect(fakeDb.queries).toHaveLength(0);
    expect(fakeDb.limit).not.toHaveBeenCalled();
  });

  it("enforces the global registered-client cap atomically", async () => {
    fakeDb.run.mockResolvedValue({ meta: { changes: 0 } });

    const response = await registerOAuthClient(registrationRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "temporarily_unavailable" });
    expect(fakeDb.queries.some((sql) => /COUNT\(\*\)/i.test(sql))).toBe(true);
  });

  it("rejects an authorization-code grant not registered for the client", async () => {
    const code = "one-time-code";
    fakeDb.first
      .mockResolvedValueOnce(clientRow(["refresh_token"]))
      .mockResolvedValueOnce({
        code_hash: `hash:${code}`,
        user_id: "user-test-id",
        email: "pablocesar.t.g@gmail.com",
        client_id: "client-test-id",
        redirect_uri: redirectUri,
        code_challenge: await challengeFor(verifier),
        scope: "nex:read",
        resource,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_by: null,
      });

    const response = await exchangeOAuthToken(tokenRequest({
      grant_type: "authorization_code",
      client_id: "client-test-id",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "unauthorized_client" });
    expect(fakeDb.first).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect URI that is not registered for the client", async () => {
    const code = "one-time-code";
    const unregisteredUri = "http://127.0.0.1:27891/callback";
    fakeDb.first
      .mockResolvedValueOnce(clientRow(["authorization_code", "refresh_token"]))
      .mockResolvedValueOnce({
        code_hash: `hash:${code}`,
        user_id: "user-test-id",
        email: "pablocesar.t.g@gmail.com",
        client_id: "client-test-id",
        redirect_uri: unregisteredUri,
        code_challenge: await challengeFor(verifier),
        scope: "nex:read",
        resource,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_by: null,
      });

    const response = await exchangeOAuthToken(tokenRequest({
      grant_type: "authorization_code",
      client_id: "client-test-id",
      code,
      redirect_uri: unregisteredUri,
      code_verifier: verifier,
      resource,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
    expect(fakeDb.batch).not.toHaveBeenCalled();
  });

  it("does not issue tokens unless this exchange atomically consumed the code", async () => {
    const code = "contended-code";
    fakeDb.first
      .mockResolvedValueOnce(clientRow(["authorization_code", "refresh_token"]))
      .mockResolvedValueOnce({
        code_hash: `hash:${code}`,
        user_id: "user-test-id",
        email: "pablocesar.t.g@gmail.com",
        client_id: "client-test-id",
        redirect_uri: redirectUri,
        code_challenge: await challengeFor(verifier),
        scope: "nex:read",
        resource,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_by: null,
      });
    fakeDb.batch.mockResolvedValueOnce([{ meta: { changes: 0 } }, { meta: { changes: 1 } }]);

    const response = await exchangeOAuthToken(tokenRequest({
      grant_type: "authorization_code",
      client_id: "client-test-id",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
    expect(fakeDb.queries[3]).toMatch(/changes\(\)\s*=\s*1/i);
  });

  it("extends refresh-token expiry when the client rotates an active token", async () => {
    const originalExpiry = new Date(Date.now() + 60_000).toISOString();
    fakeDb.first
      .mockResolvedValueOnce(clientRow(["authorization_code", "refresh_token"]))
      .mockResolvedValueOnce({
        id: "grant-test-id",
        user_id: "user-test-id",
        email: "pablocesar.t.g@gmail.com",
        client_id: "client-test-id",
        client_name: "Hermes",
        resource,
        scopes: "nex:read",
        access_token_hash: "old-access-hash",
        refresh_token_hash: "hash:old-refresh-token",
        access_expires_at: new Date(Date.now() + 60_000).toISOString(),
        refresh_expires_at: originalExpiry,
      });

    const response = await exchangeOAuthToken(tokenRequest({
      grant_type: "refresh_token",
      client_id: "client-test-id",
      refresh_token: "old-refresh-token",
      resource,
    }));

    expect(response.status).toBe(200);
    const rotatedExpiry = Date.parse(String(fakeDb.binds[2]?.[4]));
    expect(rotatedExpiry).toBeGreaterThan(Date.parse(originalExpiry));
    expect(rotatedExpiry).toBeLessThanOrEqual(Date.now() + 31 * 24 * 60 * 60 * 1000);
  });

  it("rejects token revocation from an unknown OAuth client", async () => {
    fakeDb.first.mockResolvedValueOnce(null);

    const response = await revokeOAuthToken(revocationRequest({
      token: "refresh-token-to-revoke",
      client_id: "unknown-client-id",
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_client" });
    expect(fakeDb.run).not.toHaveBeenCalled();
  });

  it("binds a token revocation to the registered OAuth client", async () => {
    fakeDb.first.mockResolvedValueOnce({ client_id: "client-test-id", revoked_at: null });

    const response = await revokeOAuthToken(revocationRequest({
      token: "refresh-token-to-revoke",
      client_id: "client-test-id",
    }));

    expect(response.status).toBe(200);
    expect(fakeDb.queries[1]).toContain("AND client_id = ?");
    expect(fakeDb.binds[1]).toEqual([
      "hash:refresh-token-to-revoke",
      "hash:refresh-token-to-revoke",
      "client-test-id",
    ]);
  });
});
