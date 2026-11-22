// @vitest-environment node
/// <reference types="vitest/globals" />
import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runPublicationCycle, schedulePublications } from "./lib/publications";
import { getTikTokAccessToken, tiktokTuning } from "./lib/tiktok";
import { decryptToken, encryptToken } from "./lib/token-crypto";
import { Route as ConnectRoute } from "./routes/api.social.tiktok.connect";
import { Route as CallbackRoute } from "./routes/api.social.tiktok.callback";
import { Route as DisconnectRoute } from "./routes/api.social.tiktok.disconnect";
import { approvedVideo, seedContent, seedSocialAccount, seedUser } from "./test-utils/fixtures";
import { createFakeBucket, createTestDatabase, FixedLengthStreamPolyfill } from "./test-utils/worker-env";

const session = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("./lib/session", () => ({ readSessionToken: () => session.token, setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

const MB = 1024 * 1024;
const defaultTuning = { ...tiktokTuning };
const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();
const makeDue = () => testDb.db.prepare("UPDATE publications SET scheduled_at = '2000-01-01T00:00:00.000Z' WHERE status = 'programada'").run();

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let userId: string;
let fakeBucket: ReturnType<typeof createFakeBucket>;

type Handler = (context: { request: Request }) => Promise<Response>;
const handlersOf = (route: unknown) => (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers;
const get = (route: unknown, url: string) => handlersOf(route).GET({ request: new Request(url) });

beforeAll(async () => { testDb = await createTestDatabase(); });
afterAll(async () => { await testDb.dispose(); });
beforeEach(async () => {
  fakeBucket = createFakeBucket();
  Object.assign(env as object, {
    nex_db: testDb.db,
    nex_assets: fakeBucket.bucket,
    TIKTOK_CLIENT_KEY: "client-key",
    TIKTOK_CLIENT_SECRET: "client-secret",
    TOKEN_ENCRYPTION_KEY: "k".repeat(32),
    INSTAGRAM_TOKEN_ENCRYPTION_KEY: undefined,
    PUBLIC_APP_URL: "https://nex.test",
  });
  await testDb.db.prepare("DELETE FROM users").run();
  userId = await seedUser(testDb.db);
  session.token = null;
  vi.stubGlobal("FixedLengthStream", FixedLengthStreamPolyfill);
});
afterEach(() => {
  Object.assign(tiktokTuning, defaultTuning);
  vi.unstubAllGlobals();
});

type Call = { url: string; method: string; headers: Headers; text?: string; bytes?: Uint8Array };

/** Simula la API de TikTok: OAuth, perfil, init de la bandeja, subida por trozos, estado y revocación. */
function mockTikTok() {
  const calls: Call[] = [];
  const state = {
    status: "SEND_TO_USER_INBOX",
    failReason: undefined as string | undefined,
    scope: "user.info.basic,video.upload",
    initResponse: undefined as { status: number; body: unknown } | undefined,
    statusResponse: undefined as { status: number; body: unknown } | undefined,
    putStatus: undefined as number | undefined,
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const call: Call = { url, method, headers: new Headers(init?.headers) };
    const body = init?.body;
    if (body instanceof ReadableStream) call.bytes = new Uint8Array(await new Response(body).arrayBuffer());
    else if (body !== undefined && body !== null) call.text = String(body);
    calls.push(call);

    if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
      const form = new URLSearchParams(call.text);
      if (form.get("grant_type") === "refresh_token") {
        return Response.json({ access_token: "act.refreshed", expires_in: 86400, refresh_token: "rft.rotated", refresh_expires_in: 31536000, scope: state.scope, token_type: "Bearer" });
      }
      return Response.json({ access_token: "act.first", expires_in: 86400, open_id: "open-1", refresh_token: "rft.first", refresh_expires_in: 31536000, scope: state.scope, token_type: "Bearer" });
    }
    if (url.startsWith("https://open.tiktokapis.com/v2/user/info/")) {
      return Response.json({ data: { user: { open_id: "open-1", display_name: "Pablo TikTok" } }, error: { code: "ok", message: "" } });
    }
    if (url === "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/") {
      const response = state.initResponse ?? { status: 200, body: { data: { publish_id: "v_pub_1", upload_url: "https://upload.tiktok.test/u1" }, error: { code: "ok", message: "" } } };
      return Response.json(response.body, { status: response.status });
    }
    if (url === "https://upload.tiktok.test/u1") {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(call.headers.get("content-range") ?? "");
      const isLast = range ? Number(range[2]) + 1 === Number(range[3]) : false;
      return new Response(null, { status: state.putStatus ?? (isLast ? 201 : 206) });
    }
    if (url === "https://open.tiktokapis.com/v2/post/publish/status/fetch/") {
      const response = state.statusResponse ?? { status: 200, body: { data: { status: state.status, fail_reason: state.failReason }, error: { code: "ok", message: "" } } };
      return Response.json(response.body, { status: response.status });
    }
    if (url === "https://open.tiktokapis.com/v2/oauth/revoke/") return Response.json({});
    return Response.json({ error: { code: "unexpected", message: url } }, { status: 500 });
  }));
  return { calls, state, of: (suffix: string) => calls.filter((call) => call.url.endsWith(suffix)) };
}

async function seedTikTokAccount(options: { accessExpiresInMs?: number; handle?: string } = {}) {
  const access = await encryptToken("act.seed");
  const refresh = await encryptToken("rft.seed");
  const id = await seedSocialAccount(testDb.db, userId, {
    platform: "TikTok",
    handle: options.handle ?? "Pablo TikTok",
    externalId: "open-1",
    ciphertext: access.ciphertext,
    iv: access.iv,
    expiresAt: new Date(Date.now() + (options.accessExpiresInMs ?? 3_600_000)).toISOString(),
  });
  await testDb.db.prepare("UPDATE social_accounts SET refresh_ciphertext = ?, refresh_iv = ?, refresh_expires_at = ? WHERE id = ?")
    .bind(refresh.ciphertext, refresh.iv, new Date(Date.now() + 86_400_000).toISOString(), id)
    .run();
  return id;
}

function pattern(size: number) {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index++) bytes[index] = (index * 7 + 13) & 255;
  return bytes;
}

async function seedVideo(size: number, contentType = "video/mp4") {
  const bytes = pattern(size);
  const key = "content/test/" + crypto.randomUUID();
  await fakeBucket.bucket.put(key, bytes);
  const contentId = await seedContent(testDb.db, userId, { ...approvedVideo(), asset_key: key, asset_size: size, asset_content_type: contentType });
  return { contentId, bytes };
}

const publicationOf = (contentId: string) => testDb.db.prepare("SELECT id, status, error, job_id FROM publications WHERE content_id = ?").bind(contentId).first<{ id: string; status: string; error: string | null; job_id: string | null }>();
const contentState = (contentId: string) => testDb.db.prepare("SELECT state, scheduled_at FROM content_items WHERE id = ?").bind(contentId).first<{ state: string; scheduled_at: string | null }>();

async function signIn() {
  await testDb.db.prepare("INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES ('sess-test', ?, ?)").bind(userId, inOneHour()).run();
  session.token = "sess-test";
}

describe("conectar una cuenta de TikTok", () => {
  async function authorize() {
    await signIn();
    const connect = await get(ConnectRoute, "https://nex.test/api/social/tiktok/connect");
    const location = new URL(connect.headers.get("location")!);
    return { connect, location, state: location.searchParams.get("state")! };
  }

  it("redirige a TikTok con un state de un solo uso y guarda la cuenta con los tokens cifrados", async () => {
    const mock = mockTikTok();
    const { connect, location, state } = await authorize();
    expect(connect.status).toBe(302);
    expect(location.origin + location.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_key: "client-key",
      scope: "user.info.basic,video.upload",
      response_type: "code",
      redirect_uri: "https://nex.test/api/social/tiktok/callback",
    });
    const stored = await testDb.db.prepare("SELECT state_hash FROM tiktok_oauth_states").all<{ state_hash: string }>();
    expect(stored.results).toHaveLength(1);
    expect(stored.results[0].state_hash).not.toBe(state);

    const callback = await get(CallbackRoute, "https://nex.test/api/social/tiktok/callback?code=abc%2F123&state=" + state);
    expect(callback.headers.get("location")).toBe("https://nex.test/cuentas?tiktok=connected");

    const form = new URLSearchParams(mock.of("/v2/oauth/token/")[0].text);
    expect(Object.fromEntries(form)).toMatchObject({ client_key: "client-key", client_secret: "client-secret", grant_type: "authorization_code", code: "abc/123", redirect_uri: "https://nex.test/api/social/tiktok/callback" });

    const account = await testDb.db.prepare("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'TikTok'").bind(userId).first<Record<string, string>>();
    expect(account).toMatchObject({ handle: "Pablo TikTok", external_account_id: "open-1", status: "conectada" });
    expect(account!.token_ciphertext).not.toContain("act.first");
    expect(await decryptToken(account!.token_ciphertext, account!.token_iv)).toBe("act.first");
    expect(await decryptToken(account!.refresh_ciphertext, account!.refresh_iv)).toBe("rft.first");

    const replay = await get(CallbackRoute, "https://nex.test/api/social/tiktok/callback?code=abc&state=" + state);
    expect(replay.headers.get("location")).toBe("https://nex.test/cuentas?tiktok=expired");
  });

  it("reconectar la misma cuenta no la duplica", async () => {
    mockTikTok();
    for (let attempt = 0; attempt < 2; attempt++) {
      const { state } = await authorize();
      await get(CallbackRoute, "https://nex.test/api/social/tiktok/callback?code=abc&state=" + state);
    }
    const count = await testDb.db.prepare("SELECT COUNT(*) AS total FROM social_accounts WHERE platform = 'TikTok'").first<{ total: number }>();
    expect(count?.total).toBe(1);
  });

  it("pide iniciar sesión, avisa si falta configurar y rechaza si no se concedió el permiso de subida", async () => {
    mockTikTok();
    expect((await get(ConnectRoute, "https://nex.test/api/social/tiktok/connect")).headers.get("location")).toBe("https://nex.test/login");

    await signIn();
    Object.assign(env as object, { TIKTOK_CLIENT_SECRET: undefined });
    expect((await get(ConnectRoute, "https://nex.test/api/social/tiktok/connect")).headers.get("location")).toBe("https://nex.test/cuentas?tiktok=config");
    Object.assign(env as object, { TIKTOK_CLIENT_SECRET: "client-secret" });

    const mock = mockTikTok();
    mock.state.scope = "user.info.basic";
    const connect = await get(ConnectRoute, "https://nex.test/api/social/tiktok/connect");
    const state = new URL(connect.headers.get("location")!).searchParams.get("state")!;
    const callback = await get(CallbackRoute, "https://nex.test/api/social/tiktok/callback?code=abc&state=" + state);
    expect(callback.headers.get("location")).toBe("https://nex.test/cuentas?tiktok=scope");
    expect((await testDb.db.prepare("SELECT COUNT(*) AS total FROM social_accounts").first<{ total: number }>())?.total).toBe(0);

    expect((await get(CallbackRoute, "https://nex.test/api/social/tiktok/callback?error=access_denied&state=x")).headers.get("location")).toBe("https://nex.test/cuentas?tiktok=denied");
  });

  it("exige HTTPS en PUBLIC_APP_URL", async () => {
    await signIn();
    Object.assign(env as object, { PUBLIC_APP_URL: "http://nex.test" });
    expect((await get(ConnectRoute, "http://nex.test/api/social/tiktok/connect")).headers.get("location")).toBe("http://nex.test/cuentas?tiktok=config");
  });
});

describe("token de acceso", () => {
  it("usa el token vigente sin renovarlo", async () => {
    const mock = mockTikTok();
    const account = await seedTikTokAccount();
    expect(await getTikTokAccessToken(account, userId)).toBe("act.seed");
    expect(mock.calls).toHaveLength(0);
  });

  it("renueva el token que está por vencer y guarda el par rotado", async () => {
    const mock = mockTikTok();
    const account = await seedTikTokAccount({ accessExpiresInMs: 60_000 });
    expect(await getTikTokAccessToken(account, userId)).toBe("act.refreshed");
    expect(Object.fromEntries(new URLSearchParams(mock.of("/v2/oauth/token/")[0].text))).toMatchObject({ grant_type: "refresh_token", refresh_token: "rft.seed" });
    const row = await testDb.db.prepare("SELECT token_ciphertext, token_iv, refresh_ciphertext, refresh_iv FROM social_accounts WHERE id = ?").bind(account).first<Record<string, string>>();
    expect(await decryptToken(row!.token_ciphertext, row!.token_iv)).toBe("act.refreshed");
    expect(await decryptToken(row!.refresh_ciphertext, row!.refresh_iv)).toBe("rft.rotated");
    expect(await getTikTokAccessToken(account, userId)).toBe("act.refreshed");
    expect(mock.of("/v2/oauth/token/")).toHaveLength(1);
  });

  it("pide reconectar si la cuenta está desconectada o no es del usuario", async () => {
    mockTikTok();
    const stranger = await seedUser(testDb.db, "otra@example.test");
    const account = await seedTikTokAccount();
    await expect(getTikTokAccessToken(account, stranger)).rejects.toThrow(/no está conectada/);
  });
});

describe("TikTok a través del cron", () => {
  async function scheduleOne(size: number, contentType?: string) {
    const account = await seedTikTokAccount();
    const { contentId, bytes } = await seedVideo(size, contentType);
    await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });
    return { account, contentId, bytes };
  }

  it("sube un video pequeño en un solo trozo y lo deja como borrador en la bandeja", async () => {
    const mock = mockTikTok();
    const { contentId, bytes } = await scheduleOne(3 * MB);
    await makeDue();
    await runPublicationCycle();

    const init = mock.of("/inbox/video/init/");
    expect(init).toHaveLength(1);
    expect(init[0].headers.get("authorization")).toBe("Bearer act.seed");
    expect(JSON.parse(init[0].text!)).toEqual({ source_info: { source: "FILE_UPLOAD", video_size: 3 * MB, chunk_size: 3 * MB, total_chunk_count: 1 } });

    const puts = mock.calls.filter((call) => call.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].headers.get("content-range")).toBe(`bytes 0-${3 * MB - 1}/${3 * MB}`);
    expect(puts[0].headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(puts[0].bytes!).equals(Buffer.from(bytes))).toBe(true);

    expect(JSON.parse(mock.of("/status/fetch/")[0].text!)).toEqual({ publish_id: "v_pub_1" });
    expect(await publicationOf(contentId)).toMatchObject({ status: "borrador_enviado", job_id: "v_pub_1", error: null });
    // Un borrador en la bandeja no es una publicación: la pieza vuelve a «aprobada».
    expect(await contentState(contentId)).toEqual({ state: "aprobada", scheduled_at: null });
    expect((await testDb.db.prepare("SELECT COUNT(*) AS total FROM tiktok_uploads").first<{ total: number }>())?.total).toBe(0);
  });

  it("reparte un video grande en trozos sobre varios ciclos y el último absorbe el resto", async () => {
    Object.assign(tiktokTuning, { chunkSize: 5 * MB, bytesPerCycle: 5 * MB });
    const mock = mockTikTok();
    mock.state.status = "PROCESSING_UPLOAD";
    const { contentId, bytes } = await scheduleOne(12 * MB);
    await makeDue();

    await runPublicationCycle();
    expect(JSON.parse(mock.of("/inbox/video/init/")[0].text!).source_info).toEqual({ source: "FILE_UPLOAD", video_size: 12 * MB, chunk_size: 5 * MB, total_chunk_count: 2 });
    let puts = mock.calls.filter((call) => call.method === "PUT");
    expect(puts.map((call) => call.headers.get("content-range"))).toEqual([`bytes 0-${5 * MB - 1}/${12 * MB}`]);
    expect(mock.of("/status/fetch/")).toHaveLength(0);
    expect((await publicationOf(contentId))?.status).toBe("en_curso");

    await runPublicationCycle();
    puts = mock.calls.filter((call) => call.method === "PUT");
    expect(puts.map((call) => call.headers.get("content-range"))).toEqual([`bytes 0-${5 * MB - 1}/${12 * MB}`, `bytes ${5 * MB}-${12 * MB - 1}/${12 * MB}`]);
    expect(Buffer.concat(puts.map((call) => Buffer.from(call.bytes!))).equals(Buffer.from(bytes))).toBe(true);
    expect(mock.of("/status/fetch/")).toHaveLength(1);
    expect((await publicationOf(contentId))?.status).toBe("en_curso");

    mock.state.status = "SEND_TO_USER_INBOX";
    await runPublicationCycle();
    expect(mock.calls.filter((call) => call.method === "PUT")).toHaveLength(2);
    expect((await publicationOf(contentId))?.status).toBe("borrador_enviado");
  });

  it("marca la pieza como publicada si TikTok informa que la persona la publicó", async () => {
    const mock = mockTikTok();
    mock.state.status = "PUBLISH_COMPLETE";
    const { contentId } = await scheduleOne(2 * MB);
    await makeDue();
    await runPublicationCycle();
    expect((await publicationOf(contentId))?.status).toBe("publicada");
    expect(await contentState(contentId)).toMatchObject({ state: "publicada", scheduled_at: null });
  });

  it("explica en español por qué falló el procesamiento en TikTok", async () => {
    const mock = mockTikTok();
    mock.state.status = "FAILED";
    mock.state.failReason = "file_format_check_failed";
    const { contentId } = await scheduleOne(2 * MB);
    await makeDue();
    await runPublicationCycle();
    expect(await publicationOf(contentId)).toMatchObject({ status: "fallida", error: expect.stringMatching(/formato/) });
  });

  it("avisa del límite de 5 borradores pendientes sin subir nada", async () => {
    const mock = mockTikTok();
    mock.state.initResponse = { status: 403, body: { error: { code: "spam_risk_too_many_pending_share", message: "limit" } } };
    const { contentId } = await scheduleOne(2 * MB);
    await makeDue();
    await runPublicationCycle();
    expect(await publicationOf(contentId)).toMatchObject({ status: "fallida", error: expect.stringMatching(/5 borradores/) });
    expect(mock.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("renueva el token vencido antes de iniciar la subida", async () => {
    const mock = mockTikTok();
    const account = await seedTikTokAccount({ accessExpiresInMs: 30_000 });
    const { contentId } = await seedVideo(2 * MB);
    await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });
    await makeDue();
    await runPublicationCycle();
    expect(mock.of("/inbox/video/init/")[0].headers.get("authorization")).toBe("Bearer act.refreshed");
    expect((await publicationOf(contentId))?.status).toBe("borrador_enviado");
  });

  it("reintenta un trozo con error del servidor y se rinde tras tres intentos", async () => {
    const mock = mockTikTok();
    mock.state.putStatus = 503;
    const { contentId } = await scheduleOne(2 * MB);
    await makeDue();
    await runPublicationCycle();
    expect((await publicationOf(contentId))?.status).toBe("en_curso");
    await runPublicationCycle();
    expect((await publicationOf(contentId))?.status).toBe("en_curso");
    await runPublicationCycle();
    expect(await publicationOf(contentId)).toMatchObject({ status: "fallida", error: expect.stringMatching(/varios intentos/) });
    expect(mock.calls.filter((call) => call.method === "PUT")).toHaveLength(3);
  });

  it("falla con un mensaje claro si el enlace de subida venció", async () => {
    const mock = mockTikTok();
    mock.state.putStatus = 403;
    const { contentId } = await scheduleOne(2 * MB);
    await makeDue();
    await runPublicationCycle();
    expect(await publicationOf(contentId)).toMatchObject({ status: "fallida", error: expect.stringMatching(/venció/) });
  });

  it("sigue en curso ante un error temporal al consultar el estado y lo resuelve después", async () => {
    const mock = mockTikTok();
    mock.state.statusResponse = { status: 429, body: { error: { code: "rate_limit_exceeded", message: "slow down" } } };
    const { contentId } = await scheduleOne(2 * MB);
    await makeDue();
    await runPublicationCycle();
    expect((await publicationOf(contentId))?.status).toBe("en_curso");

    mock.state.statusResponse = undefined;
    await runPublicationCycle();
    expect((await publicationOf(contentId))?.status).toBe("borrador_enviado");
    // El video no se vuelve a subir: ya estaba completo en TikTok.
    expect(mock.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("no inicia la subida si el video ya no existe en Nex", async () => {
    const mock = mockTikTok();
    const { contentId } = await scheduleOne(2 * MB);
    for (const key of [...fakeBucket.objects.keys()]) fakeBucket.objects.delete(key);
    await makeDue();
    await runPublicationCycle();
    expect(await publicationOf(contentId)).toMatchObject({ status: "fallida", error: expect.stringMatching(/ya no está disponible/) });
    expect(mock.calls).toHaveLength(0);
  });

  it("falla si el video cambia de tamaño mientras se sube por trozos", async () => {
    Object.assign(tiktokTuning, { chunkSize: 5 * MB, bytesPerCycle: 5 * MB });
    const mock = mockTikTok();
    mock.state.status = "PROCESSING_UPLOAD";
    const { contentId } = await scheduleOne(12 * MB);
    await makeDue();
    await runPublicationCycle();
    const [key] = [...fakeBucket.objects.keys()];
    await fakeBucket.bucket.put(key, pattern(9 * MB));
    await runPublicationCycle();
    expect(await publicationOf(contentId)).toMatchObject({ status: "fallida", error: expect.stringMatching(/cambió/) });
    expect(mock.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("dos ciclos solapados no suben el mismo trozo dos veces", async () => {
    const mock = mockTikTok();
    mock.state.status = "PROCESSING_UPLOAD";
    const { contentId } = await scheduleOne(2 * MB);
    await makeDue();
    await runPublicationCycle();
    await testDb.db.prepare("UPDATE tiktok_uploads SET lease_until = ?").bind(new Date(Date.now() + 60_000).toISOString()).run();
    const before = mock.calls.length;
    await runPublicationCycle();
    expect(mock.calls.length).toBe(before);
    expect((await publicationOf(contentId))?.status).toBe("en_curso");
  });
});

describe("desconectar una cuenta de TikTok", () => {
  const disconnect = (accountId: string) => handlersOf(DisconnectRoute).POST({ request: new Request("https://nex.test/api/social/tiktok/disconnect", { method: "POST", body: JSON.stringify({ accountId }) }) });

  it("revoca y borra los tokens, y cierra las publicaciones abiertas de esa cuenta", async () => {
    const mock = mockTikTok();
    await signIn();
    const account = await seedTikTokAccount();
    const { contentId } = await seedVideo(2 * MB);
    await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });

    const response = await disconnect(account);
    expect(response.status).toBe(200);
    expect(new URLSearchParams(mock.of("/v2/oauth/revoke/")[0].text).get("token")).toBe("act.seed");
    const row = await testDb.db.prepare("SELECT status, token_ciphertext, refresh_ciphertext FROM social_accounts WHERE id = ?").bind(account).first();
    expect(row).toEqual({ status: "desconectada", token_ciphertext: null, refresh_ciphertext: null });
    expect(await publicationOf(contentId)).toMatchObject({ status: "fallida", error: expect.stringMatching(/desconectada/) });
    expect(await contentState(contentId)).toEqual({ state: "aprobada", scheduled_at: null });
  });

  it("no toca cuentas de otra persona y exige sesión", async () => {
    mockTikTok();
    const account = await seedTikTokAccount();
    expect((await disconnect(account)).status).toBe(401);
    const stranger = await seedUser(testDb.db, "otra@example.test");
    await testDb.db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES ('sess-other', ?, ?)").bind(stranger, inOneHour()).run();
    session.token = "sess-other";
    expect((await disconnect(account)).status).toBe(404);
    expect((await testDb.db.prepare("SELECT status FROM social_accounts WHERE id = ?").bind(account).first<{ status: string }>())?.status).toBe("conectada");
  });
});
