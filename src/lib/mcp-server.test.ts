import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNexMcpServer, putMcpVideoPart } from "./mcp-server";
import { handleMcpRequest } from "./mcp-http";
import { sha256Hex } from "./instagram";

const db = vi.hoisted(() => ({
  all: vi.fn().mockResolvedValue({ results: [] }),
  first: vi.fn().mockResolvedValue(null),
  run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]),
  bind: vi.fn(),
}));

const assets = vi.hoisted(() => ({
  createMultipartUpload: vi.fn(),
  resumeMultipartUpload: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
}));

const providers = vi.hoisted(() => ({
  instagram: vi.fn(),
  tiktok: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: () => ({
    prepare: () => ({ bind: db.bind }),
    batch: db.batch,
  }),
  getAssets: () => assets,
  newId: () => "test-upload-row-id",
}));

vi.mock("../routes/api.social.instagram.publish", () => ({
  handleInstagramPublishRequest: providers.instagram,
}));

vi.mock("./tiktok-workflow", () => ({
  handleTikTokUploadRequest: providers.tiktok,
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

async function toolResponse(name: string, args: unknown, id: number, scopes = SCOPES) {
  const handler = createMcpHandler((context) => createNexMcpServer(context), { legacy: "stateless", responseMode: "auto" });
  return handler.fetch(request({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  }), { authInfo: auth(scopes) });
}

async function callTool(name: string, args: unknown, id: number) {
  const response = await toolResponse(name, args, id);
  const body = await readMcpResponse(response) as { result?: { content?: Array<{ text?: string }> } };
  const text = body.result?.content?.[0]?.text;
  if (!text) throw new Error(`MCP tool ${name} returned no text result.`);
  return JSON.parse(text) as Record<string, unknown>;
}

describe("Nex MCP server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.bind.mockReturnValue({ all: db.all, first: db.first, run: db.run });
    db.first.mockReset().mockResolvedValue(null);
  });
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
    expect(names).toContain("list_social_accounts");
    expect(names).toContain("approve_video_content");
    expect(names).toContain("publish_social_video");
    expect(names).toContain("check_social_publish");
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
      .mockResolvedValueOnce({ asset_key: null, can_replace: 1 });
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

  it("creates a captioned draft, attaches binary video, and sends it to the selected accounts", async () => {
    const contentId = "test-upload-row-id";
    const draft = { id: contentId, title: "Un pulpo curioso", description: "Tres datos. #Pulpo" };
    const pending = {
      id: "hashed-upload-token",
      content_id: contentId,
      asset_key: "users/user-test-id/content/test-upload-row-id/video-object",
      upload_id: "multipart-test",
      filename: "pulpo.mp4",
      content_type: "video/mp4",
      file_size: 1,
    };
    db.first
      .mockResolvedValueOnce({ id: contentId })
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ asset_key: null, can_replace: 1 })
      .mockResolvedValueOnce({ ...draft, state: "aprobada" });
    assets.createMultipartUpload.mockResolvedValue({ uploadId: pending.upload_id, abort: vi.fn() });
    const uploadPart = vi.fn().mockResolvedValue({ partNumber: 1, etag: "etag-1" });
    assets.resumeMultipartUpload.mockReturnValue({
      uploadPart,
      complete: vi.fn().mockResolvedValue({ size: 1 }),
    });
    db.all.mockResolvedValueOnce({
      results: [
        { id: "ig-first", platform: "instagram", handle: "@ig1" },
        { id: "ig-second", platform: "instagram", handle: "@ig2" },
        { id: "tt-first", platform: "tiktok", handle: "@tiktok1" },
      ],
    });
    providers.instagram.mockImplementation(async (request: Request) => {
      const { action } = await request.clone().json() as { action: string };
      return Response.json({ jobId: "ig-job", status: action === "start" ? "processing" : "published" });
    });
    providers.tiktok.mockImplementation(async (request: Request) => {
      const { action } = await request.clone().json() as { action: string };
      return Response.json({ jobId: "tt-job", status: action === "start" ? "processing" : "awaiting_user", caption: draft.description });
    });

    const created = await callTool("create_content", { title: draft.title, description: draft.description }, 8);
    expect(created).toMatchObject({ ...draft, state: "borrador" });
    expect(db.bind).toHaveBeenCalledWith(contentId, "user-test-id", draft.title, draft.description, null, "video", null);
    const started = await callTool("start_video_upload", {
      content_id: contentId,
      filename: pending.filename,
      content_type: pending.content_type,
      file_size: pending.file_size,
    }, 9);
    expect(started).toMatchObject({ upload_id: pending.upload_id, upload_url: RESOURCE.href, upload_token: expect.stringMatching(/^nex_upload_/u) });
    expect(db.bind).toHaveBeenCalledWith(await sha256Hex(String(started.upload_token)), contentId, "user-test-id", expect.any(String), pending.upload_id, pending.filename, pending.content_type, pending.file_size);

    const uploadUrl = new URL(String(started.upload_url));
    uploadUrl.searchParams.set("part_number", "1");
    const binaryPart = await handleMcpRequest(new Request(uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${started.upload_token}`, "content-length": "1" },
      body: new Uint8Array([7]),
    }));
    expect(binaryPart.status).toBe(200);
    expect(binaryPart.headers.get("cache-control")).toBe("no-store");
    expect(await binaryPart.json()).toEqual({ part_number: 1, etag: "etag-1" });
    expect(uploadPart).toHaveBeenCalledWith(1, expect.any(ReadableStream));

    expect(await callTool("complete_video_upload", {
      content_id: contentId,
      upload_id: pending.upload_id,
      parts: [{ part_number: 1, etag: "etag-1" }],
    }, 10)).toMatchObject({ ok: true, content_id: contentId });
    expect(await callTool("approve_video_content", { content_id: contentId, confirm_approve: true }, 11))
      .toEqual({ ...draft, state: "aprobada" });
    expect(await callTool("list_social_accounts", {}, 12)).toEqual([
      { id: "ig-first", platform: "instagram", handle: "@ig1" },
      { id: "ig-second", platform: "instagram", handle: "@ig2" },
      { id: "tt-first", platform: "tiktok", handle: "@tiktok1" },
    ]);

    for (const [platform, accountId, jobId, status, handler] of [
      ["instagram", "ig-second", "ig-job", "published", providers.instagram],
      ["tiktok", "tt-first", "tt-job", "awaiting_user", providers.tiktok],
    ] as const) {
      expect(await callTool("publish_social_video", {
        platform,
        content_id: contentId,
        account_id: accountId,
        confirm_publish: true,
      }, 13)).toMatchObject({ platform, jobId, status: "processing" });
      const [request, user] = handler.mock.calls[0] ?? [];
      expect(user).toBe("user-test-id");
      expect(await request.clone().json()).toEqual({ action: "start", contentId, accountId });
      expect(await callTool("check_social_publish", { platform, job_id: jobId }, 14)).toMatchObject({ platform, jobId, status });
    }
  });

  it("requires publish scope and explicit confirmation before invoking any social provider", async () => {
    const input = { platform: "tiktok", content_id: "video", account_id: "account", confirm_publish: true };
    const forbidden = await toolResponse("publish_social_video", input, 15, ["nex:write"]);
    expect(forbidden.status).toBe(403);
    const unconfirmed = await toolResponse("publish_social_video", { ...input, confirm_publish: false }, 16);
    expect(await readMcpResponse(unconfirmed)).toMatchObject({ result: { isError: true } });
    expect(providers.instagram).not.toHaveBeenCalled();
    expect(providers.tiktok).not.toHaveBeenCalled();
  });

  it("requires a valid binary upload token tied to an active upload", async () => {
    const createRequest = (token: string) => new Request("https://nex.example/api/mcp?part_number=1", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-length": "1" },
      body: new Uint8Array([7]),
    });
    expect((await putMcpVideoPart(createRequest("nex_access_unauthorized"))).status).toBe(401);
    expect(db.first).not.toHaveBeenCalled();
    expect((await putMcpVideoPart(createRequest(`nex_upload_${"a".repeat(43)}`))).status).toBe(401);
    expect(assets.resumeMultipartUpload).not.toHaveBeenCalled();
  });

  it("returns the reason a provider could not start and preserves reviewable final states", async () => {
    providers.instagram
      .mockResolvedValueOnce(Response.json({ error: "La autorización de Instagram venció." }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ jobId: "ig-job", status: "needs_review", error: "Revisa Instagram." }, { status: 502 }));
    const response = await toolResponse("publish_social_video", {
      platform: "instagram",
      content_id: "video",
      account_id: "account",
      confirm_publish: true,
    }, 17);
    expect(await readMcpResponse(response)).toMatchObject({
      result: { isError: true, content: [{ type: "text", text: "La autorización de Instagram venció." }] },
    });
    expect(await callTool("check_social_publish", { platform: "instagram", job_id: "ig-job" }, 18))
      .toMatchObject({ status: "needs_review", error: "Revisa Instagram." });
  });
});
