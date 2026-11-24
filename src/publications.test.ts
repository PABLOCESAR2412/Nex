// @vitest-environment node
/// <reference types="vitest/globals" />
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptInstagramToken } from "./lib/instagram";
import { handleInstagramPublishRequest } from "./lib/instagram-publish";
import { cancelPublication, listPublications, registerPublicationAdapter, runPublicationCycle, schedulePublications, type PublicationAdapter } from "./lib/publications";
import { approvedVideo, seedContent, seedSocialAccount, seedUser } from "./test-utils/fixtures";
import { createFakeBucket, createTestDatabase } from "./test-utils/worker-env";

vi.mock("./lib/session", () => ({ readSessionToken: () => null, setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let userId: string;
const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();
// Hace vencer lo programado moviendo su fecha al pasado; el ciclo usa el reloj real para que las esperas (updated_at) sean coherentes.
const makeDue = () => testDb.db.prepare("UPDATE publications SET scheduled_at = '2000-01-01T00:00:00.000Z' WHERE status = 'programada'").run();

beforeAll(async () => { testDb = await createTestDatabase(); });
afterAll(async () => { await testDb.dispose(); });
beforeEach(async () => {
  Object.assign(env as object, {
    nex_db: testDb.db,
    nex_assets: createFakeBucket().bucket,
    INSTAGRAM_APP_ID: "app",
    INSTAGRAM_APP_SECRET: "secret",
    INSTAGRAM_TOKEN_ENCRYPTION_KEY: "k".repeat(32),
    PUBLIC_APP_URL: "https://nex.test",
  });
  await testDb.db.prepare("DELETE FROM users").run();
  userId = await seedUser(testDb.db);
  vi.unstubAllGlobals();
});

const contentRow = (id: string) => testDb.db.prepare("SELECT state, scheduled_at FROM content_items WHERE id = ?").bind(id).first<{ state: string; scheduled_at: string | null }>();
const publicationRow = (id: string) => testDb.db.prepare("SELECT status, error, job_id FROM publications WHERE id = ?").bind(id).first<{ status: string; error: string | null; job_id: string | null }>();

describe("programar publicaciones", () => {
  it("crea una publicación por cuenta y deja la pieza programada", async () => {
    const contentId = await seedContent(testDb.db, userId, approvedVideo());
    const ig = await seedSocialAccount(testDb.db, userId, { platform: "Instagram" });
    const other = await seedSocialAccount(testDb.db, userId, { platform: "Prueba", handle: "@otra" });
    const when = inOneHour();
    const publications = await schedulePublications(userId, { contentId, accountIds: [ig, other], scheduledAt: when });
    expect(publications.map((row) => row.platform).sort()).toEqual(["Instagram", "Prueba"]);
    expect(publications.every((row) => row.status === "programada" && row.scheduled_at === when)).toBe(true);
    expect(await contentRow(contentId)).toEqual({ state: "programada", scheduled_at: when });
  });

  it("exige que una persona haya aprobado la pieza", async () => {
    const draft = await seedContent(testDb.db, userId, { ...approvedVideo(), state: "borrador" });
    const calendarOnly = await seedContent(testDb.db, userId, { ...approvedVideo(), state: "programada" });
    const account = await seedSocialAccount(testDb.db, userId);
    await expect(schedulePublications(userId, { contentId: draft, accountIds: [account], scheduledAt: inOneHour() })).rejects.toThrow(/Aprueba la pieza/);
    await expect(schedulePublications(userId, { contentId: calendarOnly, accountIds: [account], scheduledAt: inOneHour() })).rejects.toThrow(/Aprueba la pieza/);
  });

  it("valida fecha futura, video adjunto y cuentas propias y conectadas", async () => {
    const account = await seedSocialAccount(testDb.db, userId);
    const noVideo = await seedContent(testDb.db, userId, { state: "aprobada" });
    const ready = await seedContent(testDb.db, userId, approvedVideo());
    await expect(schedulePublications(userId, { contentId: ready, accountIds: [account], scheduledAt: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow(/futuro/);
    await expect(schedulePublications(userId, { contentId: noVideo, accountIds: [account], scheduledAt: inOneHour() })).rejects.toThrow(/video/);
    const stranger = await seedUser(testDb.db, "otra@example.test");
    const foreign = await seedSocialAccount(testDb.db, stranger);
    const disconnected = await seedSocialAccount(testDb.db, userId, { status: "desconectada" });
    await expect(schedulePublications(userId, { contentId: ready, accountIds: [foreign], scheduledAt: inOneHour() })).rejects.toThrow(/cuenta/);
    await expect(schedulePublications(userId, { contentId: ready, accountIds: [disconnected], scheduledAt: inOneHour() })).rejects.toThrow(/cuenta/);
  });

  it("reprogramar cambia la fecha sin duplicar la publicación", async () => {
    const contentId = await seedContent(testDb.db, userId, approvedVideo());
    const account = await seedSocialAccount(testDb.db, userId);
    await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });
    const later = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const publications = await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: later });
    expect(publications).toHaveLength(1);
    expect(publications[0].scheduled_at).toBe(later);
    expect((await contentRow(contentId))?.scheduled_at).toBe(later);
  });

  it("cancelar devuelve la pieza a aprobada y no cancela lo que ya empezó", async () => {
    const contentId = await seedContent(testDb.db, userId, approvedVideo());
    const account = await seedSocialAccount(testDb.db, userId);
    const [publication] = await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });
    await cancelPublication(userId, publication.id);
    expect((await publicationRow(publication.id))?.status).toBe("cancelada");
    expect(await contentRow(contentId)).toEqual({ state: "aprobada", scheduled_at: null });

    const [again] = await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });
    await testDb.db.prepare("UPDATE publications SET status = 'en_curso' WHERE id = ?").bind(again.id).run();
    await expect(cancelPublication(userId, again.id)).rejects.toThrow(/programada/);
    await expect(cancelPublication(await seedUser(testDb.db, "x@example.test"), again.id)).rejects.toThrow(/No se encontró/);
  });
});

describe("ciclo del cron", () => {
  function fakeAdapter(overrides: Partial<PublicationAdapter> = {}) {
    const adapter = {
      start: vi.fn(async () => "job-1"),
      check: vi.fn(async () => ({ status: "en_curso" as const })),
      ...overrides,
    };
    registerPublicationAdapter("Prueba", adapter);
    return adapter;
  }
  async function scheduled(fields: Parameters<typeof seedContent>[2] = approvedVideo()) {
    const contentId = await seedContent(testDb.db, userId, fields);
    const account = await seedSocialAccount(testDb.db, userId, { platform: "Prueba" });
    const [publication] = await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });
    return { contentId, publication };
  }

  it("no toca lo que todavía no venció", async () => {
    const adapter = fakeAdapter();
    const { publication } = await scheduled();
    expect(await runPublicationCycle(new Date())).toEqual({ started: 0, settled: 0 });
    expect(adapter.start).not.toHaveBeenCalled();
    expect((await publicationRow(publication.id))?.status).toBe("programada");
  });

  it("lanza lo vencido una sola vez aunque dos ciclos coincidan", async () => {
    const adapter = fakeAdapter();
    const { publication } = await scheduled();
    await makeDue();
    await Promise.all([runPublicationCycle(), runPublicationCycle()]);
    expect(adapter.start).toHaveBeenCalledTimes(1);
    expect(await publicationRow(publication.id)).toMatchObject({ status: "en_curso", job_id: "job-1" });
  });

  it("marca como publicada cuando la red lo confirma y la pieza pasa a publicada", async () => {
    fakeAdapter({ check: vi.fn(async () => ({ status: "publicada" as const })) });
    const { contentId, publication } = await scheduled();
    await makeDue();
    expect(await runPublicationCycle()).toEqual({ started: 1, settled: 1 });
    expect((await publicationRow(publication.id))?.status).toBe("publicada");
    expect(await contentRow(contentId)).toEqual({ state: "publicada", scheduled_at: null });
  });

  it("un borrador enviado a la bandeja no marca la pieza como publicada", async () => {
    fakeAdapter({ check: vi.fn(async () => ({ status: "borrador_enviado" as const })) });
    const { contentId, publication } = await scheduled();
    await makeDue();
    await runPublicationCycle();
    expect((await publicationRow(publication.id))?.status).toBe("borrador_enviado");
    expect(await contentRow(contentId)).toEqual({ state: "aprobada", scheduled_at: null });
  });

  it("cuando una red publica, la fecha pendiente de otra red sigue en el calendario", async () => {
    fakeAdapter({ check: vi.fn(async () => ({ status: "publicada" as const })) });
    const contentId = await seedContent(testDb.db, userId, approvedVideo());
    const first = await seedSocialAccount(testDb.db, userId, { platform: "Prueba" });
    const second = await seedSocialAccount(testDb.db, userId, { platform: "Otra", handle: "@otra" });
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    await schedulePublications(userId, { contentId, accountIds: [first], scheduledAt: inOneHour() });
    await schedulePublications(userId, { contentId, accountIds: [second], scheduledAt: later });
    await testDb.db.prepare("UPDATE publications SET scheduled_at = '2000-01-01T00:00:00.000Z' WHERE account_id = ?").bind(first).run();

    await runPublicationCycle();
    expect(await contentRow(contentId)).toEqual({ state: "publicada", scheduled_at: later });
  });

  it("cancelar una de dos publicaciones deja en el calendario la fecha de la que sigue", async () => {
    const contentId = await seedContent(testDb.db, userId, approvedVideo());
    const first = await seedSocialAccount(testDb.db, userId, { platform: "Prueba" });
    const second = await seedSocialAccount(testDb.db, userId, { platform: "Otra", handle: "@otra" });
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const [early] = await schedulePublications(userId, { contentId, accountIds: [first], scheduledAt: inOneHour() });
    await schedulePublications(userId, { contentId, accountIds: [second], scheduledAt: later });

    await cancelPublication(userId, early.id);
    expect(await contentRow(contentId)).toEqual({ state: "programada", scheduled_at: later });
  });

  it("guarda el error si la red rechaza la publicación", async () => {
    fakeAdapter({ start: vi.fn(async () => { throw new Error("La autorización venció."); }) });
    const { publication } = await scheduled();
    await makeDue();
    await runPublicationCycle();
    expect(await publicationRow(publication.id)).toMatchObject({ status: "fallida", error: "La autorización venció." });
  });

  it("cancela si la pieza dejó de estar aprobada antes de la hora", async () => {
    const adapter = fakeAdapter();
    const { contentId, publication } = await scheduled();
    await testDb.db.prepare("UPDATE content_items SET state = 'borrador' WHERE id = ?").bind(contentId).run();
    await makeDue();
    await runPublicationCycle();
    expect(adapter.start).not.toHaveBeenCalled();
    expect(await publicationRow(publication.id)).toMatchObject({ status: "cancelada" });
  });

  it("pide revisión si no se pudo confirmar el inicio o la red no responde en dos horas", async () => {
    fakeAdapter();
    const { publication } = await scheduled();
    await testDb.db.prepare("UPDATE publications SET status = 'en_curso', job_id = NULL, updated_at = datetime('now', '-10 minutes') WHERE id = ?").bind(publication.id).run();
    await runPublicationCycle(new Date());
    expect((await publicationRow(publication.id))?.status).toBe("requiere_revision");

    const second = await scheduled();
    await testDb.db.prepare("UPDATE publications SET status = 'en_curso', job_id = 'job-9', updated_at = datetime('now', '-3 hours') WHERE id = ?").bind(second.publication.id).run();
    await runPublicationCycle(new Date());
    expect((await publicationRow(second.publication.id))?.status).toBe("requiere_revision");
  });
});

describe("Instagram a través del cron", () => {
  async function instagramScheduled() {
    const { ciphertext, iv } = await encryptInstagramToken("ig-token");
    const account = await seedSocialAccount(testDb.db, userId, { platform: "Instagram", externalId: "17841", ciphertext, iv });
    const contentId = await seedContent(testDb.db, userId, approvedVideo());
    const [publication] = await schedulePublications(userId, { contentId, accountIds: [account], scheduledAt: inOneHour() });
    return { account, contentId, publication };
  }
  function mockGraph(containerStatus: () => string) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/17841/media")) return Response.json({ id: "container-1" });
      if (url.includes("container-1?fields")) return Response.json({ status_code: containerStatus() });
      if (url.endsWith("/17841/media_publish")) return Response.json({ id: "media-1" });
      return Response.json({ error: { message: "inesperado " + url } }, { status: 400 });
    }));
    return calls;
  }

  it("publica una pieza programada en dos ciclos: procesa y luego publica", async () => {
    const { contentId, publication } = await instagramScheduled();
    let status = "IN_PROGRESS";
    const calls = mockGraph(() => status);

    await makeDue();
    await runPublicationCycle();
    expect(await publicationRow(publication.id)).toMatchObject({ status: "en_curso" });
    expect((await publicationRow(publication.id))?.job_id).toBeTruthy();
    expect(calls.some((url) => url.endsWith("/media_publish"))).toBe(false);

    status = "FINISHED";
    await makeDue();
    await runPublicationCycle();
    expect(await publicationRow(publication.id)).toMatchObject({ status: "publicada" });
    expect(await contentRow(contentId)).toMatchObject({ state: "publicada", scheduled_at: null });
    expect(calls.filter((url) => url.endsWith("/media_publish"))).toHaveLength(1);
  });

  it("falla con un mensaje claro si falta PUBLIC_APP_URL", async () => {
    const { publication } = await instagramScheduled();
    (env as { PUBLIC_APP_URL?: string }).PUBLIC_APP_URL = undefined;
    mockGraph(() => "FINISHED");
    await makeDue();
    await runPublicationCycle();
    expect(await publicationRow(publication.id)).toMatchObject({ status: "fallida", error: expect.stringMatching(/PUBLIC_APP_URL/) });
  });

  it("la puerta de aprobación sigue cerrada para publicar a mano una pieza solo programada", async () => {
    const { account, contentId } = await instagramScheduled();
    mockGraph(() => "FINISHED");
    const start = (payload: Record<string, unknown>) => handleInstagramPublishRequest(new Request("https://nex.test/x", { method: "POST", body: JSON.stringify({ action: "start", contentId, accountId: account, ...payload }) }), userId);
    expect((await start({})).status).toBe(400);
    expect((await start({ publicationId: "no-existe" })).status).toBe(400);
  });
});
