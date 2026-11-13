// The interface-facing API shared by the CLI and the MCP server (docs/06: same inputs, same numbers, same breakdowns).
// Pure: callers pass parsed builds, game data and the ruleset. Every result carries patch, assumptionsUsed and credit.
import { ASSUMPTIONS, type AssumptionId } from "./assumptions.ts";
import { listAttacks, resolveAttack, type AttackChoice, type AttackListing } from "./attacks/attacks.ts";
import { explainAttack, computeHitBothWays, type AttackResult, type BothWays } from "./duel/attack-result.ts";
import { prepareFighter, type Fighter } from "./duel/fighter.ts";
import type { ScenarioName, ScenarioOptions } from "./effects/effects.ts";
import { footer, resultMeta } from "./explain/explain.ts";
import type { GameData } from "./game-data.ts";
import { computeTrade, type TradeOptions, type TradeResult } from "./interaction/trade.ts";
import { checkLegality, type LadderRuleset, type LegalityReport } from "./legality/ladder.ts";
import { parseRlRange, sweepRuneLevel, type SweepResult } from "./sweep/sweep.ts";
import { EngineError, type Build, type ResultMeta, type StatKey } from "./types.ts";

export interface SideOverrides {
  buffs?: string[];
  talismans?: string[];
  tears?: string[];
  /** Current HP %, 1–100. */
  hpPct?: number;
}

export interface CommonOptions {
  scenario?: ScenarioName;
  a?: SideOverrides;
  b?: SideOverrides;
  /** Skip ladder legality (results are flagged). */
  ignoreRules?: boolean;
}

export interface Context {
  data: GameData;
  ruleset: LadderRuleset;
}

const scenarioFor = (common: CommonOptions, side: SideOverrides | undefined): ScenarioOptions => ({
  scenario: common.scenario ?? "base",
  ...(side?.buffs?.length && { extraBuffs: side.buffs }),
  ...(side?.talismans?.length && { extraTalismans: side.talismans }),
  ...(side?.tears?.length && { extraTears: side.tears }),
  ...(side?.hpPct !== undefined && { hpFraction: side.hpPct / 100 }),
});

export interface LegalityGate {
  checked: boolean;
  /** Present when ignoreRules was used: the violations that were skipped. */
  ignoredViolations?: string[];
  reports: { side: "A" | "B"; report: LegalityReport }[];
}

/** Ladder legality first (docs/06). Throws an EngineError naming the rule unless ignoreRules. */
function gate(ctx: Context, sides: { side: "A" | "B"; fighter: Fighter; attack?: AttackChoice }[], ignoreRules: boolean | undefined, opts: { skipRuneLevel?: boolean } = {}): LegalityGate {
  const reports = sides.map(({ side, fighter, attack }) => ({
    side,
    report: checkLegality(ctx.ruleset, { data: ctx.data, fighter, ...(attack && { attack: resolveAttack(ctx.data, fighter.build, attack) }) }),
  }));
  const problems = reports.flatMap(({ side, report }) => [
    ...report.violations.map((v) => `${side}: ${v.rule} — ${v.detail}`),
    ...(!opts.skipRuneLevel && !report.runeLevel.ok ? [`${side}: rune level must be ${report.runeLevel.required} (is ${report.runeLevel.actual})`] : []),
  ]);
  if (problems.length && !ignoreRules) throw new EngineError(`Not legal under ${ctx.ruleset.name}:\n- ${problems.join("\n- ")}\n(use ignore-rules to calculate anyway; results will be flagged)`, "illegal-setup");
  return { checked: !ignoreRules, ...(ignoreRules && problems.length && { ignoredViolations: problems }), reports };
}

// ---- attacks ------------------------------------------------------------------------------------
export function apiAttacks(ctx: Context, build: Build): { attacks: AttackListing[]; meta: ResultMeta } {
  return { attacks: listAttacks(ctx.data, build), meta: resultMeta(ctx.data.patch, []) };
}

// ---- hit ------------------------------------------------------------------------------------------
export interface HitRequest extends CommonOptions {
  choiceA: AttackChoice;
  /** B's attack; default = the same attack name. */
  choiceB?: AttackChoice;
}
export interface HitResponse extends BothWays {
  legality: LegalityGate;
}
export function apiHit(ctx: Context, a: Build, b: Build, req: HitRequest): HitResponse {
  const fa = prepareFighter(ctx.data, a, scenarioFor(req, req.a), a.name ?? "A");
  const fb = prepareFighter(ctx.data, b, scenarioFor(req, req.b), b.name ?? "B");
  const legality = gate(ctx, [{ side: "A", fighter: fa, attack: req.choiceA }, { side: "B", fighter: fb }], req.ignoreRules);
  return { ...computeHitBothWays(ctx.data, fa, fb, req.choiceA, req.choiceB), legality };
}

// ---- trade ----------------------------------------------------------------------------------------
export interface TradeRequest extends CommonOptions, TradeOptions {
  choiceA: AttackChoice;
  choiceB: AttackChoice;
}
export interface TradeResponse extends TradeResult {
  legality: LegalityGate;
}
export function apiTrade(ctx: Context, a: Build, b: Build, req: TradeRequest): TradeResponse {
  const fa = prepareFighter(ctx.data, a, scenarioFor(req, req.a), a.name ?? "A");
  const fb = prepareFighter(ctx.data, b, scenarioFor(req, req.b), b.name ?? "B");
  const legality = gate(ctx, [{ side: "A", fighter: fa, attack: req.choiceA }, { side: "B", fighter: fb, attack: req.choiceB }], req.ignoreRules);
  return { ...computeTrade(ctx.data, fa, fb, req.choiceA, req.choiceB, req), legality };
}

// ---- sweep ----------------------------------------------------------------------------------------
export interface SweepRequest extends CommonOptions {
  choiceA: AttackChoice;
  choiceB: AttackChoice;
  statA?: StatKey;
  statB?: StatKey;
  rlA?: string;
  rlB?: string;
}
export function apiSweep(ctx: Context, a: Build, b: Build, req: SweepRequest): SweepResult & { legality: LegalityGate } {
  // RL is the variable under study, so the RL-125 rule is skipped here; every other ladder rule still applies.
  const fa = prepareFighter(ctx.data, a, scenarioFor(req, req.a), "A");
  const fb = prepareFighter(ctx.data, b, scenarioFor(req, req.b), "B");
  const legality = gate(ctx, [{ side: "A", fighter: fa, attack: req.choiceA }, { side: "B", fighter: fb, attack: req.choiceB }], req.ignoreRules, { skipRuneLevel: true });
  const res = sweepRuneLevel(ctx.data, a, b, {
    a: { ...(req.statA && { stat: req.statA }), ...(req.rlA && { rls: parseRlRange(req.rlA) }) },
    b: { ...(req.statB && { stat: req.statB }), ...(req.rlB && { rls: parseRlRange(req.rlB) }) },
    scenario: scenarioFor(req, req.a),
    choiceA: req.choiceA,
    choiceB: req.choiceB,
  });
  return { ...res, legality };
}

// ---- legality ----------------------------------------------------------------------------------
export function apiLegal(ctx: Context, build: Build, scenario: ScenarioName = "duel-start"): LegalityReport & { equipLoad: Fighter["equipLoad"]; meta: ResultMeta } {
  const f = prepareFighter(ctx.data, build, { scenario });
  return { ...checkLegality(ctx.ruleset, { data: ctx.data, fighter: f }), equipLoad: f.equipLoad, meta: resultMeta(ctx.data.patch, []) };
}

// ---- assumptions ---------------------------------------------------------------------------------
export function apiAssumptions() {
  return Object.values(ASSUMPTIONS).map((a) => ({ id: a.id, question: a.question, choice: a.choice, alternative: a.alternative, status: a.status, reason: a.reason, source: a.source ?? null }));
}

// ---- text rendering (CLI tables; MCP returns JSON + this text) -----------------------------------
const flagLine = (g: LegalityGate) => (g.ignoredViolations?.length ? [`⚠ ignore-rules: NOT LADDER-LEGAL — ${g.ignoredViolations.join("; ")}`] : []);
const attackLine = (r: AttackResult | { unavailable: string }) =>
  "unavailable" in r ? r.unavailable : `${r.attacker} → ${r.defender}: ${r.attack.name} = ${r.total ?? "unknown"} damage (${r.hits.map((h) => h.damage ?? "?").join(" + ")}), poise damage ${r.poiseDamage}`;

export function renderHit(r: HitResponse, breakdown = false): string {
  const lines = [...r.meta.warnings, ...flagLine(r.legality), attackLine(r.aToB), attackLine(r.bToA)];
  for (const side of [r.aToB, r.bToA]) if (!("unavailable" in side)) for (const h of side.hits) for (const w of [...h.warnings, ...(h.unknownReason ? [h.unknownReason] : [])]) lines.push(`  note: ${w}`);
  if (breakdown) for (const side of [r.aToB, r.bToA]) if (!("unavailable" in side)) lines.push("", ...explainAttack(side));
  return [...lines, "", ...footer(r.meta)].join("\n");
}

export function renderTrade(r: TradeResponse, breakdown = false): string {
  const v = r.verdict;
  const head = v.kind === "trade" ? `TRADE — ${v.summary}` : v.kind === "no-trade" ? `NO TRADE: ${v.winner} wins — ${v.summary}` : `UNKNOWN — ${v.reason}`;
  const side = (name: string, s: TradeResult["a"]) => {
    const p = s.poiseWhenHit;
    const poise = !p ? "not hit" : p.kind === "super-armour" ? "super armour" : p.kind === "unknown" ? `unknown (${p.reason})` : `${p.kind === "hyper-armour" ? "HA " : ""}${p.poise.toFixed(1)} poise`;
    return [
      `${name} ${s.label}: ${s.attack} — hit frame ${s.timing.hitFrame} (startup ${s.timing.startupFrame}, shown ${s.timing.startupFrame + ASSUMPTIONS.A2.choice.displayOffset}f; input delay ${s.timing.inputDelay}; offset ${s.timing.offset})`,
      `   damage dealt: ${s.landed ? (s.damage?.total ?? "unknown") : "— (staggered first)"}${s.counterHitOnOther ? " [counter hit]" : ""}; poise damage ${s.poiseDamageDealt}${s.staggeredOther ? " → staggers" : ""}; own poise when hit: ${poise}`,
      `   hits to kill: ${s.hitsToKill?.attacks ?? "unknown"}${s.hitsToKill?.steps.some((x) => x.event) ? ` (${s.hitsToKill.steps.filter((x) => x.event).map((x) => x.event).join("; ")})` : ""}`,
      ...(s.poiseToTankFollowUps.length ? [`   poise to tank follow-ups: ${s.poiseToTankFollowUps.map((f) => `hit ${f.hit} ≥ ${f.poiseNeeded}`).join(", ")}`] : []),
    ];
  };
  const lines = [...r.meta.warnings, ...flagLine(r.legality), head, ...side("A", r.a), ...side("B", r.b), "", ...r.caveats.map((c) => `caveat: ${c}`)];
  if (breakdown) for (const s of [r.a.damage, r.b.damage]) if (s) lines.push("", ...explainAttack(s));
  return [...lines, "", ...footer(r.meta)].join("\n");
}

export function renderSweep(r: SweepResult & { legality: LegalityGate }): string {
  const head = ["RL A", "RL B", "stat A", "stat B", "A→B", "B→A", "HTK A→B", "HTK B→A", "verdict", "note"];
  const rows = r.rows.map((x) => [
    x.rlA, x.rlB, x.statA ? `${x.statA.stat} ${x.statA.value}` : "", x.statB ? `${x.statB.stat} ${x.statB.value}` : "",
    x.aToB ?? "—", x.bToA ?? "—", x.htkAtoB ?? "—", x.htkBtoA ?? "—", x.verdict ?? "invalid", x.invalidReason ?? "",
  ].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [...r.meta.warnings, ...flagLine(r.legality), fmt(head), ...rows.map(fmt), "", ...footer(r.meta)].join("\n");
}

export function renderLegal(r: ReturnType<typeof apiLegal>): string {
  const lines = [
    `${r.legal ? "LEGAL" : "NOT LEGAL"} under ${r.ruleset}`,
    `Rune level: ${r.runeLevel.actual} (${r.runeLevel.ok ? "ok" : `must be ${r.runeLevel.required}`})`,
    `Equip load: ${r.equipLoad.weight.toFixed(1)} / ${r.equipLoad.max.toFixed(1)} = ${r.equipLoad.percent.toFixed(1)}% (${r.equipLoad.roll})`,
    ...r.violations.map((v) => `✗ ${v.rule}: ${v.detail}`),
    `Not checked by the calculator (${r.notChecked.length}): ${r.notChecked.map((n) => n.rule.split(" (")[0]).join("; ")}`,
  ];
  return [...lines, "", ...footer(r.meta)].join("\n");
}

export function renderAttacks(r: ReturnType<typeof apiAttacks>): string {
  const lines: string[] = [];
  for (const l of r.attacks) {
    lines.push(`${l.hand} hand slot ${l.slot + 1}: ${l.weapon}${l.skill ? ` (skill: ${l.skill})` : ""}`);
    for (const a of l.attacks) lines.push(`  ${a.name}${a.hits > 1 ? `  [${a.hits} hits]` : ""}${a.type === "WeaponSkill" ? "  (skill)" : ""}`);
  }
  return [...lines, "", ...footer(r.meta)].join("\n");
}

export function renderAssumptions(): string {
  return apiAssumptions().map((a) => `${a.id} [${a.status}] ${a.question}\n   choice: ${JSON.stringify(a.choice)}\n   ${a.reason}`).join("\n");
}

export type { AssumptionId };
