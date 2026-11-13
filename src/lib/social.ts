import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./auth";
import { getDb } from "./db";
import { isInstagramConfigured } from "./instagram";

export type InstagramAccountSummary = {
  id: string;
  handle: string;
  status: string;
  connected_at: string | null;
  token_expires_at: string | null;
};

export const listInstagramAccountsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { results } = await getDb()
      .prepare("SELECT id, handle, status, connected_at, token_expires_at FROM social_accounts WHERE user_id = ? AND platform = 'Instagram' AND external_account_id IS NOT NULL ORDER BY connected_at DESC")
      .bind(context.session.userId)
      .all<InstagramAccountSummary>();
    return { configured: isInstagramConfigured(), accounts: results ?? [] };
  });
