import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CREDIT_LINE } from "@ertc/engine";
import { createServer } from "../src/server.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const golden = JSON.parse(readFileSync(ROOT + "fixtures/golden/damage.json", "utf8")).builds;
const A = golden["str-shamshir-125"];
const B = golden["dex-shamshir-125"];

type Text = { type: string; text: string };
// callTool's result type is a union (legacy toolResult variant); our server always returns `content`.
const jsonOf = (r: unknown) => JSON.parse(((r as { content: Text[] }).content)[1]!.text);

describe("MCP tools (in-memory)", () => {
  let client: Client;
  beforeAll(async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await createServer().connect(st);
    client = new Client({ name: "test", version: "0" });
    await client.connect(ct);
  });
  afterAll(() => client.close());

  it("exposes the seven tools from docs/06", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_legality", "compute_hit", "compute_trade", "explain_formula", "list_assumptions", "list_attacks", "sweep_rune_level"]);
    for (const t of tools) expect(t.description).toBeTruthy();
  });
  it("compute_trade returns the planner-verified trade with patch, assumptionsUsed and credit", async () => {
    const r = await client.callTool({ name: "compute_trade", arguments: { buildA: A, buildB: B, attackA: { attack: "2h R1 1" }, attackB: { attack: "2h R1 1" } } });
    const j = jsonOf(r);
    expect(j.verdict.kind).toBe("trade");
    expect([j.a.damage.total, j.b.damage.total]).toEqual([286, 243]);
    expect(j.meta).toMatchObject({ patch: "1.17", credit: CREDIT_LINE });
    // The 2H R1 rows now resolve through BehaviorParam_PC, so the 2H flag comes from AtkParam, not A8.
    expect(j.meta.assumptionsUsed).toEqual(expect.any(Array));
    expect(j.meta.assumptionsUsed).not.toContain("A8");
  });
  it("compute_hit accepts builds as JSON strings and returns both directions", async () => {
    const j = jsonOf(await client.callTool({ name: "compute_hit", arguments: { buildA: JSON.stringify(A), buildB: B, attackA: { attack: "1h R1 1" } } }));
    expect([j.aToB.total, j.bToA.total]).toEqual([238, 230]);
  });
  it("engine errors come back as tool errors naming the problem", async () => {
    const r = await client.callTool({ name: "compute_hit", arguments: { buildA: A, buildB: B, attackA: { attack: "nope" } } });
    expect(r.isError).toBe(true);
    expect((r.content as Text[])[0]!.text).toMatch(/can't do "nope"/);
    const illegal = await client.callTool({ name: "compute_hit", arguments: { buildA: A, buildB: B, attackA: { attack: "1h R1 1" }, overridesA: { talismans: ["Shard of Alexander"] } } });
    expect((illegal.content as Text[])[0]!.text).toMatch(/Shard of Alexander/);
  });
  it("list_attacks, sweep, legality, assumptions, explain all answer", async () => {
    expect(jsonOf(await client.callTool({ name: "list_attacks", arguments: { build: A } })).attacks[0].weapon).toBe("Shamshir");
    const sweep = jsonOf(await client.callTool({ name: "sweep_rune_level", arguments: { buildA: A, buildB: B, attackA: { attack: "2h R1 1" }, attackB: { attack: "2h R1 1" }, rlA: "107..109:2" } }));
    expect(sweep.rows.map((r: { aToB: number }) => r.aToB)).toEqual([250, 255]);
    expect(jsonOf(await client.callTool({ name: "check_legality", arguments: { build: A } })).legal).toBe(true);
    expect(jsonOf(await client.callTool({ name: "list_assumptions", arguments: {} })).assumptions).toHaveLength(10);
    expect((await client.callTool({ name: "explain_formula", arguments: { topic: "defence curve" } })).content).toBeTruthy();
  });
});

describe("MCP over Streamable HTTP (pnpm mcp:http)", () => {
  let proc: ChildProcess;
  let port: number;
  beforeAll(async () => {
    port = await new Promise<number>((resolve) => {
      const s = netServer().listen(0, () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
    });
    proc = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/http.ts", import.meta.url))], { env: { ...process.env, PORT: String(port) }, stdio: "pipe" });
    await new Promise<void>((resolve, reject) => {
      proc.stdout!.on("data", (d: Buffer) => d.toString().includes("POST /mcp") && resolve());
      proc.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
  }, 30_000);
  afterAll(() => proc?.kill());

  it("GET /health is 200 after the self-test", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
  });
  it("POST /mcp serves tools", async () => {
    const client = new Client({ name: "http-test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const j = jsonOf(await client.callTool({ name: "compute_trade", arguments: { buildA: A, buildB: B, attackA: { attack: "2h R1 1" }, attackB: { attack: "2h R1 1" } } }));
    expect([j.a.damage.total, j.b.damage.total]).toEqual([286, 243]);
    await client.close();
  });
  it("GET /mcp is rejected (stateless, POST only)", async () => {
    expect((await fetch(`http://127.0.0.1:${port}/mcp`)).status).toBe(405);
  });
});

describe("MCP over stdio — the exact command docs/setup.md gives to Claude Code", () => {
  it("`pnpm -s --dir <repo> mcp:stdio` speaks clean MCP on stdout", async () => {
    const client = new Client({ name: "stdio-test", version: "0" });
    await client.connect(new StdioClientTransport({ command: "pnpm", args: ["-s", "--dir", ROOT, "mcp:stdio"], stderr: "ignore" }));
    const j = jsonOf(await client.callTool({ name: "compute_hit", arguments: { buildA: A, buildB: B, attackA: { attack: "2h R1 1" } } }));
    expect([j.aToB.total, j.bToA.total]).toEqual([286, 243]);
    await client.close();
  }, 30_000);
});
