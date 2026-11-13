// Local MCP over stdio (Claude Code, Claude desktop). stdout is the protocol channel: log to stderr only.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, selfTest } from "./server.ts";

const health = selfTest();
if (!health.ok) {
  console.error(`er-trade-calc: ${health.detail}`);
  process.exit(1);
}
await createServer().connect(new StdioServerTransport());
console.error(`er-trade-calc MCP (stdio) ready — ${health.detail}`);
