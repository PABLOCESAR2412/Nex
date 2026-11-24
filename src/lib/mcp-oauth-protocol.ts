export const MCP_OAUTH_SCOPES = ["nex:read", "nex:write", "nex:publish", "offline_access"] as const;
export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

export type RegisteredOAuthClient = {
  clientId: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scopes: McpOAuthScope[];
};

export type OAuthAuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: McpOAuthScope[];
  resource: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseRequestedScopes(value: string | undefined | null): McpOAuthScope[] {
  const requested = value?.trim() ? value.trim().split(/\s+/) : ["nex:read"];
  const unique = [...new Set(requested)];
  if (!unique.length || unique.some((scope) => !MCP_OAUTH_SCOPES.includes(scope as McpOAuthScope))) {
    throw new Error("El scope solicitado no está permitido.");
  }
  return unique as McpOAuthScope[];
}

export function isAllowedLoopbackRedirectUri(value: string): boolean {
  try {
    const uri = new URL(value);
    const port = Number(uri.port);
    return uri.protocol === "http:" &&
      (uri.hostname === "localhost" || uri.hostname === "127.0.0.1") &&
      Number.isInteger(port) && port >= 1024 && port <= 65535 &&
      uri.pathname === "/callback" && !uri.search && !uri.hash && !uri.username && !uri.password;
  } catch {
    return false;
  }
}

function isAllowedWebRedirectUri(value: string): boolean {
  try {
    const uri = new URL(value);
    return uri.protocol === "https:" && !!uri.hostname && !uri.search && !uri.hash && !uri.username && !uri.password;
  } catch {
    return false;
  }
}

export function validateClientRegistration(input: unknown) {
  if (!isRecord(input)) throw new Error("La solicitud de registro del cliente no es válida.");
  const redirectUris = input.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 10 || redirectUris.some((uri) => typeof uri !== "string")) {
    throw new Error("La lista de URIs de redirección no es válida.");
  }
  const applicationType = input.application_type ?? (redirectUris.every((uri) => isAllowedLoopbackRedirectUri(uri as string)) ? "native" : "web");
  if (applicationType !== "native" && applicationType !== "web") throw new Error("El tipo de cliente OAuth no es válido.");
  if (redirectUris.some((uri) => !(applicationType === "native" ? isAllowedLoopbackRedirectUri(uri) : isAllowedWebRedirectUri(uri)))) {
    throw new Error(applicationType === "native"
      ? "Registra URIs HTTP de loopback para un cliente nativo."
      : "Registra únicamente URIs HTTPS de redirección para un cliente web.");
  }

  const grantTypes = input.grant_types === undefined ? ["authorization_code", "refresh_token"] : input.grant_types;
  if (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code") || !grantTypes.includes("refresh_token") ||
      grantTypes.some((grant) => grant !== "authorization_code" && grant !== "refresh_token")) {
    throw new Error("El cliente debe admitir authorization_code y refresh_token.");
  }

  const responseTypes = input.response_types === undefined ? ["code"] : input.response_types;
  if (!Array.isArray(responseTypes) || responseTypes.length !== 1 || responseTypes[0] !== "code") {
    throw new Error("El cliente debe usar response_type code.");
  }
  if (input.token_endpoint_auth_method !== "none") {
    throw new Error("El cliente MCP debe ser público y usar PKCE, sin client secret.");
  }

  const clientName = typeof input.client_name === "string" ? input.client_name.trim() : "Hermes MCP client";
  if (!clientName || clientName.length > 80 || /[\u0000-\u001f\u007f]/.test(clientName)) {
    throw new Error("El nombre del cliente no es válido.");
  }

  return {
    clientName,
    applicationType,
    redirectUris: [...new Set(redirectUris as string[])],
    grantTypes: [...new Set(grantTypes as string[])],
    responseTypes: ["code"],
    scopes: typeof input.scope === "string" ? parseRequestedScopes(input.scope) : [...MCP_OAUTH_SCOPES],
  };
}

export function validateOAuthAuthorizeParams(
  params: URLSearchParams,
  options: { resource: string; client: RegisteredOAuthClient },
): OAuthAuthorizeRequest {
  const clientId = params.get("client_id") ?? "";
  if (!clientId || clientId !== options.client.clientId) throw new Error("El cliente OAuth no está registrado.");
  if (!options.client.grantTypes.includes("authorization_code")) throw new Error("El cliente no admite authorization_code.");
  if (!options.client.responseTypes.includes("code")) throw new Error("El cliente no admite response_type=code.");
  if (params.get("response_type") !== "code") throw new Error("Solo se admite response_type=code.");

  const redirectUri = params.get("redirect_uri") ?? "";
  if (!options.client.redirectUris.includes(redirectUri)) throw new Error("La URI de redirección no está registrada.");

  const state = params.get("state") ?? "";
  if (state.length < 8 || state.length > 512 || /[\u0000-\u001f\u007f]/.test(state)) {
    throw new Error("El parámetro state no es válido.");
  }

  const challenge = params.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || params.get("code_challenge_method") !== "S256") {
    throw new Error("Se requiere PKCE con code_challenge_method=S256.");
  }

  const resource = params.get("resource") ?? options.resource;
  if (resource !== options.resource) throw new Error("El resource no corresponde al servidor MCP.");

  const scope = parseRequestedScopes(params.get("scope"));
  if (scope.some((requested) => !options.client.scopes.includes(requested))) {
    throw new Error("El scope solicitado no está permitido para este cliente.");
  }

  return {
    clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
    scope,
    resource,
  };
}

export async function verifyPkce(verifier: string, challenge: string, method: string): Promise<boolean> {
  if (method !== "S256" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const actual = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (actual.length !== challenge.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ challenge.charCodeAt(index);
  return difference === 0;
}

function base64UrlUtf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createHermesInstallLink(mcpUrl: string) {
  const endpoint = new URL(mcpUrl);
  const isLoopbackHttp = endpoint.protocol === "http:" && (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1");
  if (endpoint.protocol !== "https:" && !isLoopbackHttp) {
    throw new Error("El servidor MCP debe usar HTTPS, salvo cuando se pruebe en loopback.");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("La URL MCP no debe incluir credenciales, query ni fragmento.");
  }

  const config = {
    url: endpoint.toString(),
    auth: "oauth",
    oauth: { cimd: false, scope: MCP_OAUTH_SCOPES.join(" ") },
    protocol: "auto",
    trust: "untrusted",
    sampling: { enabled: false },
  };
  const link = new URL("hermes://mcp/install");
  link.searchParams.set("name", "nex");
  link.searchParams.set("config", base64UrlUtf8(JSON.stringify(config)));
  return link.toString();
}
