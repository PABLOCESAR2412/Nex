import {
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServerOnlyFn } from "@tanstack/react-start";
import { createNexMcpServer } from "./mcp-server";
import { resolveMcpAccessToken } from "./mcp-oauth";

const OPENAI_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);

const TOOL_SCOPES: Record<string, string[]> = {
  get_profile: ["nex:read"],
  list_content: ["nex:read"],
  list_instagram_accounts: ["nex:read"],
  list_social_accounts: ["nex:read"],
  list_publications: ["nex:read"],
  cancel_publication: ["nex:publish"],
  create_content: ["nex:write"],
  start_video_upload: ["nex:write"],
  upload_video_part: ["nex:write"],
  complete_video_upload: ["nex:write"],
  abort_video_upload: ["nex:write"],
  schedule_content: ["nex:write"],
  publish_instagram_reel: ["nex:publish"],
  check_instagram_publish: ["nex:publish"],
};

function withNoStore(response: Response, corsOrigin?: string) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  if (corsOrigin) {
    headers.set("access-control-allow-origin", corsOrigin);
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("access-control-allow-headers", "accept, authorization, content-type, mcp-method, mcp-name, mcp-protocol-version, mcp-session-id");
    headers.set("access-control-expose-headers", "www-authenticate, mcp-protocol-version, mcp-session-id");
    headers.set("vary", "Origin");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isAllowedOrigin(value: string, serverOrigin: string) {
  return value === serverOrigin || OPENAI_ORIGINS.has(value);
}

export async function addOpenAiToolSecuritySchemes(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) return response;

  const decorateMessage = (body: unknown): { body: unknown; changed: boolean } => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return { body, changed: false };
    const message = body as { result?: { tools?: unknown } };
    if (!message.result || !Array.isArray(message.result.tools)) return { body, changed: false };
    const tools = message.result.tools.map((tool) => {
      if (!tool || typeof tool !== "object" || Array.isArray(tool)) return tool;
      const value = tool as { name?: unknown };
      if (typeof value.name !== "string" || !TOOL_SCOPES[value.name]) return tool;
      return { ...value, securitySchemes: [{ type: "oauth2", scopes: TOOL_SCOPES[value.name] }] };
    });
    return { body: { ...message, result: { ...message.result, tools } }, changed: true };
  };

  let responseBody: string;
  if (contentType.includes("application/json")) {
    const body = await response.clone().json().catch(() => null) as unknown;
    const decorated = decorateMessage(body);
    if (!decorated.changed) return response;
    responseBody = JSON.stringify(decorated.body);
  } else {
    const source = await response.clone().text();
    let changed = false;
    responseBody = source.split(/\r?\n\r?\n/).map((frame) => {
      const lines = frame.split(/\r?\n/);
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      if (!dataLines.length) return frame;
      const parsed = dataLines.map((line) => line.slice(5).trimStart()).join("\n");
      let body: unknown;
      try { body = JSON.parse(parsed) as unknown; } catch { return frame; }
      const decorated = decorateMessage(body);
      if (!decorated.changed) return frame;
      changed = true;
      const remaining = lines.filter((line) => !line.startsWith("data:"));
      remaining.push(`data: ${JSON.stringify(decorated.body)}`);
      return remaining.join("\n");
    }).join("\n\n");
    if (!changed) return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleMcpOptionsRequest(request: Request) {
  const requestOrigin = request.headers.get("origin");
  const serverOrigin = new URL(request.url).origin;
  if (requestOrigin && !isAllowedOrigin(requestOrigin, serverOrigin)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  return withNoStore(new Response(null, { status: 204 }), requestOrigin ?? undefined);
}

export const handleMcpRequest = createServerOnlyFn(async (request: Request) => {
  const originHeader = request.headers.get("origin");
  const origin = new URL(request.url).origin;
  if (originHeader && !isAllowedOrigin(originHeader, origin)) {
    return Response.json({ error: "Origin not allowed." }, {
      status: 403,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }

  const resource = new URL("/api/mcp", origin);
  const resourceMetadataUrl = new URL("/.well-known/oauth-protected-resource/api/mcp", origin).toString();
  const authenticate = requireBearerAuth({
    verifier: {
      async verifyAccessToken(token) {
        const authInfo = await resolveMcpAccessToken(token, origin);
        if (!authInfo) throw new OAuthError(OAuthErrorCode.InvalidToken, "El token de acceso no es válido o expiró.");
        return authInfo;
      },
    },
    expectedResource: resource,
    resourceMetadataUrl,
  });
  const authInfo = await authenticate(request);
  if (authInfo instanceof Response) return withNoStore(authInfo, originHeader ?? undefined);

  const handler = createMcpHandler((context) => createNexMcpServer(context), {
    legacy: "stateless",
    responseMode: "auto",
  });
  const response = await handler.fetch(request, { authInfo });
  return withNoStore(await addOpenAiToolSecuritySchemes(response), originHeader ?? undefined);
});
