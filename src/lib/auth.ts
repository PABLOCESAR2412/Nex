// src/lib/auth.ts
import { createMiddleware, createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb, newId } from "./db";
import { readSessionToken, setSessionCookie, clearSessionCookie } from "./session";
import { hashPassword, verifyPassword } from "./password";

export type Session = { id: string; userId: string };

export const getCurrentSession = createServerOnlyFn(async (): Promise<Session | null> => {
  const token = readSessionToken();
  if (!token) return null;
  const row = await getDb()
    .prepare("SELECT id, user_id, expires_at FROM sessions WHERE id = ?")
    .bind(token)
    .first<{ id: string; user_id: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await getDb().prepare("DELETE FROM sessions WHERE id = ?").bind(row.id).run();
    clearSessionCookie();
    return null;
  }
  return { id: row.id, userId: row.user_id };
});

export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await getCurrentSession();
  if (!session) throw new Error("Unauthorized");
  return next({ context: { session } });
});

// Register
export const registerFn = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().optional() }))
  .handler(async ({ data }) => {
    const db = getDb();
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(data.email).first();
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
  .validator(z.object({ email: z.string().email(), password: z.string() }))
  .handler(async ({ data }) => {
    const db = getDb();
    const user = await db
      .prepare("SELECT id, password_hash FROM users WHERE email = ?")
      .bind(data.email)
      .first<{ id: string; password_hash: string }>();
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
    return { ok: true, userId: user!.id };
  });

// Logout
export const logoutFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = getDb();
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(context.session.id).run();
    clearSessionCookie();
    return { ok: true };
  });

// Current user
export const meFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getCurrentSession();
  if (!session) return null;
  const row = await getDb()
    .prepare("SELECT id, email, name FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ id: string; email: string; name: string | null }>();
  if (!row) return null;
  return row;
});
