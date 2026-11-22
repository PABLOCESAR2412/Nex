// @vitest-environment node
/// <reference types="vitest/globals" />
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as McpRoute } from "./routes/api/mcp";
import { Route as UploadRoute } from "./routes/api/content.$id.upload";
import { bearer, seedContent, seedMcpToken, seedUser } from "./test-utils/fixtures";
import { createFakeBucket, createTestDatabase, FixedLengthStreamPolyfill } from "./test-utils/worker-env";

vi.mock("./lib/session", () => ({ readSessionToken: () => null, setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

type Handlers = { POST: (context: { request: Request; params?: Record<string, string> }) => Promise<Response>; PUT?: (context: { request: Request; params: Record<string, string> }) => Promise<Response> };
const handlersOf = (route: unknown) => (route as { options: { server: { handlers: Handlers } } }).options.server.handlers;

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let storage: ReturnType<typeof createFakeBucket>;
let userId: string;
let token: string;

beforeAll(async () => { testDb = await createTestDatabase(); });
afterAll(async () => { await testDb.dispose(); });
beforeEach(async () => {
  storage = createFakeBucket();
  Object.assign(env as object, { nex_db: testDb.db, nex_assets: storage.bucket });
  await testDb.db.prepare("DELETE FROM users").run();
  userId = await seedUser(testDb.db);
  token = await seedMcpToken(testDb.db, userId);
  vi.unstubAllGlobals();
});

function uploadUrl(contentId: string, query: string) {
  return "https://nex.test/api/content/" + contentId + "/upload?" + query;
}

describe("subida multipart con clave MCP", () => {
  it("sube un archivo en varias partes con la clave Bearer", async () => {
    const contentId = await seedContent(testDb.db, userId);
    const handlers = handlersOf(UploadRoute);
    const bytes = new Uint8Array(8 * 1024 * 1024 + 5).fill(9);

    const start = await handlers.POST({
      request: new Request(uploadUrl(contentId, "action=start"), { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({ filename: "reel.mp4", contentType: "video/mp4", size: bytes.length }) }),
      params: { id: contentId },
    });
    expect(start.status).toBe(200);
    const { uploadId, partSize } = await start.json() as { uploadId: string; partSize: number };
    expect(partSize).toBe(8 * 1024 * 1024);

    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (let partNumber = 1; partNumber <= 2; partNumber++) {
      const chunk = bytes.slice((partNumber - 1) * partSize, Math.min(partNumber * partSize, bytes.length));
      const response = await handlers.PUT!({
        request: new Request(uploadUrl(contentId, `action=part&uploadId=${uploadId}&partNumber=${partNumber}`), { method: "PUT", headers: { ...bearer(token), "content-length": String(chunk.length) }, body: chunk }),
        params: { id: contentId },
      });
      expect(response.status).toBe(200);
      parts.push(await response.json() as { partNumber: number; etag: string });
    }

    const complete = await handlers.POST({
      request: new Request(uploadUrl(contentId, "action=complete"), { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({ uploadId, parts }) }),
      params: { id: contentId },
    });
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({ ok: true, name: "reel.mp4", size: bytes.length });

    const row = await testDb.db.prepare("SELECT asset_key, asset_name, asset_content_type, asset_size FROM content_items WHERE id = ?").bind(contentId).first<{ asset_key: string; asset_name: string; asset_content_type: string; asset_size: number }>();
    expect(row).toMatchObject({ asset_name: "reel.mp4", asset_content_type: "video/mp4", asset_size: bytes.length });
    expect(storage.objects.get(row!.asset_key)?.bytes.length).toBe(bytes.length);
  });

  it("rechaza peticiones sin credenciales o con una clave desconocida", async () => {
    const contentId = await seedContent(testDb.db, userId);
    const handlers = handlersOf(UploadRoute);
    const body = JSON.stringify({ filename: "a.mp4", contentType: "video/mp4", size: 3 });
    const anonymous = await handlers.POST({ request: new Request(uploadUrl(contentId, "action=start"), { method: "POST", body }), params: { id: contentId } });
    expect(anonymous.status).toBe(401);
    const unknown = await handlers.POST({ request: new Request(uploadUrl(contentId, "action=start"), { method: "POST", headers: bearer("nex_live_" + "a".repeat(43)), body }), params: { id: contentId } });
    expect(unknown.status).toBe(401);
  });

  it("no deja subir a la pieza de otro usuario", async () => {
    const otherUser = await seedUser(testDb.db, "otra@example.test");
    const otherContent = await seedContent(testDb.db, otherUser);
    const response = await handlersOf(UploadRoute).POST({
      request: new Request(uploadUrl(otherContent, "action=start"), { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({ filename: "a.mp4", contentType: "video/mp4", size: 3 }) }),
      params: { id: otherContent },
    });
    expect(response.status).toBe(404);
  });
});

async function rpc(method: string, params?: unknown, key = token) {
  const response = await handlersOf(McpRoute).POST({
    request: new Request("https://nex.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...bearer(key) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
  });
  return { status: response.status, body: await response.json() as { result?: { instructions?: string; isError?: boolean; content?: Array<{ text: string }> }; error?: { message: string } } };
}

describe("upload_content_from_url", () => {
  const videoUrl = "https://videos.example.com/reel.mp4";
  const callUpload = (contentId: string) => rpc("tools/call", { name: "upload_content_from_url", arguments: { content_id: contentId, video_url: videoUrl, filename: "reel.mp4" } });

  it("guarda el video con longitud fija y actualiza la pieza", async () => {
    vi.stubGlobal("FixedLengthStream", FixedLengthStreamPolyfill);
    const bytes = new Uint8Array(2048).fill(3);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": String(bytes.length) } })));
    const contentId = await seedContent(testDb.db, userId);
    const { body } = await callUpload(contentId);
    expect(body.result?.isError).toBeUndefined();
    expect(JSON.parse(body.result!.content![0].text)).toMatchObject({ ok: true, size: 2048, content_type: "video/mp4" });
    const row = await testDb.db.prepare("SELECT asset_key, asset_size FROM content_items WHERE id = ?").bind(contentId).first<{ asset_key: string; asset_size: number }>();
    expect(row?.asset_size).toBe(2048);
    expect(storage.objects.get(row!.asset_key)?.bytes.length).toBe(2048);
  });

  it("explica qué hacer si el host no envía Content-Length", async () => {
    vi.stubGlobal("FixedLengthStream", FixedLengthStreamPolyfill);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10)); controller.close(); } }), { headers: { "content-type": "video/mp4" } })));
    const contentId = await seedContent(testDb.db, userId);
    const { body } = await callUpload(contentId);
    expect(body.error?.message).toMatch(/Content-Length/);
    expect(storage.objects.size).toBe(0);
  });

  it("rechaza respuestas comprimidas porque la longitud anunciada no sería la real", async () => {
    vi.stubGlobal("FixedLengthStream", FixedLengthStreamPolyfill);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(10), { headers: { "content-type": "video/mp4", "content-length": "10", "content-encoding": "gzip" } })));
    const contentId = await seedContent(testDb.db, userId);
    const { body } = await callUpload(contentId);
    expect(body.error?.message).toMatch(/compress/i);
  });

  it("no deja rastro en R2 si el host envía menos bytes de los anunciados", async () => {
    vi.stubGlobal("FixedLengthStream", FixedLengthStreamPolyfill);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(5), { headers: { "content-type": "video/mp4", "content-length": "10" } })));
    const contentId = await seedContent(testDb.db, userId);
    const { body } = await callUpload(contentId);
    expect(body.result?.isError).toBe(true);
    expect(storage.objects.size).toBe(0);
    const row = await testDb.db.prepare("SELECT asset_key FROM content_items WHERE id = ?").bind(contentId).first<{ asset_key: string | null }>();
    expect(row?.asset_key).toBeNull();
  });
});

describe("instrucciones del servidor MCP", () => {
  it("indican cómo subir un archivo local", async () => {
    const { body } = await rpc("initialize", {});
    expect(body.result?.instructions).toContain("https://nex.test/nex-upload.mjs");
  });

  it("explican que en TikTok el video llega como borrador y que los permisos vienen por clave", async () => {
    const { body } = await rpc("initialize", {});
    expect(body.result?.instructions).toMatch(/TikTok.*borrador/s);
    expect(body.result?.instructions).toContain("permiso");
  });
});

describe("scripts de subida para harness locales (public/nex-upload.mjs)", () => {
  let server: Server;
  let baseUrl: string;
  const dir = mkdtempSync(path.join(tmpdir(), "nex-script-"));

  beforeAll(async () => {
    const handlers = handlersOf(UploadRoute);
    server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const url = "http://localhost" + incoming.url;
      const params = { id: /\/api\/content\/([^/]+)\/upload/.exec(incoming.url ?? "")?.[1] ?? "" };
      const headers = new Headers(incoming.headers as Record<string, string>);
      headers.set("content-length", String(body.length));
      const request = new Request(url, { method: incoming.method, headers, body: body.length ? body : undefined });
      const response = incoming.method === "PUT" ? await handlers.PUT!({ request, params }) : await handlers.POST({ request, params });
      outgoing.writeHead(response.status, { "content-type": "application/json" });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("sube un archivo local de varias partes y deja la pieza lista", async () => {
    const contentId = await seedContent(testDb.db, userId);
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, Buffer.alloc(8 * 1024 * 1024 + 123, 1));
    const { stdout } = await promisify(execFile)("node", ["public/nex-upload.mjs", contentId, file], { env: { ...process.env, NEX_URL: baseUrl, NEX_TOKEN: token } });
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, content_id: contentId, name: "clip.mp4", size: 8 * 1024 * 1024 + 123 });
    const row = await testDb.db.prepare("SELECT asset_name, asset_size FROM content_items WHERE id = ?").bind(contentId).first();
    expect(row).toMatchObject({ asset_name: "clip.mp4", asset_size: 8 * 1024 * 1024 + 123 });
  });

  it("falla con un mensaje claro si la clave no es válida", async () => {
    const contentId = await seedContent(testDb.db, userId);
    const file = path.join(dir, "bad.mp4");
    writeFileSync(file, Buffer.alloc(10, 1));
    const result = await promisify(execFile)("node", ["public/nex-upload.mjs", contentId, file], { env: { ...process.env, NEX_URL: baseUrl, NEX_TOKEN: "nex_live_" + "z".repeat(43) } }).catch((error) => error as { stderr: string; code: number });
    expect((result as { code: number }).code).toBe(1);
    expect((result as { stderr: string }).stderr).toMatch(/"ok":false/);
  });
});
