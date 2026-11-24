// @vitest-environment node
/// <reference types="vitest/globals" />
import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { graphUrl, instagramConfig, isInstagramConfigured, decryptInstagramToken, encryptInstagramToken } from "./lib/instagram";
import { isHourlyTick, refreshInstagramTokens } from "./lib/instagram-refresh";
import { seedSocialAccount, seedUser } from "./test-utils/fixtures";
import { createFakeBucket, createTestDatabase } from "./test-utils/worker-env";

vi.mock("./lib/session", () => ({ readSessionToken: () => null, setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
const DAY = 86_400_000;

beforeAll(async () => { testDb = await createTestDatabase(); });
afterAll(async () => { await testDb.dispose(); });
beforeEach(async () => {
  Object.assign(env as object, {
    nex_db: testDb.db,
    nex_assets: createFakeBucket().bucket,
    INSTAGRAM_APP_ID: "app-id",
    INSTAGRAM_APP_SECRET: "app-secret",
    INSTAGRAM_TOKEN_ENCRYPTION_KEY: "i".repeat(32),
    TOKEN_ENCRYPTION_KEY: undefined,
    INSTAGRAM_GRAPH_VERSION: undefined,
    PUBLIC_APP_URL: undefined,
  });
  await testDb.db.prepare("DELETE FROM users").run();
});
afterEach(() => vi.unstubAllGlobals());

describe("configuración de Instagram", () => {
  it("funciona sin PUBLIC_APP_URL: las llamadas a Graph ya no fallan con «Invalid URL»", () => {
    expect(() => instagramConfig()).not.toThrow();
    expect(instagramConfig().redirectUri).toBe("");
    expect(graphUrl("123/media")).toBe("https://graph.instagram.com/v27.0/123/media");
    expect(isInstagramConfigured()).toBe(true);
  });

  it("valida PUBLIC_APP_URL cuando existe y usa el origen de la petición si falta", () => {
    Object.assign(env as object, { PUBLIC_APP_URL: "http://nex.test" });
    expect(() => instagramConfig()).toThrow(/HTTPS/);
    Object.assign(env as object, { PUBLIC_APP_URL: "https://nex.test/ruta" });
    expect(() => instagramConfig()).toThrow(/solo el origen/);
    Object.assign(env as object, { PUBLIC_APP_URL: undefined });
    expect(instagramConfig("https://nex.test/").redirectUri).toBe("https://nex.test/api/social/instagram/callback");
  });

  it("acepta TOKEN_ENCRYPTION_KEY como clave de cifrado y descifra lo cifrado con la otra", async () => {
    const sealed = await encryptInstagramToken("IGAA-token");
    Object.assign(env as object, { INSTAGRAM_TOKEN_ENCRYPTION_KEY: undefined, TOKEN_ENCRYPTION_KEY: "i".repeat(32) });
    expect(isInstagramConfigured()).toBe(true);
    expect(await decryptInstagramToken(sealed.ciphertext, sealed.iv)).toBe("IGAA-token");
    Object.assign(env as object, { TOKEN_ENCRYPTION_KEY: "corta" });
    expect(isInstagramConfigured()).toBe(false);
  });
});

describe("renovación de tokens de Instagram", () => {
  const NOW = new Date("2026-12-01T12:00:00.000Z");
  let userId: string;

  async function seedInstagram(options: { expiresInDays: number; ageDays?: number; status?: string; handle?: string }) {
    const sealed = await encryptInstagramToken("IGAA-" + (options.handle ?? "old"));
    const id = await seedSocialAccount(testDb.db, userId, { handle: options.handle ?? "@old", status: options.status, ciphertext: sealed.ciphertext, iv: sealed.iv, expiresAt: new Date(NOW.getTime() + options.expiresInDays * DAY).toISOString() });
    await testDb.db.prepare("UPDATE social_accounts SET updated_at = ? WHERE id = ?").bind(new Date(NOW.getTime() - (options.ageDays ?? 30) * DAY).toISOString().slice(0, 19).replace("T", " "), id).run();
    return id;
  }
  const row = (id: string) => testDb.db.prepare("SELECT token_ciphertext, token_iv, token_expires_at FROM social_accounts WHERE id = ?").bind(id).first<{ token_ciphertext: string; token_iv: string; token_expires_at: string }>();

  beforeEach(async () => { userId = await seedUser(testDb.db); });

  it("renueva solo los tokens que vencen en menos de 14 días y guarda el nuevo cifrado", async () => {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(new URL(String(input)));
      return Response.json({ access_token: "IGAA-renovado", token_type: "bearer", expires_in: 5_184_000 });
    }));
    const dueSoon = await seedInstagram({ expiresInDays: 10, handle: "@pronto" });
    const farAway = await seedInstagram({ expiresInDays: 40, handle: "@lejos" });
    const already = await seedInstagram({ expiresInDays: -1, handle: "@vencido" });
    const disconnected = await seedInstagram({ expiresInDays: 5, status: "desconectada", handle: "@fuera" });

    expect(await refreshInstagramTokens(NOW)).toEqual({ renewed: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].origin + calls[0].pathname).toBe("https://graph.instagram.com/refresh_access_token");
    expect(Object.fromEntries(calls[0].searchParams)).toEqual({ grant_type: "ig_refresh_token", access_token: "IGAA-@pronto" });

    const renewed = await row(dueSoon);
    expect(await decryptInstagramToken(renewed!.token_ciphertext, renewed!.token_iv)).toBe("IGAA-renovado");
    expect(renewed!.token_expires_at).toBe(new Date(NOW.getTime() + 5_184_000_000).toISOString());
    for (const untouched of [farAway, already, disconnected]) {
      const account = await row(untouched);
      expect(await decryptInstagramToken(account!.token_ciphertext, account!.token_iv)).not.toBe("IGAA-renovado");
    }
  });

  it("no toca un token de menos de 24 horas y deja intacto el que Instagram rechaza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Token inválido" } }, { status: 400 })));
    const fresh = await seedInstagram({ expiresInDays: 10, ageDays: 0.2, handle: "@nuevo" });
    const rejected = await seedInstagram({ expiresInDays: 12, handle: "@rechazado" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await refreshInstagramTokens(NOW)).toEqual({ renewed: 0, failed: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const account = await row(rejected);
    expect(await decryptInstagramToken(account!.token_ciphertext, account!.token_iv)).toBe("IGAA-@rechazado");
    expect(account!.token_expires_at).toBe(new Date(NOW.getTime() + 12 * DAY).toISOString());
    expect((await row(fresh))!.token_expires_at).toBe(new Date(NOW.getTime() + 10 * DAY).toISOString());
  });

  it("el cron renueva solo a la hora en punto", () => {
    expect(isHourlyTick(Date.parse("2026-12-01T12:00:00Z"))).toBe(true);
    expect(isHourlyTick(Date.parse("2026-12-01T12:01:00Z"))).toBe(false);
    expect(isHourlyTick(Date.parse("2026-12-01T12:59:00Z"))).toBe(false);
  });
});
