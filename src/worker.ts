import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTechWeekServer } from "./server.js";

const MAX_REQUEST_BYTES = 64 * 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "sf-tech-week", version: "1.0.1" });
    }

    if (url.pathname !== "/mcp") {
      return json({ error: "Not found", mcp: `${url.origin}/mcp` }, 404);
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
      return json({ error: "Request body too large" }, 413);
    }

    try {
      // A fresh server and stateless transport keep concurrent Worker requests isolated.
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = createTechWeekServer();
      await server.connect(transport);
      return await transport.handleRequest(request);
    } catch (error) {
      console.error("MCP request failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "Internal server error" }, 500);
    }
  },
};
