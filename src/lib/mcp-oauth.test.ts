import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
  resolveMcpAccessToken,
} from "./mcp-oauth";

const db = vi.hoisted(() => ({
  bind: vi.fn(),
  first: vi.fn(),
  run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
}));

vi.mock("./db", () => ({
  getDb: () => ({ prepare: () => ({ bind: (...args: unknown[]) => { db.bind(...args); return { first: db.first, run: db.run }; } }) }),
  newId: () => "test-id",
}));

const ACCESS_TOKEN = `nex_access_${"a".repeat(43)}`;
const RESOURCE = "https://nex.example/api/mcp";

describe("MCP OAuth discovery metadata", () => {
  it("publishes OAuth 2.1, PKCE, refresh, and issuer-response capabilities", () => {
    expect(authorizationServerMetadata("https://nex.example")).toMatchObject({
      issuer: "https://nex.example",
      authorization_endpoint: "https://nex.example/oauth/authorize",
      token_endpoint: "https://nex.example/oauth/token",
      registration_endpoint: "https://nex.example/oauth/register",
      revocation_endpoint: "https://nex.example/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      scopes_supported: ["nex:read", "nex:write", "nex:publish", "offline_access"],
      client_id_metadata_document_supported: false,
    });
  });

  it("advertises the exact MCP resource and authorization server", () => {
    expect(protectedResourceMetadata("https://nex.example")).toMatchObject({
      resource: RESOURCE,
      authorization_servers: ["https://nex.example"],
      scopes_supported: ["nex:read", "nex:write", "nex:publish", "offline_access"],
      bearer_methods_supported: ["header"],
    });
  });
});

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("MCP OAuth access-token lookup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns SDK auth info bound to the user, resource, scopes, and expiry", async () => {
    const expiry = new Date(Date.now() + 30 * 60_000).toISOString();
    db.first.mockResolvedValue({
      id: "grant-test-id",
      user_id: "user-test-id",
      email: "pablocesar.t.g@gmail.com",
      client_id: "client-test-id",
      scopes: "nex:read nex:write",
      resource: RESOURCE,
      access_expires_at: expiry,
    });

    const authInfo = await resolveMcpAccessToken(ACCESS_TOKEN, "https://nex.example");

    expect(db.first).toHaveBeenCalled();
    expect(db.bind.mock.calls[0]?.[0]).toBe(await sha256(ACCESS_TOKEN));
    expect(authInfo).toMatchObject({
      token: ACCESS_TOKEN,
      clientId: "client-test-id",
      scopes: ["nex:read", "nex:write"],
      resource: new URL(RESOURCE),
      extra: { userId: "user-test-id" },
    });
    expect(authInfo?.expiresAt).toBe(Math.floor(Date.parse(expiry) / 1000));
    expect(db.run).toHaveBeenCalled();
    expect(await sha256(ACCESS_TOKEN)).toHaveLength(64);
  });

  it("rejects an unknown, expired, or revoked access token", async () => {
    db.first.mockResolvedValue(null);
    await expect(resolveMcpAccessToken(ACCESS_TOKEN, "https://nex.example")).resolves.toBeNull();
  });
});
