// @vitest-environment node
/// <reference types="vitest/globals" />
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptInstagramToken } from "./lib/instagram";
import { schedulePublications } from "./lib/publications";
import { Route as InstagramDisconnectRoute } from "./routes/api.social.instagram.disconnect";
import { Route as UploadRoute } from "./routes/api/content.$id.upload";
import { approvedVideo, bearer, seedContent, seedOAuthAccess, seedSocialAccount, seedUser } from "./test-utils/fixtures";
import { createFakeBucket, createTestDatabase } from "./test-utils/worker-env";

const session = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("./lib/session", () => ({ readSessionToken: () => session.token, setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

type Handler = (context: { request: Request; params?: Record<string, string> }) => Promise<Response>;
const handlersOf = (route: unknown) => (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers;
const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let userId: string;

beforeAll(async () => { testDb = await createTestDatabase(); });
afterAll(async () => { await testDb.dispose(); });
beforeEach(async () => {
  Object.assign(env as object, { nex_db: testDb.db, nex_assets: createFakeBucket().bucket, TOKEN_ENCRYPTION_KEY: "k".repeat(32) });
  await testDb.db.prepare("DELETE FROM users").run();
  userId = await seedUser(testDb.db);
  await testDb.db.prepare("INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES ('sess-review', ?, ?)").bind(userId, inOneHour()).run();
  session.token = "sess-review";
  vi.unstubAllGlobals();
});

describe("desconectar Instagram", () => {
  it("cierra las publicaciones abiertas de esa cuenta y deja la pieza sin fecha pendiente", async () => {
    const { ciphertext, iv } = await encryptInstagramToken("ig-token");
    const account = await seedSocialAccount(testDb.db, userId, { platform: "Instagram", externalId: "17841", ciphertext, iv });
    const contentId = await seedContent(testDb.db, userId, approvedVideo());
    await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });

    const response = await handlersOf(InstagramDisconnectRoute).POST({
      request: new Request("https://nex.test/api/social/instagram/disconnect", { method: "POST", body: JSON.stringify({ accountId: account }) }),
    });
    expect(response.status).toBe(200);

    const publication = await testDb.db.prepare("SELECT status, error FROM publications WHERE content_id = ?").bind(contentId).first<{ status: string; error: string | null }>();
    expect(publication).toMatchObject({ status: "fallida", error: expect.stringMatching(/desconectada/) });
    const content = await testDb.db.prepare("SELECT state, scheduled_at FROM content_items WHERE id = ?").bind(contentId).first();
    expect(content).toEqual({ state: "aprobada", scheduled_at: null });
    const row = await testDb.db.prepare("SELECT status, token_ciphertext FROM social_accounts WHERE id = ?").bind(account).first();
    expect(row).toEqual({ status: "desconectada", token_ciphertext: null });
  });
});

describe("quién hace una petición con Authorization y cookie a la vez", () => {
  const start = (contentId: string, headers: Record<string, string>) => handlersOf(UploadRoute).POST({
    request: new Request("https://nex.test/api/content/" + contentId + "/upload?action=start", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ filename: "reel.mp4", contentType: "video/mp4", size: 1024 }),
    }),
    params: { id: contentId },
  });

  it("un token de solo lectura no gana permisos por el hecho de que el navegador envíe la cookie", async () => {
    const contentId = await seedContent(testDb.db, userId);
    const readOnly = await seedOAuthAccess(testDb.db, userId, "nex:read");
    expect((await start(contentId, bearer(readOnly))).status).toBe(403);
  });

  it("sin Authorization sigue valiendo la sesión web", async () => {
    const contentId = await seedContent(testDb.db, userId);
    expect((await start(contentId, {})).status).toBe(200);
  });

  it("un token inválido no se rescata con la cookie de sesión", async () => {
    const contentId = await seedContent(testDb.db, userId);
    expect((await start(contentId, bearer("nex_access_" + "a".repeat(43)))).status).toBe(401);
  });
});
