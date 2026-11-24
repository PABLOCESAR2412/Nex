// Utilidades para probar rutas del Worker en Node: una base D1 real (con las migraciones aplicadas)
// y un R2 en memoria. Los tests de archivos que las usan deben declarar `// @vitest-environment node`.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";

export async function createTestDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), "nex-test-"));
  const proxy = await getPlatformProxy<{ nex_db: D1Database }>({
    configPath: path.resolve(process.cwd(), "wrangler.jsonc"),
    persist: { path: dir },
  });
  const db = proxy.env.nex_db;
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  return {
    db,
    async dispose() {
      await proxy.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function readAll(value: unknown): Promise<Uint8Array> {
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

type StoredObject = { bytes: Uint8Array; contentType?: string };

/** R2 mínimo en memoria: put, get, delete y cargas multipart. */
export function createFakeBucket() {
  const objects = new Map<string, StoredObject>();
  const uploads = new Map<string, { key: string; contentType?: string; parts: Map<number, Uint8Array> }>();
  let counter = 0;

  function multipart(key: string, uploadId: string) {
    return {
      key,
      uploadId,
      async uploadPart(partNumber: number, body: unknown) {
        const upload = uploads.get(uploadId);
        if (!upload) throw new Error("Unknown multipart upload.");
        upload.parts.set(partNumber, await readAll(body));
        return { partNumber, etag: "etag-" + uploadId + "-" + partNumber };
      },
      async abort() { uploads.delete(uploadId); },
      async complete(parts: Array<{ partNumber: number; etag: string }>) {
        const upload = uploads.get(uploadId);
        if (!upload) throw new Error("Unknown multipart upload.");
        const chunks = parts.map((part) => {
          const bytes = upload.parts.get(part.partNumber);
          if (!bytes) throw new Error("Missing part " + part.partNumber);
          return bytes;
        });
        const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        objects.set(key, { bytes, contentType: upload.contentType });
        uploads.delete(uploadId);
        return { key, size: bytes.length };
      },
    };
  }

  const bucket = {
    async put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }) {
      const bytes = await readAll(value);
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
      return { key, size: bytes.length };
    },
    async get(key: string, options?: { range?: { offset?: number; length?: number } }) {
      const stored = objects.get(key);
      if (!stored) return null;
      const offset = options?.range?.offset ?? 0;
      const slice = options?.range ? stored.bytes.slice(offset, offset + (options.range.length ?? stored.bytes.length - offset)) : stored.bytes;
      return {
        key,
        // Como en R2, size es el tamaño total del objeto aunque se pida solo un rango.
        size: stored.bytes.length,
        body: new Response(slice as BodyInit).body,
        writeHttpMetadata(headers: Headers) { if (stored.contentType) headers.set("content-type", stored.contentType); },
      };
    },
    async head(key: string) {
      const stored = objects.get(key);
      return stored ? { key, size: stored.bytes.length } : null;
    },
    async delete(key: string) { objects.delete(key); },
    async createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }) {
      const uploadId = "upload-" + ++counter;
      uploads.set(uploadId, { key, contentType: options?.httpMetadata?.contentType, parts: new Map() });
      return multipart(key, uploadId);
    },
    resumeMultipartUpload(key: string, uploadId: string) { return multipart(key, uploadId); },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

/** FixedLengthStream de Workers para Node: falla si pasan más o menos bytes de los anunciados. */
export class FixedLengthStreamPolyfill extends TransformStream<Uint8Array, Uint8Array> {
  constructor(length: number) {
    let seen = 0;
    super({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > length) throw new TypeError("Attempt to write too many bytes through a FixedLengthStream.");
        controller.enqueue(chunk);
      },
      flush() {
        if (seen !== length) throw new TypeError("FixedLengthStream did not see all expected bytes.");
      },
    });
  }
}
