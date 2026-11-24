import { describe, expect, it } from "vitest";
import {
  createHermesInstallLink,
  parseRequestedScopes,
  validateClientRegistration,
  validateOAuthAuthorizeParams,
  verifyPkce,
} from "./mcp-oauth-protocol";

const RESOURCE = "https://nex.example/api/mcp";

function baseAuthorizeParams() {
  return new URLSearchParams({
    response_type: "code",
    client_id: "nex_client_test",
    redirect_uri: "http://127.0.0.1:27890/callback",
    state: "opaque-state-1234567890",
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
    resource: RESOURCE,
    scope: "nex:read nex:write",
  });
}

describe("MCP OAuth protocol validation", () => {
  it("accepts an authorization request bound to the registered client and MCP resource", () => {
    const params = validateOAuthAuthorizeParams(baseAuthorizeParams(), {
      resource: RESOURCE,
      client: { clientId: "nex_client_test", redirectUris: ["http://127.0.0.1:27890/callback"], grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"], scopes: ["nex:read", "nex:write"] },
    });

    expect(params.scope).toEqual(["nex:read", "nex:write"]);
    expect(params.redirectUri).toBe("http://127.0.0.1:27890/callback");
  });

  it("rejects an authorization request with an unregistered callback", () => {
    const values = baseAuthorizeParams();
    values.set("redirect_uri", "http://127.0.0.1:27891/callback");

    expect(() => validateOAuthAuthorizeParams(values, {
      resource: RESOURCE,
      client: { clientId: "nex_client_test", redirectUris: ["http://127.0.0.1:27890/callback"], grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"], scopes: ["nex:read", "nex:write"] },
    })).toThrow(/redirecci/i);
  });

  it("rejects an authorization request for a different resource or PKCE method", () => {
    const resourceMismatch = baseAuthorizeParams();
    resourceMismatch.set("resource", "https://attacker.example/mcp");
    expect(() => validateOAuthAuthorizeParams(resourceMismatch, {
      resource: RESOURCE,
      client: { clientId: "nex_client_test", redirectUris: ["http://127.0.0.1:27890/callback"], grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"], scopes: ["nex:read", "nex:write"] },
    })).toThrow(/resource/i);

    const weakPkce = baseAuthorizeParams();
    weakPkce.set("code_challenge_method", "plain");
    expect(() => validateOAuthAuthorizeParams(weakPkce, {
      resource: RESOURCE,
      client: { clientId: "nex_client_test", redirectUris: ["http://127.0.0.1:27890/callback"], grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"], scopes: ["nex:read", "nex:write"] },
    })).toThrow(/PKCE|challenge/i);
  });

  it("rejects authorization for scopes not registered by the client", () => {
    const params = baseAuthorizeParams();
    params.set("scope", "nex:publish");
    expect(() => validateOAuthAuthorizeParams(params, {
      resource: RESOURCE,
      client: { clientId: "nex_client_test", redirectUris: ["http://127.0.0.1:27890/callback"], grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"], scopes: ["nex:read", "nex:write"] },
    })).toThrow(/scope/i);
  });

  it("accepts only public PKCE clients with safe loopback callback URLs", () => {
    const client = validateClientRegistration({
      client_name: "Hermes Agent",
      redirect_uris: ["http://127.0.0.1:27890/callback", "http://localhost:27890/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "nex:read nex:write nex:publish offline_access",
    });
    expect(client.redirectUris).toHaveLength(2);
    expect(client.applicationType).toBe("native");
    expect(client.scopes).toEqual(["nex:read", "nex:write", "nex:publish", "offline_access"]);

    expect(() => validateClientRegistration({
      client_name: "Hermes Agent",
      application_type: "web",
      redirect_uris: ["http://127.0.0.1:27890/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    })).toThrow(/redirecci/i);
  });

  it("accepts ChatGPT web OAuth callbacks over HTTPS", () => {
    const client = validateClientRegistration({
      client_name: "ChatGPT",
      application_type: "web",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "nex:read nex:write nex:publish",
    });

    expect(client.applicationType).toBe("web");
    expect(client.redirectUris).toEqual(["https://chatgpt.com/connector_platform_oauth_redirect"]);
    const inferred = validateClientRegistration({
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(inferred.applicationType).toBe("web");
    expect(() => validateClientRegistration({
      client_name: "ChatGPT",
      application_type: "web",
      redirect_uris: ["http://chatgpt.com/connector_platform_oauth_redirect"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    })).toThrow(/HTTPS/i);
  });

  it("limits requested scopes to Nex permissions and defaults to read-only", () => {
    expect(parseRequestedScopes(undefined)).toEqual(["nex:read"]);
    expect(parseRequestedScopes("nex:read offline_access")).toEqual(["nex:read", "offline_access"]);
    expect(() => parseRequestedScopes("nex:read admin")).toThrow(/scope/i);
  });

  it("verifies S256 PKCE and rejects a mismatching verifier", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const bytes = new Uint8Array(digest);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const challenge = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

    await expect(verifyPkce(verifier, challenge, "S256")).resolves.toBe(true);
    await expect(verifyPkce("wrong-verifier", challenge, "S256")).resolves.toBe(false);
  });

  it("builds a Hermes install link with OAuth settings and no embedded secret", () => {
    const link = createHermesInstallLink("https://nex.example/api/mcp");
    const url = new URL(link);
    const config = JSON.parse(atob(url.searchParams.get("config")!.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;

    expect(url.protocol).toBe("hermes:");
    expect(url.pathname).toBe("/install");
    expect(url.searchParams.get("name")).toBe("nex");
    expect(config).toMatchObject({ url: "https://nex.example/api/mcp", auth: "oauth", trust: "untrusted" });
    expect(JSON.stringify(config)).not.toMatch(/authorization|bearer|token/i);
  });

  it("allows HTTP only for explicit loopback MCP endpoints", () => {
    expect(() => createHermesInstallLink("http://nex.example/api/mcp")).toThrow(/HTTPS/i);
    expect(() => createHermesInstallLink("ftp://localhost/api/mcp")).toThrow(/HTTPS/i);
    expect(() => createHermesInstallLink("http://localhost:8788/api/mcp")).not.toThrow();
  });
});
