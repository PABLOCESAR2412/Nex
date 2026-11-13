import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getCurrentSession } from "../../lib/auth";
import { getDb } from "../../lib/db";

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
        script: { type: "string" },
        type: { type: "string" },
        channels: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "schedule_content",
    description: "Schedule one of the authenticated user's content items in the Nex calendar.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Content item ID returned by list_content or create_content." },
        scheduled_at: { type: "string", format: "date-time", description: "Future date and time in ISO 8601 format." },
      },
      required: ["id", "scheduled_at"],
    },
  },
];

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getCurrentSession();
        if (!session) {
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
              const { results } = await db.prepare("SELECT id, title, description, script, type, state, channels, asset_name, asset_content_type, asset_size, scheduled_at, created_at, updated_at FROM content_items WHERE user_id = ? ORDER BY updated_at DESC").bind(session.userId).all();
              return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(results ?? []) }] } });
            }
            if (toolName === "create_content") {
              if (typeof args.title !== "string" || !args.title.trim() || args.title.trim().length > 160) {
                return Response.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Title must contain 1 to 160 characters." } });
              }
              const description = typeof args.description === "string" ? args.description.trim().slice(0, 4000) : null;
              const script = typeof args.script === "string" ? args.script.slice(0, 20000) : null;
              const channels = typeof args.channels === "string" ? args.channels.trim().slice(0, 200) : null;
              const type = typeof args.type === "string" ? args.type.trim().slice(0, 40) || "video" : "video";
              const db = getDb();
              const newId = crypto.randomUUID();
              await db.prepare("INSERT INTO content_items (id, user_id, title, description, script, type, channels) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(newId, session.userId, args.title.trim(), description, script, type, channels).run();
              return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ id: newId }) }] } });
            }
            if (toolName === "schedule_content") {
              const parsedDate = z.string().datetime().safeParse(args.scheduled_at);
              if (typeof args.id !== "string" || !parsedDate.success) {
                return Response.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "A content ID and ISO date-time are required." } });
              }
              const date = new Date(parsedDate.data);
              if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
                return Response.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "The scheduled date must be in the future." } });
              }
              const result = await getDb()
                .prepare("UPDATE content_items SET state = 'programada', scheduled_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
                .bind(date.toISOString(), args.id, session.userId)
                .run();
              if (!result.meta.changes) return Response.json({ jsonrpc: "2.0", id, error: { code: -32004, message: "Content item not found." } });
              return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ ok: true, id: args.id, scheduled_at: date.toISOString() }) }] } });
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
