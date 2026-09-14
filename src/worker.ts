import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTechWeekServer } from "./server.js";
import { installPage } from "./install-page.js";

const MAX_REQUEST_BYTES = 64 * 1024;
const MCP_RATE_LIMIT_KEY_FALLBACK = "unknown-client";

type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

type Env = {
  MCP_RATE_LIMIT: RateLimitBinding;
};

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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(installPage(url.origin), {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "tech-week", version: "1.0.1" });
    }

    if (url.pathname !== "/mcp") {
      return json({ error: "Not found", mcp: `${url.origin}/mcp` }, 404);
    }

    const rateLimit = await env.MCP_RATE_LIMIT.limit({
      key: request.headers.get("CF-Connecting-IP") ?? MCP_RATE_LIMIT_KEY_FALLBACK,
    });
    if (!rateLimit.success) return json({ error: "Too many MCP requests" }, 429);

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
