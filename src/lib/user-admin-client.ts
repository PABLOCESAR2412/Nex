import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./auth";
import type { RegisteredUsersResult } from "./user-admin.types";

export type { RegisteredUserSummary, RegisteredUsersResult } from "./user-admin.types";

export const listRegisteredUsersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RegisteredUsersResult> => {
    const { listRegisteredUsers } = await import("./user-admin.server");
    return listRegisteredUsers(context.session.userId);
  });
