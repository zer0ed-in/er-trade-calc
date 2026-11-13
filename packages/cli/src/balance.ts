// `ertc balance <setups.yaml>` — the balance search (docs/10). Local only: reads the YAML, runs the pure engine search,
// writes the markdown report and the bulk table to reports/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { parse } from "yaml";
import { loadGameData, loadLadderRuleset } from "@ertc/data";
import {
  BalanceEvaluator, balanceReport, bulkTable, CREDIT_LINE, DEFAULT_BALANCE_CONFIG, EngineError, expandSetups, searchBalance, validateSetupsDoc,
  type AttackClass, type BalanceConfig, type View,
} from "@ertc/engine";

const num = (name: string) => (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new EngineError(`${name} must be a number (got "${v}")`, "invalid-option");
  return n;
};

/** Lines of one "## " section of the report. */
const section = (report: string, heading: string) => {
  const start = report.indexOf(heading);
  if (start < 0) return [];
  const rest = report.slice(start + heading.length);
  const end = rest.indexOf("\n## ");
  return (end < 0 ? rest : rest.slice(0, end)).split("\n");
};

export function registerBalance(program: Command) {
  program
    .command("balance <setups>")
    .description("balance search over setups.yaml: Mirror/Cross views, candidate rules, markdown report in reports/")
    .option("--rl-min <n>", "lowest RL searched", num("--rl-min"), DEFAULT_BALANCE_CONFIG.rlMin)
    .option("--rl-max <n>", "highest RL searched", num("--rl-max"), DEFAULT_BALANCE_CONFIG.rlMax)
    .option("--rl-step <n>", "RL grid step", num("--rl-step"), DEFAULT_BALANCE_CONFIG.rlStep)
    .option("--max-ratio <x>", "honesty rule: worst damage ratio allowed", num("--max-ratio"), DEFAULT_BALANCE_CONFIG.maxRatio)
    .option("--max-htk-gap <n>", "honesty rule: HTK gap that counts as uneven", num("--max-htk-gap"), DEFAULT_BALANCE_CONFIG.maxHtkGap)
    .option("--outlier <x>", "ban candidates: class damage ≥ (1 + x) × the best other combo", num("--outlier"), DEFAULT_BALANCE_CONFIG.outlierThreshold)
    .option("--max-bans <n>", "most outlier bans the greedy pass adds", num("--max-bans"), DEFAULT_BALANCE_CONFIG.maxBans)
    .option("--objective <views>", "views the objective covers: normal,ash | normal | ash", "normal,ash")
    .option("--weight <class=w>", "attack-class weight, e.g. \"full ash=0.5\" (repeatable)", (v: string, prev: string[] = []) => [...prev, v])
    .option("--ash-casts <n>", "ash casts per round for the FP-weighted view", num("--ash-casts"), DEFAULT_BALANCE_CONFIG.ashCastsPerRound)
    .option("--out <dir>", "report directory", "reports")
    .action((setupsPath: string, o: Record<string, unknown>) => {
      const data = loadGameData();
      let text: string;
      try {
        text = readFileSync(setupsPath, "utf8");
      } catch (e) {
        throw new EngineError(`Can't read ${setupsPath}: ${(e as Error).message}`, "invalid-setups");
      }
      const doc = validateSetupsDoc(parse(text));
      const weights = { ...DEFAULT_BALANCE_CONFIG.weights };
      for (const w of (o.weight as string[] | undefined) ?? []) {
        const m = w.match(/^(.+)=([\d.]+)$/);
        if (!m) throw new EngineError(`--weight must look like "R1 chain=1" (got "${w}")`, "invalid-option");
        weights[m[1]!.trim() as AttackClass] = Number(m[2]);
      }
      const objective = String(o.objective).split(",").map((s) => s.trim()) as View[];
      if (!objective.length || objective.some((v) => v !== "normal" && v !== "ash")) throw new EngineError(`--objective must be normal, ash or normal,ash`, "invalid-option");
      const config: BalanceConfig = {
        ...DEFAULT_BALANCE_CONFIG, weights, objective,
        rlMin: o.rlMin as number, rlMax: o.rlMax as number, rlStep: o.rlStep as number,
        maxRatio: o.maxRatio as number, maxHtkGap: o.maxHtkGap as number, outlierThreshold: o.outlier as number,
        maxBans: o.maxBans as number, ashCastsPerRound: o.ashCasts as number,
      };
      const started = Date.now();
      const expansion = expandSetups(data, loadLadderRuleset(), doc);
      if (!expansion.variants.length) throw new EngineError("No legal setup variants; see the skipped list (run with fewer filters).", "invalid-setups");
      const ev = new BalanceEvaluator(data, expansion.variants, config);
      const bulk = bulkTable(ev);
      console.error(`expanded ${expansion.variants.length} variants (${expansion.skipped.length} skipped); bulk table ${bulk.summary.rows} rows; searching…`);
      const result = searchBalance(ev);
      const normalOnly = config.objective.includes("ash") ? searchBalance(ev, ["normal"]) : undefined;
      const date = new Date().toISOString().slice(0, 10);
      const dir = String(o.out);
      mkdirSync(dir, { recursive: true });
      const stem = `balance-${basename(setupsPath).replace(/\.ya?ml$/, "")}-${date}`;
      const tablePath = join(dir, `${stem}-table.json`);
      writeFileSync(tablePath, JSON.stringify({ config, rows: bulk.rows }) + "\n");
      const report = balanceReport({ ev, doc, expansion, result, ...(normalOnly && { normalOnly }), bulk: bulk.summary, date, setupsPath, tablePath });
      const reportPath = join(dir, `${stem}.md`);
      writeFileSync(reportPath, report);
      const verdict = report.match(/## Verdict\n\n([^\n]+)/)?.[1] ?? "";
      console.log([
        verdict.replace(/\*\*/g, ""),
        "",
        "Recommended rules:",
        ...section(report, "## Recommended rules").filter((l) => l.startsWith("- ")),
        ...(normalOnly ? ["", "Normal moveset only (no A3):", ...section(report, "## Normal moveset only").filter((l) => l.startsWith("- "))] : []),
        "",
        `${ev.notSupported.size} "Not supported right now" items; assumptions used: ${[...ev.assumptions].sort().join(", ") || "none"}`,
        `report: ${reportPath}  (${((Date.now() - started) / 1000).toFixed(1)} s, ${ev.rowsComputed} attack computations)`,
        "",
        CREDIT_LINE,
      ].join("\n"));
    });
}
