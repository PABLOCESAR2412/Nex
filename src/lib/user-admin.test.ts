import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminEmails: undefined as string | undefined,
  queries: [] as string[],
  bindings: [] as unknown[][],
  first: vi.fn(),
  all: vi.fn(),
}));

vi.mock("./db", () => ({
  getRuntimeEnv: () => ({ NEX_ADMIN_EMAILS: mocks.adminEmails }),
  getDb: () => ({
    prepare: (sql: string) => {
      mocks.queries.push(sql);
      return {
        bind: (...values: unknown[]) => {
          mocks.bindings.push(values);
          return { first: mocks.first, all: mocks.all };
        },
        first: mocks.first,
        all: mocks.all,
      };
    },
  }),
}));

import { listRegisteredUsers } from "./user-admin.server";

describe("registered users directory", () => {
  beforeEach(() => {
    mocks.adminEmails = undefined;
    mocks.queries.length = 0;
    mocks.bindings.length = 0;
    mocks.first.mockReset();
    mocks.all.mockReset();
  });

  it("fails closed when no administrator is configured", async () => {
    await expect(listRegisteredUsers("session-user-id")).resolves.toEqual({ status: "not_configured" });
    expect(mocks.queries).toHaveLength(0);
  });

  it("does not query the directory for a non-administrator", async () => {
    mocks.adminEmails = "admin@example.com, owner@example.com";
    mocks.first.mockResolvedValueOnce({ email: "member@example.com" });

    await expect(listRegisteredUsers("member-id")).resolves.toEqual({ status: "forbidden" });
    expect(mocks.queries).toHaveLength(1);
    expect(mocks.queries[0]).toContain("SELECT email FROM users WHERE id = ?");
  });

  it("returns only safe user summaries to an allowlisted administrator", async () => {
    mocks.adminEmails = " OWNER@example.com, admin@example.com ";
    mocks.first
      .mockResolvedValueOnce({ email: "owner@example.com" })
      .mockResolvedValueOnce({ total: 1 });
    mocks.all.mockResolvedValue({
      results: [{ name: "Pablo", email: "pablo@example.com", created_at: "2026-11-14 10:00:00", active_sessions: 1 }],
    });

    await expect(listRegisteredUsers("owner-id")).resolves.toEqual({
      status: "ready",
      total: 1,
      users: [{ name: "Pablo", email: "pablo@example.com", created_at: "2026-11-14 10:00:00", active_sessions: 1 }],
      truncated: false,
    });
    const directoryQuery = mocks.queries.find((query) => query.includes("FROM users u")) ?? "";
    expect(directoryQuery).toContain("expires_at > ?");
    expect(directoryQuery).not.toMatch(/password_hash|password/i);
    expect(mocks.bindings[1]).toHaveLength(1);
  });
});
