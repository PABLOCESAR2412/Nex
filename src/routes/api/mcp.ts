import { createFileRoute } from "@tanstack/react-router";
import { getCookie } from "@tanstack/react-start/server";
import { getDb } from "../../lib/db";

const SESSION_COOKIE = "__Host-nex_session";

async function getSessionUserId(): Promise<string | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const db = getDb();
  const row = await db.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").bind(token).first<{ user_id: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row.user_id;
}

const TOOLS = [
  {
    name: "list_content",
    description: "List content items for the authenticated user.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_content",
    description: "Create a new content item.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string" },
        channels: { type: "string" },
      },
      required: ["title"],
    },
  },
];

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getSessionUserId();
        if (!userId) {
          return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }, { status: 401 });
        }
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, { status: 400 });
        }
        const { method, params, id } = body ?? {};
        if (method === "initialize") {
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "nex-mcp", version: "0.1.0" },
            },
          });
        }
        if (method === "tools/list") {
          return Response.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        }
        if (method === "tools/call") {
          const toolName = params?.name;
          const args = params?.arguments ?? {};
          try {
            if (toolName === "list_content") {
              const db = getDb();
              const { results } = await db.prepare("SELECT id, title, description, type, state, channels, created_at FROM content_items WHERE user_id = ? ORDER BY updated_at DESC").bind(userId).all();
              return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(results ?? []) }] } });
            }
            if (toolName === "create_content") {
              const db = getDb();
              const newId = crypto.randomUUID();
              await db.prepare("INSERT INTO content_items (id, user_id, title, description, type, channels) VALUES (?, ?, ?, ?, ?, ?)").bind(newId, userId, args.title, args.description ?? null, args.type ?? "video", args.channels ?? null).run();
              return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ id: newId }) }] } });
            }
            return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${toolName}` } });
          } catch (e) {
            return Response.json({ jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : "Error" } });
          }
        }
        return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
      },
      GET: async () => {
        return Response.json({ ok: true, name: "nex-mcp", tools: TOOLS.map((t) => t.name) });
      },
    },
  },
});