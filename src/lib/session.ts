// src/lib/session.ts
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

const SESSION_COOKIE = "__Host-nex_session";
const ONE_DAY = 60 * 60 * 24;
const THIRTY_DAYS = ONE_DAY * 30;

const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

export function setSessionCookie(token: string) {
  setCookie(SESSION_COOKIE, token, {
    ...sessionCookieOptions,
    maxAge: THIRTY_DAYS,
  });
}

export function clearSessionCookie() {
  deleteCookie(SESSION_COOKIE, sessionCookieOptions);
}

export function readSessionToken(): string | null {
  return getCookie(SESSION_COOKIE) ?? null;
}