import { getRuntimeEnv } from "./db";

const textEncoder = new TextEncoder();

export function instagramConfig(requestOrigin?: string) {
  const env = getRuntimeEnv();
  const appId = env.INSTAGRAM_APP_ID?.trim();
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim();
  const encryptionSecret = env.INSTAGRAM_TOKEN_ENCRYPTION_KEY?.trim() || env.TOKEN_ENCRYPTION_KEY?.trim();
  const publicAppUrl = env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || requestOrigin?.trim().replace(/\/+$/, "") || "";
  if (!appId || !appSecret || !encryptionSecret) {
    throw new Error("Instagram requiere configurar INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET e INSTAGRAM_TOKEN_ENCRYPTION_KEY (o TOKEN_ENCRYPTION_KEY).");
  }
  if (textEncoder.encode(encryptionSecret).length < 32) {
    throw new Error("INSTAGRAM_TOKEN_ENCRYPTION_KEY debe tener al menos 32 bytes.");
  }
  const publicUrl = new URL(publicAppUrl);
  if (publicAppUrl) {
    const publicUrl = new URL(publicAppUrl);
    if (publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) {
      throw new Error("PUBLIC_APP_URL debe ser solo el origen público de Nex.");
    }
    if (publicUrl.protocol !== "https:" && publicUrl.hostname !== "localhost" && publicUrl.hostname !== "127.0.0.1") {
      throw new Error("PUBLIC_APP_URL debe usar HTTPS.");
    }
  }
  const graphVersion = env.INSTAGRAM_GRAPH_VERSION?.trim() || "v27.0";
  if (!/^v?\d+\.\d+$/.test(graphVersion)) throw new Error("INSTAGRAM_GRAPH_VERSION debe tener formato v27.0.");
  return {
    appId,
    appSecret,
    encryptionSecret,
    publicAppUrl,
    graphVersion: graphVersion.startsWith("v") ? graphVersion : "v" + graphVersion,
    redirectUri: publicAppUrl ? publicAppUrl + "/api/social/instagram/callback" : "",
  };
}

export function isInstagramConfigured() {
  try {
    instagramConfig("https://nex.invalid");
    return true;
  } catch {
    return false;
  }
}

export function graphUrl(path: string) {
  const config = instagramConfig();
  return "https://graph.instagram.com/" + config.graphVersion + "/" + path.replace(/^\/+/, "");
}

export async function instagramRequest<T>(
  path: string,
  accessToken: string,
  options: { method?: "GET" | "POST"; body?: URLSearchParams } = {},
): Promise<T> {
  const response = await fetch(graphUrl(path), {
    method: options.method ?? "GET",
    headers: {
      authorization: "Bearer " + accessToken,
      ...(options.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: options.body,
  });
  const result = await response.json().catch(() => null) as {
    error?: { message?: string };
    [key: string]: unknown;
  } | null;
  if (!response.ok || result?.error) {
    throw new Error(result?.error?.message || "Instagram no pudo completar la solicitud.");
  }
  if (!result) throw new Error("Instagram devolvió una respuesta vacía.");
  return result as T;
}

export { decryptToken as decryptInstagramToken, encryptToken as encryptInstagramToken, randomSecret, sha256Hex } from "./token-crypto";
