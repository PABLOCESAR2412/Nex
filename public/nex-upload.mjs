#!/usr/bin/env node
// Sube un archivo local a una pieza de Nex con una clave MCP. Requiere Node 18 o superior y no tiene dependencias.
//
//   NEX_URL=https://tu-nex.example NEX_TOKEN=nex_live_... node nex-upload.mjs <content_id> <archivo>
//
// También acepta --url y --token en lugar de las variables de entorno.
// Admite video (mp4, mov, webm), imagen (jpg, png, webp) y pdf de hasta 5 GiB.
import { open, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

const CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};
const PART_RETRIES = 3;

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

function parseArguments(argv) {
  const options = { url: process.env.NEX_URL, token: process.env.NEX_TOKEN };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--url") options.url = argv[++index];
    else if (argument === "--token") options.token = argv[++index];
    else positional.push(argument);
  }
  return { options, positional };
}

async function requestJson(url, token, init, label) {
  const response = await fetch(url, { ...init, headers: { ...init.headers, authorization: "Bearer " + token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data && data.error) || label + " falló con HTTP " + response.status + ".");
  return data;
}

async function uploadPart(endpoint, token, uploadId, partNumber, chunk) {
  const url = endpoint + "?action=part&uploadId=" + encodeURIComponent(uploadId) + "&partNumber=" + partNumber;
  let lastError;
  for (let attempt = 1; attempt <= PART_RETRIES; attempt++) {
    try {
      const data = await requestJson(url, token, { method: "PUT", body: chunk }, "La parte " + partNumber);
      if (typeof data.partNumber !== "number" || typeof data.etag !== "string") throw new Error("Respuesta inválida al subir la parte " + partNumber + ".");
      return { partNumber: data.partNumber, etag: data.etag };
    } catch (error) {
      lastError = error;
      if (attempt < PART_RETRIES) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

const { options, positional } = parseArguments(process.argv.slice(2));
const [contentId, filePath] = positional;
if (!options.url || !options.token || !contentId || !filePath) {
  fail("Uso: NEX_URL=<url de Nex> NEX_TOKEN=<clave MCP> node nex-upload.mjs <content_id> <archivo>");
}

const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()];
if (!contentType) fail("Formato no admitido. Usa mp4, mov, webm, jpg, png, webp o pdf.");
const baseUrl = options.url.replace(/\/+$/, "");
const endpoint = baseUrl + "/api/content/" + encodeURIComponent(contentId) + "/upload";

let size;
try { size = (await stat(filePath)).size; } catch { fail("No se pudo leer el archivo " + filePath + "."); }
if (size < 1) fail("El archivo está vacío.");

let uploadId = "";
let handle;
try {
  const start = await requestJson(endpoint + "?action=start", options.token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: basename(filePath), contentType, size }),
  }, "Iniciar la carga");
  uploadId = start.uploadId;
  const partSize = start.partSize;
  if (!uploadId || !partSize) throw new Error("Nex no devolvió los datos de la carga.");

  handle = await open(filePath, "r");
  const parts = [];
  const partCount = Math.ceil(size / partSize);
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    const length = Math.min(partSize, size - (partNumber - 1) * partSize);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, (partNumber - 1) * partSize);
    if (bytesRead !== length) throw new Error("No se pudo leer el archivo completo.");
    parts.push(await uploadPart(endpoint, options.token, uploadId, partNumber, buffer));
    process.stderr.write("\rSubiendo " + Math.round((partNumber / partCount) * 100) + "%");
  }
  process.stderr.write("\n");

  const done = await requestJson(endpoint + "?action=complete", options.token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId, parts }),
  }, "Completar la carga");
  uploadId = "";
  console.log(JSON.stringify({ ok: true, content_id: contentId, name: done.name, size: done.size }));
} catch (error) {
  if (uploadId) {
    await fetch(endpoint + "?action=abort&uploadId=" + encodeURIComponent(uploadId), {
      method: "POST",
      headers: { authorization: "Bearer " + options.token },
    }).catch(() => undefined);
  }
  fail(error instanceof Error ? error.message : "No se pudo subir el archivo.");
} finally {
  await handle?.close();
}
