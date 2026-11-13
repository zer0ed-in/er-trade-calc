import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const golden = JSON.parse(readFileSync(ROOT + "fixtures/golden/damage.json", "utf8")).builds;
const dir = mkdtempSync(join(tmpdir(), "ertc-"));
const STR = join(dir, "str.json");
const DEX = join(dir, "dex.json");
writeFileSync(STR, JSON.stringify(golden["str-shamshir-125"]));
writeFileSync(DEX, JSON.stringify(golden["dex-shamshir-125"]));

const run = (...args: string[]) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, ["--import", "tsx", MAIN, ...args], { encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: err.stdout + err.stderr };
  }
};

describe("ertc CLI", () => {
  it("trade prints the verdict, both damages and the credit footer", () => {
    const r = run("trade", STR, DEX, "--a", "2h R1 1", "--b", "2h R1 1");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^TRADE/m);
    expect(r.out).toMatch(/damage dealt: 286/);
    expect(r.out).toMatch(/damage dealt: 243/);
    expect(r.out).toMatch(/Data: Emilia \(sovietspaceship\)/);
  });
  it("--json is machine-readable and carries meta", () => {
    const j = JSON.parse(run("hit", STR, DEX, "--a", "1h R1 1", "--json").out);
    expect([j.aToB.total, j.bToA.total]).toEqual([238, 230]);
    expect(j.meta.patch).toBe("1.17");
  });
  it("illegal setups exit non-zero naming the rule; --ignore-rules flags the result", () => {
    const bad = run("hit", STR, DEX, "--a", "1h R1 1", "--tear", "Thorny Cracked Tear");
    expect(bad.code).toBe(2);
    expect(bad.out).toMatch(/damage-boosting tears/);
    expect(run("hit", STR, DEX, "--a", "1h R1 1", "--tear", "Thorny Cracked Tear", "--ignore-rules").out).toMatch(/NOT LADDER-LEGAL/);
  });
  it("assumptions lists A1–A9", () => {
    const out = run("assumptions").out;
    for (const id of ["A1", "A3", "A8", "A9"]) expect(out).toContain(`${id} [`);
  });
});

describe("railway.json", () => {
  it("builds with a frozen lockfile, starts the HTTP server and health-checks /health", () => {
    const cfg = JSON.parse(readFileSync(ROOT + "railway.json", "utf8"));
    expect(cfg.build.buildCommand).toBe("pnpm install --frozen-lockfile");
    expect(cfg.deploy.startCommand).toBe("pnpm -s mcp:http");
    expect(cfg.deploy.healthcheckPath).toBe("/health");
    const pkg = JSON.parse(readFileSync(ROOT + "package.json", "utf8"));
    expect(pkg.scripts["mcp:http"]).toContain("packages/mcp-server/src/http.ts");
    expect(pkg.dependencies.tsx).toBeTruthy(); // runtime: NODE_ENV=production skips devDependencies
  });
});
