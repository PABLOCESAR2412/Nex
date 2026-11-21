// src/lib/auth.ts
import { createMiddleware, createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb, newId } from "./db";
import { readSessionToken, setSessionCookie, clearSessionCookie } from "./session";
import { hashPassword, verifyPassword } from "./password";
import { ALLOWED_ACCOUNT_EMAIL, isAllowedAccountEmail, normalizeEmail } from "./auth-policy";

export type Session = { id: string; userId: string; passwordChangeRequired: boolean };

export const getCurrentSession = createServerOnlyFn(async (): Promise<Session | null> => {
  const token = readSessionToken();
  if (!token) return null;
  const row = await getDb()
    .prepare("SELECT s.id, s.user_id, s.expires_at, u.email, u.password_change_required FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?")
    .bind(token)
    .first<{ id: string; user_id: string; expires_at: string; email: string; password_change_required: number }>();
  if (!row) {
    clearSessionCookie();
    return null;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await getDb().prepare("DELETE FROM sessions WHERE id = ?").bind(row.id).run();
    clearSessionCookie();
    return null;
  }
  if (!isAllowedAccountEmail(row.email)) {
    await getDb().prepare("DELETE FROM sessions WHERE id = ?").bind(row.id).run();
    clearSessionCookie();
    return null;
  }
  return { id: row.id, userId: row.user_id, passwordChangeRequired: row.password_change_required === 1 };
});

export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await getCurrentSession();
  if (!session) throw new Error("Unauthorized");
  if (session.passwordChangeRequired) throw new Error("Debes cambiar la contraseña antes de continuar.");
  return next({ context: { session } });
});

// Register
export const registerFn = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().trim().email().transform(normalizeEmail), password: z.string().min(8), name: z.string().optional() }))
  .handler(async ({ data }) => {
    if (!isAllowedAccountEmail(data.email)) throw new Error("Por ahora solo se permite el correo autorizado.");
    const db = getDb();
    const existing = await db.prepare("SELECT id FROM users WHERE lower(trim(email)) = ?").bind(data.email).first();
    if (existing) throw new Error("Ese correo ya tiene una cuenta.");
    const id = newId();
    const passwordHash = await hashPassword(data.password);
    await db
      .prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)")
      .bind(id, data.email, passwordHash, data.name ?? null)
      .run();
    // revoke existing sessions (none) and create new
    const token = newId();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(token, id, expires).run();
    setSessionCookie(token);
    return { ok: true, userId: id };
  });

// Login
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("dummy-password-for-timing");
  return dummyHashPromise;
}

export const loginFn = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().trim().email().transform(normalizeEmail), password: z.string() }))
  .handler(async ({ data }) => {
    if (!isAllowedAccountEmail(data.email)) throw new Error("Invalid email or password");
    const db = getDb();
    const user = await db
      .prepare("SELECT id, password_hash, password_change_required FROM users WHERE lower(trim(email)) = ?")
      .bind(data.email)
      .first<{ id: string; password_hash: string; password_change_required: number }>();
    const hashToCheck = user?.password_hash ?? (await getDummyHash());
    const passwordMatches = await verifyPassword(data.password, hashToCheck);
    const ok = !!user && passwordMatches;
    if (!ok) throw new Error("Invalid email or password");
    // rotate session
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user!.id).run();
    const token = newId();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user!.id, expires).run();
    setSessionCookie(token);
    return { ok: true, userId: user!.id, passwordChangeRequired: user!.password_change_required === 1 };
  });

export const changePasswordFn = createServerFn({ method: "POST" })
  .validator(z.object({ newPassword: z.string().min(8).max(128) }))
  .handler(async ({ data }) => {
    const session = await getCurrentSession();
    if (!session) throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
    const db = getDb();
    const user = await db.prepare(
      "SELECT password_hash, password_change_required FROM users WHERE id = ? AND lower(trim(email)) = ?",
    ).bind(session.userId, ALLOWED_ACCOUNT_EMAIL).first<{ password_hash: string; password_change_required: number }>();
    if (!user) throw new Error("No se encontró la cuenta autorizada.");
    if (user.password_change_required !== 1) throw new Error("No hay un cambio de contraseña pendiente.");
    if (await verifyPassword(data.newPassword, user.password_hash)) {
      throw new Error("Elige una contraseña distinta a la temporal.");
    }

    const newHash = await hashPassword(data.newPassword);
    const token = newId();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const results = await db.batch([
      db.prepare("UPDATE users SET password_hash = ?, password_change_required = 0 WHERE id = ? AND lower(trim(email)) = ?")
        .bind(newHash, session.userId, ALLOWED_ACCOUNT_EMAIL),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(session.userId),
      db.prepare("UPDATE mcp_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").bind(session.userId),
      db.prepare("UPDATE mcp_oauth_grants SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").bind(session.userId),
      db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(token, session.userId, expires),
    ]);
    if (results[0]?.meta.changes !== 1) throw new Error("No se pudo actualizar la contraseña.");
    setSessionCookie(token);
    return { ok: true };
  });

// Logout
export const logoutFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const session = await getCurrentSession();
    const db = getDb();
    if (session) await db.prepare("DELETE FROM sessions WHERE id = ?").bind(session.id).run();
    clearSessionCookie();
    return { ok: true };
  });

// Current user
export const meFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getCurrentSession();
  if (!session) return null;
  const row = await getDb()
    .prepare("SELECT id, email, name, password_change_required FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ id: string; email: string; name: string | null; password_change_required: number }>();
  if (!row) return null;
  return { ...row, password_change_required: row.password_change_required === 1 };
});
