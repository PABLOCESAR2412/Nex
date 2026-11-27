import { open } from "node:fs/promises";
import { basename, extname } from "node:path";
import { text } from "node:stream/consumers";

const productionEndpoint = "https://nex.pctg.workers.dev/api/mcp";
const maxSize = 1024 ** 3;
const mimeTypes = new Map([[".mp4", "video/mp4"], [".mov", "video/quicktime"]]);
const usage = "Uso: node scripts/nex-upload.mjs info|put RUTA_DEL_VIDEO. Put lee la respuesta de start_video_upload por stdin.";

function readSession(input) {
  const reply = input?.result ?? input;
  if (reply?.isError) throw new Error("start_video_upload devolvió un error. Inicia una carga nueva.");
  const block = Array.isArray(reply?.content) ? reply.content.find((entry) => entry?.type === "text") : undefined;
  const session = reply?.structuredContent ?? (block ? JSON.parse(block.text) : reply);
  const endpoint = new URL(process.env.NEX_MCP_URL || productionEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/api/mcp") {
    throw new Error("NEX_MCP_URL debe ser la dirección HTTPS de /api/mcp.");
  }
  if (session?.upload_url !== endpoint.href || typeof session?.upload_token !== "string" || !/^nex_upload_[A-Za-z0-9_-]{43}$/.test(session.upload_token)) {
    throw new Error("La carga no corresponde al MCP esperado o no tiene un token binario válido.");
  }
  if (typeof session.upload_id !== "string" || !session.upload_id || !Number.isSafeInteger(session.part_size) || session.part_size < 1 || session.part_size > 8 * 1024 ** 2) {
    throw new Error("La respuesta de start_video_upload no tiene un identificador y tamaño de parte válidos.");
  }
  return { session, endpoint };
}

async function readPart(file, offset, size) {
  const bytes = Buffer.allocUnsafe(size);
  let filled = 0;
  while (filled < size) {
    const { bytesRead } = await file.read(bytes, filled, size - filled, offset + filled);
    if (!bytesRead) throw new Error("El archivo cambió mientras se leía. Inicia una carga nueva.");
    filled += bytesRead;
  }
  return bytes;
}

async function putPart(endpoint, token, partNumber, bytes) {
  const url = new URL(endpoint);
  url.searchParams.set("part_number", String(partNumber));
  let response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-length": String(bytes.length) },
      body: bytes,
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error(`No se pudo transferir la parte ${partNumber}. Puedes repetir el comando con la misma sesión de carga.`);
  }
  if (!response.ok) {
    const advice = response.status === 401 ? "Inicia otra carga." : response.status === 400 ? "Comprueba que seleccionaste el archivo original." : "Puedes repetir el comando con la misma sesión.";
    throw new Error(`Nex rechazó la parte ${partNumber} (HTTP ${response.status}). ${advice}`);
  }
  const part = await response.json().catch(() => null);
  if (part?.part_number !== partNumber || typeof part.etag !== "string" || !part.etag) {
    throw new Error(`Nex no confirmó la parte ${partNumber}. Puedes repetir el comando con la misma sesión.`);
  }
  return { part_number: partNumber, etag: part.etag };
}

async function main([action, path, ...extra]) {
  if (!["info", "put"].includes(action) || !path || extra.length) throw new Error(usage);
  const contentType = mimeTypes.get(extname(path).toLowerCase());
  if (!contentType) throw new Error("Selecciona un archivo MP4 o MOV.");
  const file = await open(path, "r");
  try {
    const original = await file.stat();
    const { size, mtimeMs } = original;
    if (!original.isFile() || size < 1 || size > maxSize) throw new Error("Selecciona un video de hasta 1 GiB.");
    if (action === "info") {
      console.log(JSON.stringify({ filename: basename(path), content_type: contentType, file_size: size }));
      return;
    }

    const { session, endpoint } = readSession(JSON.parse(await text(process.stdin)));
    if (session.part_count !== Math.ceil(size / session.part_size)) {
      throw new Error("El tamaño del archivo no coincide con la sesión de carga.");
    }
    const parts = [];
    for (let index = 0; index < session.part_count; index++) {
      const offset = index * session.part_size;
      const bytes = await readPart(file, offset, Math.min(session.part_size, size - offset));
      parts.push(await putPart(endpoint, session.upload_token, index + 1, bytes));
    }
    const latest = await file.stat();
    if (latest.size !== size || latest.mtimeMs !== mtimeMs) throw new Error("El archivo cambió durante la carga. Inicia una carga nueva.");
    console.log(JSON.stringify({ upload_id: session.upload_id, parts }));
  } finally {
    await file.close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof SyntaxError ? "La entrada debe ser el JSON de start_video_upload." : error.message);
  process.exitCode = 1;
});
