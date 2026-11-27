// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeEnv } from "./db";
import {
  decryptTikTokToken,
  encryptTikTokToken,
  exchangeTikTokCode,
  fetchTikTokUploadStatus,
  getTikTokProfile,
  initializeTikTokUpload,
  isTikTokConfigured,
  refreshTikTokToken,
  tikTokAuthorizationUrl,
} from "./tiktok";

vi.mock("./db", () => ({ getRuntimeEnv: vi.fn() }));

function configure() {
  vi.mocked(getRuntimeEnv).mockReturnValue({
    TIKTOK_CLIENT_KEY: "client-key",
    TIKTOK_CLIENT_SECRET: "test-only-secret",
    TIKTOK_TOKEN_ENCRYPTION_KEY: "test-only-key-with-at-least-32-bytes",
    PUBLIC_APP_URL: "https://nex.example/",
  } as ReturnType<typeof getRuntimeEnv>);
}

const validToken = {
  access_token: "test-only-access",
  refresh_token: "test-only-refresh",
  expires_in: 7200,
  refresh_expires_in: 15552000,
  open_id: "creator-one",
  scope: "user.info.basic,video.upload",
};

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("TikTok web connection", () => {
  it("uses the configured callback and presents consent for an additional account", () => {
    vi.mocked(getRuntimeEnv).mockReturnValue({} as ReturnType<typeof getRuntimeEnv>);
    expect(isTikTokConfigured()).toBe(false);
    configure();
    expect(isTikTokConfigured()).toBe(true);
    const url = tikTokAuthorizationUrl("random-state", "https://another-origin.example");
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: "client-key",
      redirect_uri: "https://nex.example/api/social/tiktok/callback",
      response_type: "code",
      scope: "user.info.basic,video.upload",
      state: "random-state",
      disable_auto_auth: "1",
    });
  });

  it("exchanges and refreshes credentials server side, checks scope, and reads the account identity", async () => {
    configure();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(validToken))
      .mockResolvedValueOnce(Response.json({ ...validToken, refresh_token: "rotated-refresh" }))
      .mockResolvedValueOnce(Response.json({ ...validToken, scope: "user.info.basic" }))
      .mockResolvedValueOnce(Response.json({ data: { user: { open_id: "creator-two", display_name: "Otra cuenta" } }, error: { code: "ok" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(exchangeTikTokCode("auth-code")).resolves.toEqual(validToken);
    expect(fetch.mock.calls[0][0]).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(Object.fromEntries(fetch.mock.calls[0][1].body)).toMatchObject({ grant_type: "authorization_code", code: "auth-code", client_secret: "test-only-secret" });
    await expect(refreshTikTokToken(validToken.refresh_token)).resolves.toMatchObject({ refresh_token: "rotated-refresh" });
    expect(Object.fromEntries(fetch.mock.calls[1][1].body)).toMatchObject({ grant_type: "refresh_token", refresh_token: validToken.refresh_token });
    await expect(exchangeTikTokCode("denied-scope")).rejects.toMatchObject({ code: "scope_not_authorized" });
    await expect(getTikTokProfile(validToken.access_token)).resolves.toEqual({ open_id: "creator-two", display_name: "Otra cuenta" });
  });

  it("encrypts tokens with distinct IVs and authenticates ciphertext", async () => {
    configure();
    const [first, second] = await Promise.all([encryptTikTokToken("test-token"), encryptTikTokToken("test-token")]);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toContain("test-token");
    await expect(decryptTikTokToken(first.ciphertext, first.iv)).resolves.toBe("test-token");
    await expect(decryptTikTokToken(first.ciphertext, second.iv)).rejects.toThrow();
  });
});

describe("TikTok draft upload", () => {
  it("uploads from the granted URL, distinguishes inbox from published, and preserves int64 post identifiers", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { publish_id: "v_inbox_url~v2.123" }, error: { code: "ok" } }))
      .mockResolvedValueOnce(Response.json({ data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } }))
      .mockResolvedValueOnce(new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7020819184083999999]},"error":{"code":"ok"}}'));
    vi.stubGlobal("fetch", fetch);
    const videoUrl = "https://nex.example/api/social/tiktok/media/test-grant";
    const token = validToken.access_token;

    await expect(initializeTikTokUpload(token, videoUrl)).resolves.toEqual({ publish_id: "v_inbox_url~v2.123" });
    expect(fetch.mock.calls[0][0]).toBe("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ source_info: { source: "PULL_FROM_URL", video_url: videoUrl } });
    await expect(fetchTikTokUploadStatus(token, "v_inbox_url~v2.123")).resolves.toMatchObject({ status: "SEND_TO_USER_INBOX" });
    expect(fetch.mock.calls[1][0]).toBe("https://open.tiktokapis.com/v2/post/publish/status/fetch/");
    await expect(fetchTikTokUploadStatus(token, "v_inbox_url~v2.123")).resolves.toMatchObject({ status: "PUBLISH_COMPLETE", postIds: ["7020819184083999999"] });
  });

  it("separates explicit rejections from malformed responses without exposing a provider message", async () => {
    const videoUrl = "https://nex.example/api/social/tiktok/media/test-grant";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "url_ownership_unverified", message: videoUrl } }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "ok" } })));

    await expect(initializeTikTokUpload(validToken.access_token, videoUrl)).rejects.toMatchObject({
      code: "url_ownership_unverified", httpStatus: 403, message: "Verifica el dominio o el prefijo de los videos en TikTok for Developers.",
    });
    await expect(initializeTikTokUpload(validToken.access_token, videoUrl)).rejects.toMatchObject({ code: "invalid_response", httpStatus: 200 });
  });
});
