import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./auth";
import { getDb, getRuntimeEnv } from "./db";
import { isInstagramConfigured } from "./instagram";
import { isTikTokConfigured } from "./tiktok";

export type SocialPlatform = "Instagram" | "TikTok";

export type SocialAccountSummary = {
  id: string;
  platform: SocialPlatform;
  provider: "nex" | "buffer";
  handle: string;
  status: string;
  connected_at: string | null;
  token_expires_at: string | null;
};

export const listSocialAccountsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { BUFFER_API_KEY, BUFFER_ORGANIZATION_ID } = getRuntimeEnv();
    const bufferOrgId = BUFFER_API_KEY?.trim() ? BUFFER_ORGANIZATION_ID?.trim() || null : null;
    const { results } = await getDb()
      .prepare(`SELECT id, platform, provider, handle, connected_at, token_expires_at,
        CASE WHEN provider = 'buffer' AND status = 'conectada' AND (? IS NULL OR buffer_organization_id IS NOT ?) THEN 'requiere_atencion' ELSE status END AS status
        FROM social_accounts WHERE user_id = ? AND platform IN ('Instagram', 'TikTok') AND external_account_id IS NOT NULL
        ORDER BY platform, connected_at DESC, id`)
      .bind(bufferOrgId, bufferOrgId, context.session.userId)
      .all<SocialAccountSummary>();
    return {
      configured: { Instagram: isInstagramConfigured(), TikTok: isTikTokConfigured(), Buffer: !!bufferOrgId },
      accounts: results ?? [],
    };
  });
