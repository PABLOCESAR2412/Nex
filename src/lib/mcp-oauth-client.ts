import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "./auth";

export type McpOAuthGrantSummary = {
  id: string;
  client_name: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
};

export const listMcpOAuthGrantsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listMcpOAuthGrants } = await import("./mcp-oauth");
    return listMcpOAuthGrants(context.session.userId);
  });

export const revokeMcpOAuthGrantFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { revokeMcpOAuthGrant } = await import("./mcp-oauth");
    return revokeMcpOAuthGrant(context.session.userId, data.id);
  });
