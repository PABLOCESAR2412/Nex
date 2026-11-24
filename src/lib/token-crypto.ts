import { getRuntimeEnv } from "./db";

// Cifrado de tokens de redes sociales y utilidades de hash compartidas por Instagram y TikTok.
// La sal es la misma que usaba Instagram desde el principio, así que los tokens ya guardados siguen descifrándose.
const textEncoder = new TextEncoder();
const encryptionSalt = textEncoder.encode("nex-social-account-token-v1");

/** Clave de cifrado: INSTAGRAM_TOKEN_ENCRYPTION_KEY si existe (instalaciones previas) o TOKEN_ENCRYPTION_KEY. */
export function tokenEncryptionSecret() {
  const env = getRuntimeEnv();
  const secret = env.INSTAGRAM_TOKEN_ENCRYPTION_KEY?.trim() || env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) throw new Error("Falta la clave de cifrado de tokens: define TOKEN_ENCRYPTION_KEY (o INSTAGRAM_TOKEN_ENCRYPTION_KEY).");
  if (textEncoder.encode(secret).length < 32) throw new Error("La clave de cifrado de tokens debe tener al menos 32 bytes.");
  return secret;
}

async function encryptionKey() {
  const keyMaterial = await crypto.subtle.importKey("raw", textEncoder.encode(tokenEncryptionSecret()), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encryptionSalt, info: encryptionSalt },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function encryptToken(token: string) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(token));
  return { ciphertext: toBase64(new Uint8Array(encrypted)), iv: toBase64(iv) };
}

export async function decryptToken(ciphertext: string, ivValue: string) {
  const key = await encryptionKey();
  const cleartext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivValue) }, key, fromBase64(ciphertext));
  return new TextDecoder().decode(cleartext);
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomSecret() {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
