// Hosted MCP over Streamable HTTP: POST /mcp (stateless — a fresh server+transport per request; nothing stored), GET /health.
// No auth in phase 1 (read-only calculator). Light per-IP rate limit. No CDN caching (POST + streaming).
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, selfTest } from "./server.ts";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY_BYTES = 2 * 1024 * 1024; // two builds inline fit easily
const RATE = { windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60) };

// Health is computed once at startup: 200 only after data is loaded and the engine self-test passes (docs/02).
const health = selfTest();
console.log(`er-trade-calc: ${health.detail}`);

const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + RATE.windowMs });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    return false;
  }
  entry.count++;
  return entry.count > RATE.max;
}
const clientIp = (req: IncomingMessage) => (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const http = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") return json(res, health.ok ? 200 : 503, { ok: health.ok, detail: health.detail });
  if (url.pathname !== "/mcp") return json(res, 404, { error: "not found" });
  if (req.method !== "POST") return json(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: POST only)" }, id: null });
  if (!health.ok) return json(res, 503, { jsonrpc: "2.0", error: { code: -32000, message: health.detail }, id: null });
  if (rateLimited(clientIp(req))) return json(res, 429, { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests — try again in a minute" }, id: null });

  let body: unknown;
  try {
    body = await readJson(req);
  } catch (e) {
    return json(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: `Parse error: ${(e as Error).message}` }, id: null });
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error("MCP request failed:", e); // log the full error; the client gets a generic one
    if (!res.headersSent) json(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

http.listen(PORT, () => console.log(`er-trade-calc MCP (Streamable HTTP) on :${PORT} — POST /mcp, GET /health`));
