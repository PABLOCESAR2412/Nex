export const ALLOWED_ACCOUNT_EMAIL = "pablocesar.t.g@gmail.com";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedAccountEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && normalizeEmail(email) === ALLOWED_ACCOUNT_EMAIL;
}
