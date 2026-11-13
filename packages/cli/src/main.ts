#!/usr/bin/env node
// `ertc` — thin CLI over the engine API (docs/06). Readable tables by default, --json for machines, --breakdown for the full chain.
import { readFileSync } from "node:fs";
import { Command, Option } from "commander";
import { loadBuild } from "@ertc/builds";
import { findFormulaSection, formulaSections, loadGameData, loadLadderRuleset } from "@ertc/data";
import {
  apiAssumptions, apiAttacks, apiHit, apiLegal, apiSweep, apiTrade, CREDIT_LINE, EngineError,
  renderAssumptions, renderAttacks, renderHit, renderLegal, renderSweep, renderTrade,
  type AttackChoice, type Build, type CommonOptions, type Context, type ScenarioName, type SideOverrides, type StatKey,
} from "@ertc/engine";

const ctx = (): Context => ({ data: loadGameData(), ruleset: loadLadderRuleset() });

function readBuild(path: string, c: Context): Build {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new EngineError(`Can't read build file ${path}: ${(e as Error).message}`, "invalid-build");
  }
  const { build, warnings } = loadBuild(text, (n) => c.data.weaponMeta.get(n)?.somber ?? false);
  for (const w of warnings) console.error(`warning (${path}): ${w}`);
  return { ...build, name: build.name ?? path.replace(/^.*\//, "").replace(/\.json$/, "") };
}

const list = (v: string, prev: string[] = []) => [...prev, v];
const int = (name: string) => (v: string) => {
  if (!/^-?\d+$/.test(v)) throw new EngineError(`${name} must be a whole number (got "${v}")`, "invalid-option");
  return Number(v);
};

type Opts = Record<string, unknown>;

function common(cmd: Command): Command {
  return cmd
    .addOption(new Option("--scenario <name>", "base | duel-start | low-hp").choices(["base", "duel-start", "low-hp"]).default("base"))
    .option("--buff <name>", "weapon buff on A (repeatable)", list)
    .option("--buff-b <name>", "weapon buff on B (repeatable)", list)
    .option("--grease <name>", "grease on A (repeatable)", list)
    .option("--grease-b <name>", "grease on B (repeatable)", list)
    .option("--talisman <name>", "extra talisman on A (repeatable)", list)
    .option("--talisman-b <name>", "extra talisman on B (repeatable)", list)
    .option("--tear <name>", "extra crystal tear on A (repeatable)", list)
    .option("--tear-b <name>", "extra crystal tear on B (repeatable)", list)
    .option("--hp-pct <n>", "A's current HP %", int("--hp-pct"))
    .option("--hp-pct-b <n>", "B's current HP %", int("--hp-pct-b"))
    .option("--ignore-rules", "calculate even if a setup is not ladder-legal (flagged)")
    .option("--json", "machine-readable JSON")
    .option("--breakdown", "full step-by-step breakdown");
}

function attackOptions(cmd: Command, side: "a" | "b", required: boolean): Command {
  const S = side.toUpperCase();
  const flag = `--${side} <attack>`;
  (required ? cmd.requiredOption(flag, `${S}'s attack (planner name, see \`ertc attacks\`)`) : cmd.option(flag, `${S}'s attack (default: same as A)`))
    .option(`--hits-${side} <which>`, `${S}'s hits that land: all | first | 1,2 | weapon | flat (blade/wind)`)
    .addOption(new Option(`--hand-${side} <hand>`, `${S}'s hand`).choices(["right", "left"]))
    .option(`--slot-${side} <n>`, `${S}'s weapon slot 1–3`, int(`--slot-${side}`))
    .addOption(new Option(`--grip-${side} <grip>`, `${S}'s grip while using a skill`).choices(["1h", "2h"]));
  return cmd;
}

const choice = (o: Opts, side: "a" | "b", fallback?: AttackChoice): AttackChoice => {
  const attack = (o[side] as string | undefined) ?? fallback?.attack;
  if (!attack) throw new EngineError(`--${side} <attack> is required`, "invalid-option");
  return {
    attack,
    ...(o[`hits${side.toUpperCase()}`] !== undefined && { hits: o[`hits${side.toUpperCase()}`] as string }),
    ...(o[`hand${side.toUpperCase()}`] !== undefined && { hand: o[`hand${side.toUpperCase()}`] as "right" | "left" }),
    ...(o[`slot${side.toUpperCase()}`] !== undefined && { slot: (o[`slot${side.toUpperCase()}`] as number) - 1 }),
    ...(o[`grip${side.toUpperCase()}`] !== undefined && { grip: o[`grip${side.toUpperCase()}`] as "1h" | "2h" }),
  };
};

const side = (o: Opts, suffix: "" | "B"): SideOverrides => ({
  buffs: [...((o[`buff${suffix}`] as string[]) ?? []), ...((o[`grease${suffix}`] as string[]) ?? [])],
  talismans: (o[`talisman${suffix}`] as string[]) ?? [],
  tears: (o[`tear${suffix}`] as string[]) ?? [],
  ...(o[`hpPct${suffix}`] !== undefined && { hpPct: o[`hpPct${suffix}`] as number }),
});
const commonOpts = (o: Opts): CommonOptions => ({ scenario: o.scenario as ScenarioName, a: side(o, ""), b: side(o, "B"), ignoreRules: !!o.ignoreRules });

const out = (o: Opts, json: unknown, text: string) => console.log(o.json ? JSON.stringify(json, null, 2) : text);

const program = new Command("ertc")
  .description("Elden Ring PvP trade calculator (ERPvP ladder, PC, patch 1.17).")
  .addHelpText("after", `\n${CREDIT_LINE}`)
  .showHelpAfterError();

program
  .command("attacks <build>")
  .description("list attacks available to this build (by weapon slot)")
  .option("--json", "machine-readable JSON")
  .action((path: string, o: Opts) => {
    const c = ctx();
    const r = apiAttacks(c, readBuild(path, c));
    out(o, r, renderAttacks(r));
  });

attackOptions(attackOptions(common(program.command("hit <A> <B>").description("one attack, A into B (and the same attack B into A if B can do it)")), "a", true), "b", false)
  .action((pa: string, pb: string, o: Opts) => {
    const c = ctx();
    const a = choice(o, "a");
    const r = apiHit(c, readBuild(pa, c), readBuild(pb, c), { ...commonOpts(o), choiceA: a, ...(o.b ? { choiceB: choice(o, "b") } : {}) });
    out(o, r, renderHit(r, !!o.breakdown));
  });

attackOptions(attackOptions(common(program.command("trade <A> <B>").description("verdict, both damages, poise outcome, frames, hits to kill")), "a", true), "b", true)
  .option("--offset <frames>", "B starts N frames after A (negative = before)", int("--offset"))
  .option("--input-delay-a <frames>", "A's input delay, frames (additive, default 0)", int("--input-delay-a"))
  .option("--input-delay-b <frames>", "B's input delay, frames (additive, default 0)", int("--input-delay-b"))
  .option("--poise-taken-a <n>", "poise damage A has already taken", Number)
  .option("--poise-taken-b <n>", "poise damage B has already taken", Number)
  .action((pa: string, pb: string, o: Opts) => {
    const c = ctx();
    const r = apiTrade(c, readBuild(pa, c), readBuild(pb, c), {
      ...commonOpts(o), choiceA: choice(o, "a"), choiceB: choice(o, "b"),
      ...(o.offset !== undefined && { offset: o.offset as number }),
      ...(o.inputDelayA !== undefined && { inputDelayA: o.inputDelayA as number }),
      ...(o.inputDelayB !== undefined && { inputDelayB: o.inputDelayB as number }),
      ...(o.poiseTakenA !== undefined && { poiseTakenA: o.poiseTakenA as number }),
      ...(o.poiseTakenB !== undefined && { poiseTakenB: o.poiseTakenB as number }),
    });
    out(o, r, renderTrade(r, !!o.breakdown));
  });

attackOptions(attackOptions(common(program.command("sweep <A> <B>").description("trade table across rune levels")), "a", true), "b", true)
  .addOption(new Option("--stat-a <stat>", "stat A's RL changes come from (default: A's main damage stat)").choices(["vig", "mnd", "end", "str", "dex", "int", "fth", "arc"]))
  .addOption(new Option("--take-from <stat>", "alias of --stat-a").choices(["vig", "mnd", "end", "str", "dex", "int", "fth", "arc"]))
  .addOption(new Option("--stat-b <stat>", "stat B's RL changes come from").choices(["vig", "mnd", "end", "str", "dex", "int", "fth", "arc"]))
  .option("--rl-a <range>", "A's RLs, e.g. 95..125 or 95..125:2")
  .option("--rl-b <range>", "B's RLs")
  .action((pa: string, pb: string, o: Opts) => {
    const c = ctx();
    const statA = (o.statA ?? o.takeFrom) as StatKey | undefined;
    const r = apiSweep(c, readBuild(pa, c), readBuild(pb, c), {
      ...commonOpts(o), choiceA: choice(o, "a"), choiceB: choice(o, "b"),
      ...(statA && { statA }), ...(o.statB !== undefined && { statB: o.statB as StatKey }),
      ...(o.rlA !== undefined && { rlA: o.rlA as string }), ...(o.rlB !== undefined && { rlB: o.rlB as string }),
    });
    out(o, r, renderSweep(r));
  });

program
  .command("legal <build>")
  .description("ladder legality report")
  .addOption(new Option("--scenario <name>", "which equipment counts").choices(["base", "duel-start", "low-hp"]).default("duel-start"))
  .option("--json", "machine-readable JSON")
  .action((path: string, o: Opts) => {
    const c = ctx();
    const r = apiLegal(c, readBuild(path, c), o.scenario as ScenarioName);
    out(o, r, renderLegal(r));
    if (!r.legal) process.exitCode = 1;
  });

program
  .command("explain [topic...]")
  .description("show a section of the public formulas guide (no topic = list sections); any command with --breakdown prints the full calculation")
  .action((topic: string[]) => {
    if (!topic.length) return console.log(formulaSections().map((s) => s.title).join("\n"));
    const s = findFormulaSection(topic.join(" "));
    console.log(s ? s.body : `No formulas section matches "${topic.join(" ")}".`);
  });

program
  .command("assumptions")
  .description("list A1–A9 with status")
  .option("--json", "machine-readable JSON")
  .action((o: Opts) => out(o, apiAssumptions(), `${renderAssumptions()}\n\n${CREDIT_LINE}`));

try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof EngineError) {
    console.error(`error: ${e.message}`);
    process.exitCode = 2;
  } else throw e; // fail loudly on bugs
}
