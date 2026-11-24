// @vitest-environment node
/// <reference types="vitest/globals" />
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNexMcpServer } from "./lib/mcp-server";
import { Route as UploadRoute } from "./routes/api/content.$id.upload";
import { approvedVideo, bearer, seedContent, seedOAuthAccess, seedSocialAccount, seedUser } from "./test-utils/fixtures";
import { createFakeBucket, createTestDatabase } from "./test-utils/worker-env";

vi.mock("./lib/session", () => ({ readSessionToken: () => null, setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

type Handlers = { POST: (context: { request: Request; params?: Record<string, string> }) => Promise<Response>; PUT?: (context: { request: Request; params: Record<string, string> }) => Promise<Response> };
const handlersOf = (route: unknown) => (route as { options: { server: { handlers: Handlers } } }).options.server.handlers;
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let storage: ReturnType<typeof createFakeBucket>;
let userId: string;

beforeAll(async () => { testDb = await createTestDatabase(); });
afterAll(async () => { await testDb.dispose(); });
beforeEach(async () => {
  storage = createFakeBucket();
  Object.assign(env as object, { nex_db: testDb.db, nex_assets: storage.bucket });
  await testDb.db.prepare("DELETE FROM users").run();
  userId = await seedUser(testDb.db);
  vi.unstubAllGlobals();
});

const RESOURCE = new URL("https://nex.test/api/mcp");

function authInfo(scopes: string[]): AuthInfo {
  return { token: "prueba", clientId: "cliente", scopes, expiresAt: Math.floor(Date.now() / 1000) + 3600, resource: RESOURCE, extra: { userId } };
}

/** Llama a una herramienta del servidor MCP real, con la base D1 de prueba, como lo haría un asistente con OAuth. */
async function callTool(name: string, args: unknown, scopes = ["nex:read", "nex:write", "nex:publish"]) {
  const handler = createMcpHandler((context) => createNexMcpServer(context), { legacy: "stateless", responseMode: "auto" });
  const response = await handler.fetch(new Request(RESOURCE, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), { authInfo: authInfo(scopes) });
  const text = await response.text();
  const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n") || text;
  const message = JSON.parse(data) as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
  const output = message.result?.content?.[0]?.text ?? "";
  return { isError: !!message.result?.isError, text: output, json: () => JSON.parse(output) as unknown };
}

describe("herramientas de publicaciones del servidor MCP", () => {
  async function approvedPiece() {
    return seedContent(testDb.db, userId, approvedVideo());
  }

  it("list_social_accounts devuelve las cuentas de Instagram y de TikTok", async () => {
    await seedSocialAccount(testDb.db, userId, { platform: "Instagram", handle: "@nex.ig" });
    await seedSocialAccount(testDb.db, userId, { platform: "TikTok", handle: "@nex.tt" });
    const result = await callTool("list_social_accounts", {}, ["nex:read"]);
    expect((result.json() as Array<{ platform: string; handle: string }>).map((account) => account.platform + " " + account.handle).sort()).toEqual(["Instagram @nex.ig", "TikTok @nex.tt"]);
  });

  it("schedule_content con account_ids crea una publicación por cuenta y deja la pieza programada", async () => {
    const instagram = await seedSocialAccount(testDb.db, userId, { platform: "Instagram" });
    const tiktok = await seedSocialAccount(testDb.db, userId, { platform: "TikTok", handle: "@tt" });
    const contentId = await approvedPiece();
    const when = inHours(2);

    const result = await callTool("schedule_content", { id: contentId, scheduled_at: when, account_ids: [instagram, tiktok] });
    expect(result.isError).toBe(false);
    expect((result.json() as { publications: Array<{ status: string }> }).publications.map((publication) => publication.status)).toEqual(["programada", "programada"]);
    const content = await testDb.db.prepare("SELECT state, scheduled_at FROM content_items WHERE id = ?").bind(contentId).first();
    expect(content).toEqual({ state: "programada", scheduled_at: when });
  });

  it("programar en cuentas exige nex:publish; con solo nex:write la herramienta lo explica y no crea nada", async () => {
    const instagram = await seedSocialAccount(testDb.db, userId, { platform: "Instagram" });
    const contentId = await approvedPiece();
    const result = await callTool("schedule_content", { id: contentId, scheduled_at: inHours(2), account_ids: [instagram] }, ["nex:read", "nex:write"]);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("nex:publish");
    expect((await testDb.db.prepare("SELECT COUNT(*) AS total FROM publications").first<{ total: number }>())?.total).toBe(0);
  });

  it("no programa en cuentas una pieza que el usuario no aprobó", async () => {
    const instagram = await seedSocialAccount(testDb.db, userId, { platform: "Instagram" });
    const contentId = await seedContent(testDb.db, userId, { ...approvedVideo(), state: "borrador" });
    const result = await callTool("schedule_content", { id: contentId, scheduled_at: inHours(2), account_ids: [instagram] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Aprueba la pieza/);
  });

  it("sin account_ids solo coloca la pieza en el calendario y conserva su aprobación", async () => {
    const contentId = await approvedPiece();
    const when = inHours(5);
    const result = await callTool("schedule_content", { id: contentId, scheduled_at: when }, ["nex:read", "nex:write"]);
    expect(result.isError).toBe(false);
    expect(await testDb.db.prepare("SELECT state, scheduled_at FROM content_items WHERE id = ?").bind(contentId).first()).toEqual({ state: "aprobada", scheduled_at: when });
    const draft = await seedContent(testDb.db, userId, { state: "borrador" });
    await callTool("schedule_content", { id: draft, scheduled_at: when }, ["nex:read", "nex:write"]);
    expect((await testDb.db.prepare("SELECT state FROM content_items WHERE id = ?").bind(draft).first<{ state: string }>())?.state).toBe("programada");
    expect((await testDb.db.prepare("SELECT COUNT(*) AS total FROM publications").first<{ total: number }>())?.total).toBe(0);
  });

  it("list_publications y cancel_publication siguen el ciclo de una publicación", async () => {
    const instagram = await seedSocialAccount(testDb.db, userId, { platform: "Instagram" });
    const contentId = await approvedPiece();
    await callTool("schedule_content", { id: contentId, scheduled_at: inHours(2), account_ids: [instagram] });

    const listed = (await callTool("list_publications", { content_id: contentId }, ["nex:read"])).json() as Array<{ id: string; status: string }>;
    expect(listed).toHaveLength(1);

    const cancelled = await callTool("cancel_publication", { id: listed[0].id });
    expect(cancelled.isError).toBe(false);
    const after = (await callTool("list_publications", { content_id: contentId }, ["nex:read"])).json() as Array<{ status: string }>;
    expect(after.map((publication) => publication.status)).toEqual(["cancelada"]);
    expect(await testDb.db.prepare("SELECT state, scheduled_at FROM content_items WHERE id = ?").bind(contentId).first()).toEqual({ state: "aprobada", scheduled_at: null });
  });

  it("no ve ni cancela las publicaciones de otro usuario", async () => {
    const other = await seedUser(testDb.db, "otra@example.test");
    const otherAccount = await seedSocialAccount(testDb.db, other, { platform: "Instagram" });
    const otherContent = await seedContent(testDb.db, other, approvedVideo());
    await testDb.db.prepare("INSERT INTO publications (id, user_id, content_id, account_id, platform, scheduled_at) VALUES ('p-otro', ?, ?, ?, 'Instagram', ?)").bind(other, otherContent, otherAccount, inHours(1)).run();

    expect((await callTool("list_publications", {}, ["nex:read"])).json()).toEqual([]);
    expect((await callTool("cancel_publication", { id: "p-otro" })).isError).toBe(true);
    expect((await testDb.db.prepare("SELECT status FROM publications WHERE id = 'p-otro'").first<{ status: string }>())?.status).toBe("programada");
  });
});

describe("subida multipart HTTP con un token OAuth", () => {
  const uploadUrl = (contentId: string, query: string) => "https://nex.test/api/content/" + contentId + "/upload?" + query;
  const startBody = JSON.stringify({ filename: "reel.mp4", contentType: "video/mp4", size: 3 });

  it("sube un archivo en varias partes con un token de acceso nex:write", async () => {
    const token = await seedOAuthAccess(testDb.db, userId);
    const contentId = await seedContent(testDb.db, userId);
    const handlers = handlersOf(UploadRoute);
    const bytes = new Uint8Array(8 * 1024 * 1024 + 5).fill(9);

    const start = await handlers.POST({
      request: new Request(uploadUrl(contentId, "action=start"), { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({ filename: "reel.mp4", contentType: "video/mp4", size: bytes.length }) }),
      params: { id: contentId },
    });
    expect(start.status).toBe(200);
    const { uploadId, partSize } = await start.json() as { uploadId: string; partSize: number };

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
    const row = await testDb.db.prepare("SELECT asset_key, asset_name, asset_size FROM content_items WHERE id = ?").bind(contentId).first<{ asset_key: string; asset_name: string; asset_size: number }>();
    expect(row).toMatchObject({ asset_name: "reel.mp4", asset_size: bytes.length });
    expect(storage.objects.get(row!.asset_key)?.bytes.length).toBe(bytes.length);
  });

  it("un token de solo lectura recibe 403 y uno desconocido o ausente, 401", async () => {
    const contentId = await seedContent(testDb.db, userId);
    const start = (headers: Record<string, string>) => handlersOf(UploadRoute).POST({
      request: new Request(uploadUrl(contentId, "action=start"), { method: "POST", headers: { "content-type": "application/json", ...headers }, body: startBody }),
      params: { id: contentId },
    });
    expect((await start(bearer(await seedOAuthAccess(testDb.db, userId, "nex:read")))).status).toBe(403);
    expect((await start(bearer("nex_access_" + "a".repeat(43)))).status).toBe(401);
    expect((await start({})).status).toBe(401);
  });

  it("no deja subir a la pieza de otro usuario", async () => {
    const token = await seedOAuthAccess(testDb.db, userId);
    const otherContent = await seedContent(testDb.db, await seedUser(testDb.db, "otra@example.test"));
    const response = await handlersOf(UploadRoute).POST({
      request: new Request(uploadUrl(otherContent, "action=start"), { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: startBody }),
      params: { id: otherContent },
    });
    expect(response.status).toBe(404);
  });
});
