import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNexMcpServer } from "./mcp-server";

const db = vi.hoisted(() => ({
  all: vi.fn().mockResolvedValue({ results: [] }),
  first: vi.fn().mockResolvedValue(null),
  run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]),
}));

const assets = vi.hoisted(() => ({
  createMultipartUpload: vi.fn(),
  resumeMultipartUpload: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./db", () => ({
  getDb: () => ({
    prepare: () => ({ bind: () => ({ all: db.all, first: db.first, run: db.run }) }),
    batch: db.batch,
  }),
  getAssets: () => assets,
  newId: () => "test-upload-row-id",
}));

vi.mock("../routes/api.social.instagram.publish", () => ({
  handleInstagramPublishRequest: vi.fn(),
}));

const RESOURCE = new URL("https://nex.example/api/mcp");
const SCOPES = ["nex:read", "nex:write", "nex:publish"];

function auth(scopes: string[]): AuthInfo {
  return {
    token: "synthetic-test-token",
    clientId: "nex-test-client",
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    resource: RESOURCE,
    resourceMetadataUrl: "https://nex.example/.well-known/oauth-protected-resource/api/mcp",
    extra: { userId: "user-test-id" },
  };
}

function request(body: unknown) {
  return new Request(RESOURCE, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function readMcpResponse(response: Response) {
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return JSON.parse(text) as unknown;
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data) as { result?: unknown; error?: unknown };
      if (message.result !== undefined || message.error !== undefined) return message;
    } catch { /* Ignore event frames that are not JSON-RPC responses. */ }
  }
  throw new Error("MCP response did not include a JSON-RPC result.");
}

async function callTool(name: string, args: unknown, id: number) {
  const handler = createMcpHandler((context) => createNexMcpServer(context), { legacy: "stateless", responseMode: "auto" });
  const response = await handler.fetch(request({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  }), { authInfo: auth(SCOPES) });
  const body = await readMcpResponse(response) as { result?: { content?: Array<{ text?: string }> } };
  const text = body.result?.content?.[0]?.text;
  if (!text) throw new Error(`MCP tool ${name} returned no text result.`);
  return JSON.parse(text) as Record<string, unknown>;
}

describe("Nex MCP server", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("serves MCP tools through the official stateless HTTP handler", async () => {
    const handler = createMcpHandler((context) => createNexMcpServer(context), { legacy: "stateless", responseMode: "auto" });
    const response = await handler.fetch(request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "Nex MCP test", version: "1.0.0" },
      },
    }), { authInfo: auth(SCOPES) });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("2025-11-25");
  });

  it("refuses a write tool when OAuth grants only nex:read", async () => {
    const handler = createMcpHandler((context) => createNexMcpServer(context), { legacy: "stateless", responseMode: "auto" });
    const response = await handler.fetch(request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "create_content", arguments: { title: "No autorizado" } },
    }), { authInfo: auth(["nex:read"]) });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect(db.run).not.toHaveBeenCalled();
  });

  it("returns the stable identity for the authenticated Nex profile", async () => {
    db.first.mockResolvedValue({ id: "opaque-user-id", name: "Pablo", email: "pablo@example.com" });
    const profile = await callTool("get_profile", {}, 3);

    expect(profile).toEqual({ id: "opaque-user-id", name: "Pablo", email: "pablo@example.com" });
  });

  it("shows chunked video upload tools and does not offer arbitrary URL downloads", async () => {
    const handler = createMcpHandler((context) => createNexMcpServer(context), { legacy: "stateless", responseMode: "auto" });
    const response = await handler.fetch(request({ jsonrpc: "2.0", id: 4, method: "tools/list" }), { authInfo: auth(SCOPES) });
    const body = await readMcpResponse(response) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((tool) => tool.name);

    expect(names).toContain("start_video_upload");
    expect(names).toContain("upload_video_part");
    expect(names).toContain("complete_video_upload");
    expect(names).not.toContain("upload_content_from_url");
  });

  it("uploads a video through an owner-bound R2 multipart session", async () => {
    const pending = {
      id: "upload-row-id",
      content_id: "content-test-id",
      asset_key: "users/user-test-id/content/content-test-id/video-object",
      upload_id: "multipart-test",
      filename: "reel.mp4",
      content_type: "video/mp4",
      file_size: 1,
    };
    db.first
      .mockResolvedValueOnce({ id: "content-test-id" })
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ asset_key: null });
    assets.createMultipartUpload.mockResolvedValue({ uploadId: "multipart-test", abort: vi.fn() });
    assets.resumeMultipartUpload.mockReturnValue({
      uploadPart: vi.fn().mockResolvedValue({ partNumber: 1, etag: "etag-1" }),
      complete: vi.fn().mockResolvedValue({ size: 1 }),
      abort: vi.fn().mockResolvedValue(undefined),
    });

    const started = await callTool("start_video_upload", {
      content_id: "content-test-id",
      filename: "reel.mp4",
      content_type: "video/mp4",
      file_size: 1,
    }, 5);
    expect(started).toMatchObject({ upload_id: "multipart-test", part_size: 8 * 1024 * 1024, part_count: 1 });

    const part = await callTool("upload_video_part", {
      content_id: "content-test-id",
      upload_id: "multipart-test",
      part_number: 1,
      data_base64: "eA==",
    }, 6);
    expect(part).toEqual({ part_number: 1, etag: "etag-1" });

    const completed = await callTool("complete_video_upload", {
      content_id: "content-test-id",
      upload_id: "multipart-test",
      parts: [{ part_number: 1, etag: "etag-1" }],
    }, 7);
    expect(completed).toMatchObject({ ok: true, content_id: "content-test-id", filename: "reel.mp4", file_size: 1 });
    expect(assets.resumeMultipartUpload).toHaveBeenCalledTimes(2);
    expect(db.batch).toHaveBeenCalledTimes(1);
  });
});
