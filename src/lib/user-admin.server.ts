import { getDb, getRuntimeEnv } from "./db";
import type { RegisteredUserSummary, RegisteredUsersResult } from "./user-admin.types";

const DIRECTORY_LIMIT = 500;

function configuredAdminEmails(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(/[\n,]/).map((email) => email.trim().toLowerCase()).filter(Boolean));
}

export async function listRegisteredUsers(userId: string): Promise<RegisteredUsersResult> {
  const allowedEmails = configuredAdminEmails(getRuntimeEnv().NEX_ADMIN_EMAILS);
  if (allowedEmails.size === 0) return { status: "not_configured" };

  const db = getDb();
  const requester = await db
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();
  if (!requester || !allowedEmails.has(requester.email.trim().toLowerCase())) {
    return { status: "forbidden" };
  }

  const [countRow, userRows] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>(),
    db.prepare(`
      SELECT u.name, u.email, u.created_at, COUNT(s.id) AS active_sessions
      FROM users u
      LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > ?
      GROUP BY u.id, u.name, u.email, u.created_at
      ORDER BY datetime(u.created_at) DESC, lower(u.email) ASC
      LIMIT ${DIRECTORY_LIMIT}
    `).bind(new Date().toISOString()).all<RegisteredUserSummary>(),
  ]);

  const total = Number(countRow?.total ?? 0);
  const users = (userRows.results ?? []).map((user) => ({
    ...user,
    active_sessions: Number(user.active_sessions) || 0,
  }));

  return { status: "ready", total, users, truncated: total > users.length };
}
