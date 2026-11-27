import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./auth";
import { getDb } from "./db";
import { isInstagramConfigured } from "./instagram";
import { isTikTokConfigured } from "./tiktok";

export type SocialPlatform = "Instagram" | "TikTok";

export type SocialAccountSummary = {
  id: string;
  platform: SocialPlatform;
  handle: string;
  status: string;
  connected_at: string | null;
  token_expires_at: string | null;
};

export const listSocialAccountsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { results } = await getDb()
      .prepare("SELECT id, platform, handle, status, connected_at, token_expires_at FROM social_accounts WHERE user_id = ? AND platform IN ('Instagram', 'TikTok') AND external_account_id IS NOT NULL ORDER BY platform, connected_at DESC, id")
      .bind(context.session.userId)
      .all<SocialAccountSummary>();
    return { configured: { Instagram: isInstagramConfigured(), TikTok: isTikTokConfigured() }, accounts: results ?? [] };
  });
