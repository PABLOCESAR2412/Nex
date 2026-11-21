import { createFileRoute } from "@tanstack/react-router";
import { handleMcpOptionsRequest, handleMcpRequest } from "../../lib/mcp-http";


export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => handleMcpRequest(request),
      GET: ({ request }) => handleMcpRequest(request),
      OPTIONS: ({ request }) => handleMcpOptionsRequest(request),
    },
  },
});
