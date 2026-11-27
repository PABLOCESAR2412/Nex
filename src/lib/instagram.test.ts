// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  userId: "nex-owner",
  states: new Map<string, string>(),
  save: vi.fn(),
  env: {
    INSTAGRAM_APP_ID: "test-app",
    INSTAGRAM_APP_SECRET: "test-app-secret",
    INSTAGRAM_TOKEN_ENCRYPTION_KEY: "fake-key-for-local-tests-only-12345678",
  },
}));

vi.mock("./auth", () => ({
  getCurrentSession: async () => ({ userId: fixtures.userId, passwordChangeRequired: false }),
}));

vi.mock("./db", () => ({
  newId: () => crypto.randomUUID(),
  getRuntimeEnv: () => fixtures.env,
  getDb: () => ({
    prepare: (sql: string) => ({
      bind: (...values: string[]) => ({
        run: async () => {
          if (sql.startsWith("INSERT INTO instagram_oauth_states")) {
            fixtures.states.set(values[0], values[1]);
          } else if (sql.startsWith("INSERT INTO social_accounts")) {
            fixtures.save(...values);
          }
        },
        first: async () => {
          if (sql.startsWith("DELETE FROM instagram_oauth_states") && fixtures.states.get(values[0]) === values[1]) {
            fixtures.states.delete(values[0]);
            return { user_id: values[1] };
          }
          return null;
        },
      }),
    }),
  }),
}));

import { decryptInstagramToken, graphUrl } from "./instagram";
import { Route as Connect } from "../routes/api.social.instagram.connect";
import { Route as Callback } from "../routes/api.social.instagram.callback";

type GetHandler = { GET: (ctx: { request: Request }) => Promise<Response> };
const connect = (Connect.options.server?.handlers as GetHandler).GET;
const callback = (Callback.options.server?.handlers as GetHandler).GET;

async function redirectForNewAccount() {
  const response = await connect({ request: new Request("https://nex.example/api/social/instagram/connect") });
  return new URL(response.headers.get("location")!);
}

function callbackRequest(redirect: URL) {
  const url = new URL(redirect.searchParams.get("redirect_uri")!);
  url.searchParams.set("state", redirect.searchParams.get("state")!);
  url.searchParams.set("code", "test-code");
  return new Request(url);
}

describe("Conexiones de Instagram", () => {
  beforeEach(() => {
    fixtures.states.clear();
    fixtures.save.mockReset();
    fixtures.userId = "nex-owner";
  });

  afterEach(() => vi.unstubAllGlobals());

  it("pide autenticar la cuenta de Instagram en cada conexión y conserva dos cuentas distintas", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ access_token: "short-one" }] }))
      .mockResolvedValueOnce(Response.json({ access_token: "long-one" }))
      .mockResolvedValueOnce(Response.json({ data: [{ user_id: "17841400000000001", username: "primer_perfil" }] }))
      .mockResolvedValueOnce(Response.json({ access_token: "short-two" }))
      .mockResolvedValueOnce(Response.json({ access_token: "long-two" }))
      .mockResolvedValueOnce(Response.json({ user_id: "17841400000000002", username: "segundo_perfil" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await redirectForNewAccount();
    const second = await redirectForNewAccount();
    expect(first.origin + first.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(first.searchParams.get("force_reauth")).toBe("true");
    expect(second.searchParams.get("force_reauth")).toBe("true");
    expect(first.searchParams.get("state")).not.toBe(second.searchParams.get("state"));

    for (const redirect of [first, second]) {
      const response = await callback({ request: callbackRequest(redirect) });
      expect(response.headers.get("location")).toBe("https://nex.example/cuentas?instagram=connected");
    }
    expect(fixtures.save.mock.calls.map(([, userId, handle, externalId]) => [userId, handle, externalId])).toEqual([
      ["nex-owner", "@primer_perfil", "17841400000000001"],
      ["nex-owner", "@segundo_perfil", "17841400000000002"],
    ]);
    const [, , , , ciphertext, iv] = fixtures.save.mock.calls[1];
    expect(await decryptInstagramToken(ciphertext, iv)).toBe("long-two");
    expect(graphUrl("me")).toBe("https://graph.instagram.com/v27.0/me");
  });

  it("rechaza el callback si la sesión de Nex no es la que inició la conexión", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const redirect = await redirectForNewAccount();
    fixtures.userId = "other-user";
    const result = await callback({ request: callbackRequest(redirect) });
    expect(result.headers.get("location")).toBe("https://nex.example/cuentas?instagram=expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
