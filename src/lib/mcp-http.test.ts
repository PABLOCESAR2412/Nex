import { beforeEach, describe, expect, it, vi } from "vitest";
import { addOpenAiToolSecuritySchemes, handleMcpOptionsRequest, handleMcpRequest } from "./mcp-http";

const mocks = vi.hoisted(() => ({ resolveMcpAccessToken: vi.fn() }));

vi.mock("./mcp-oauth", () => ({
  resolveMcpAccessToken: mocks.resolveMcpAccessToken,
}));

function request(headers: Record<string, string> = {}, body: unknown = { jsonrpc: "2.0", id: 1, method: "ping" }) {
  return new Request("https://nex.example/api/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function readRpcResponse(response: Response) {
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return JSON.parse(text) as unknown;
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data) as { result?: unknown; error?: unknown };
      if (message.result !== undefined || message.error !== undefined) return message;
    } catch { /* Ignore non-result events. */ }
  }
  throw new Error("MCP response did not include a JSON-RPC result.");
}

describe("MCP HTTP authorization gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advertises protected-resource metadata when authorization is missing", async () => {
    const response = await handleMcpRequest(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://nex.example/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it("returns an invalid-token challenge for an unrecognized bearer token", async () => {
    const token = `nex_access_${"a".repeat(43)}`;
    mocks.resolveMcpAccessToken.mockResolvedValue(null);

    const response = await handleMcpRequest(request({ authorization: `Bearer ${token}` }));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
    expect(mocks.resolveMcpAccessToken).toHaveBeenCalledWith(token, "https://nex.example");
  });

  it("rejects a cross-origin request before token lookup", async () => {
    const response = await handleMcpRequest(request({ origin: "https://attacker.example" }));

    expect(response.status).toBe(403);
    expect(mocks.resolveMcpAccessToken).not.toHaveBeenCalled();
  });

  it("allows ChatGPT preflight requests and rejects other browser origins", () => {
    const chatgpt = handleMcpOptionsRequest(new Request("https://nex.example/api/mcp", {
      method: "OPTIONS",
      headers: { origin: "https://chatgpt.com" },
    }));
    expect(chatgpt.status).toBe(204);
    expect(chatgpt.headers.get("access-control-allow-origin")).toBe("https://chatgpt.com");

    const attacker = handleMcpOptionsRequest(new Request("https://nex.example/api/mcp", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example" },
    }));
    expect(attacker.status).toBe(403);
  });

  it("declares OAuth scopes per tool for ChatGPT", async () => {
    const response = await addOpenAiToolSecuritySchemes(Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "get_profile" }, { name: "publish_instagram_reel" }, { name: "external_tool" }] },
    }));
    const body = await response.json() as { result: { tools: Array<{ name: string; securitySchemes?: unknown }> } };

    expect(body.result.tools[0]?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["nex:read"] }]);
    expect(body.result.tools[1]?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["nex:publish"] }]);
    expect(body.result.tools[2]?.securitySchemes).toBeUndefined();
  });

  it("serves ChatGPT tools through authenticated MCP with profile and scope metadata", async () => {
    const token = `nex_access_${"a".repeat(43)}`;
    mocks.resolveMcpAccessToken.mockResolvedValue({
      token,
      clientId: "chatgpt-client",
      scopes: ["nex:read", "nex:write", "nex:publish"],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resource: new URL("https://nex.example/api/mcp"),
      resourceMetadataUrl: "https://nex.example/.well-known/oauth-protected-resource/api/mcp",
      extra: { userId: "user-test-id" },
    });

    const response = await handleMcpRequest(request({
      authorization: `Bearer ${token}`,
      origin: "https://chatgpt.com",
    }, { jsonrpc: "2.0", id: 6, method: "tools/list" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://chatgpt.com");
    const body = await readRpcResponse(response) as { result: { tools: Array<{ name: string; securitySchemes?: unknown; _meta?: Record<string, unknown> }> } };
    const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    expect(tools.get("get_profile")).toMatchObject({
      securitySchemes: [{ type: "oauth2", scopes: ["nex:read"] }],
      _meta: { "openai/profile": true },
    });
    expect(tools.get("publish_instagram_reel")?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["nex:publish"] }]);
  });

  it("adds tool security schemes to MCP server-sent events", async () => {
    const response = new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "create_content" }] } })}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
    const decorated = await addOpenAiToolSecuritySchemes(response);
    const body = await decorated.text();

    expect(body).toContain('"securitySchemes":[{"type":"oauth2","scopes":["nex:write"]}]');
    expect(body).toContain("event: message");
  });
});
