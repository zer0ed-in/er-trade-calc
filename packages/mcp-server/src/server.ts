// MCP server (docs/06): thin wrapper over the engine API. Builds come inline as JSON in tool arguments; nothing is stored.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadBuild } from "@ertc/builds";
import { findFormulaSection, formulaSections, loadGameData, loadLadderRuleset } from "@ertc/data";
import {
  apiAssumptions, apiAttacks, apiHit, apiLegal, apiSweep, apiTrade, CREDIT_LINE, EngineError,
  renderAttacks, renderHit, renderLegal, renderSweep, renderTrade,
  type AttackChoice, type Build, type CommonOptions, type Context, type SideOverrides,
} from "@ertc/engine";

const NEVER_INVENT =
  "Quote the engine's numbers exactly; never invent or adjust numbers. Mention the assumptions listed in assumptionsUsed when answering.";

// ---- shared input schemas --------------------------------------------------------------------------
const buildInput = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .describe("A build: the JSON exported from Emilia's ER Build Planner (object, JSON string or base64), or a neutral build {class, stats{vig,mnd,end,str,dex,int,fth,arc}, rightHand[{weapon,infusion,upgrade,ashOfWar?}], armour{head,body,arms,legs}, talismans[], buffs[]}.");

const attackInput = z.object({
  attack: z.string().describe("Planner attack name, e.g. \"2h R1 1\", \"1h R2 1 Release\", \"Storm Blade - Wind Slash 1\". Use list_attacks to get valid names."),
  hits: z.string().optional().describe("Which hits landed: all (default) | first | 1,2 | weapon | flat (aliases blade, wind, projectile)."),
  hand: z.enum(["right", "left"]).optional(),
  slot: z.number().int().min(1).max(3).optional().describe("Weapon slot 1–3 in that hand (default 1)."),
  grip: z.enum(["1h", "2h"]).optional().describe("Grip while using a skill (ashes never get the 2H damage bonus)."),
});

const sideInput = z
  .object({
    buffs: z.array(z.string()).optional().describe("Weapon buffs/greases, e.g. \"Sacred Blade\", \"Drawstring Dragonbolt Grease\"."),
    talismans: z.array(z.string()).optional(),
    tears: z.array(z.string()).optional(),
    hpPct: z.number().min(1).max(100).optional().describe("Current HP %."),
  })
  .optional();

const commonShape = {
  scenario: z.enum(["base", "duel-start", "low-hp"]).optional().describe("base = armour only (default); duel-start = full HP with talismans + tears; low-hp = 50% HP, full-HP effects off."),
  overridesA: sideInput,
  overridesB: sideInput,
  ignoreRules: z.boolean().optional().describe("Calculate even if not ladder-legal (results are flagged)."),
};

type AttackIn = z.infer<typeof attackInput>;
const toChoice = (a: AttackIn): AttackChoice => ({
  attack: a.attack,
  ...(a.hits !== undefined && { hits: a.hits }),
  ...(a.hand !== undefined && { hand: a.hand }),
  ...(a.slot !== undefined && { slot: a.slot - 1 }),
  ...(a.grip !== undefined && { grip: a.grip }),
});
const toCommon = (x: { scenario?: CommonOptions["scenario"]; overridesA?: SideOverrides; overridesB?: SideOverrides; ignoreRules?: boolean }): CommonOptions => ({
  ...(x.scenario && { scenario: x.scenario }),
  ...(x.overridesA && { a: x.overridesA }),
  ...(x.overridesB && { b: x.overridesB }),
  ...(x.ignoreRules !== undefined && { ignoreRules: x.ignoreRules }),
});

// ---- result helpers ------------------------------------------------------------------------------
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function respond(summary: string, json: unknown): ToolResult {
  return { content: [{ type: "text", text: summary }, { type: "text", text: JSON.stringify(json) }] };
}

/** Engine errors are user-facing (bad attack name, illegal setup…) → tool error, not a crash. Bugs still throw. */
function guard(fn: () => ToolResult): ToolResult {
  try {
    return fn();
  } catch (e) {
    if (e instanceof EngineError) return { content: [{ type: "text", text: `Error (${e.code}): ${e.message}` }], isError: true };
    throw e;
  }
}

export function createServer(): McpServer {
  const ctx: Context = { data: loadGameData(), ruleset: loadLadderRuleset() };
  const build = (input: unknown, label: string): Build => {
    const { build: b, warnings } = loadBuild(input, (n) => ctx.data.weaponMeta.get(n)?.somber ?? false);
    if (warnings.length) b.name = `${b.name ?? label} (warnings: ${warnings.join("; ")})`;
    return { ...b, name: b.name ?? label };
  };

  const server = new McpServer({ name: "er-trade-calc", version: "1.0.0" }, { instructions: `Elden Ring PvP trade calculator (ERPvP ladder, PC, patch ${ctx.data.patch}). ${NEVER_INVENT} ${CREDIT_LINE}` });

  server.registerTool(
    "list_attacks",
    { title: "List attacks", description: `Attacks a build can perform, by hand and weapon slot, using the planner's attack names. Call this before compute_hit/compute_trade to get valid attack names. ${NEVER_INVENT}`, inputSchema: { build: buildInput } },
    (args) => guard(() => {
      const r = apiAttacks(ctx, build(args.build, "build"));
      return respond(renderAttacks(r), r);
    }),
  );

  server.registerTool(
    "compute_hit",
    {
      title: "Compute one attack both ways",
      description: `Damage of one attack from build A into build B, and the same attack (or attackB) from B into A, with per-hit numbers. Set breakdown for the full step-by-step. ${NEVER_INVENT}`,
      inputSchema: { buildA: buildInput, buildB: buildInput, attackA: attackInput, attackB: attackInput.optional(), breakdown: z.boolean().optional(), ...commonShape },
    },
    (args) => guard(() => {
      const r = apiHit(ctx, build(args.buildA, "A"), build(args.buildB, "B"), { ...toCommon(args), choiceA: toChoice(args.attackA), ...(args.attackB && { choiceB: toChoice(args.attackB) }) });
      return respond(renderHit(r, !!args.breakdown), r);
    }),
  );

  server.registerTool(
    "compute_trade",
    {
      title: "Compute a trade",
      description: `Two builds, one attack each: verdict (trade / no trade: X wins / unknown: reason), damage both ways, poise outcome, frames, hits to kill, breakdown. Timing: offset = B starts N frames after A; input delays are additive frames (default 0). ${NEVER_INVENT}`,
      inputSchema: {
        buildA: buildInput, buildB: buildInput, attackA: attackInput, attackB: attackInput,
        offset: z.number().int().optional(), inputDelayA: z.number().int().min(0).optional(), inputDelayB: z.number().int().min(0).optional(),
        poiseTakenA: z.number().min(0).optional(), poiseTakenB: z.number().min(0).optional(),
        breakdown: z.boolean().optional(), ...commonShape,
      },
    },
    (args) => guard(() => {
      const r = apiTrade(ctx, build(args.buildA, "A"), build(args.buildB, "B"), {
        ...toCommon(args), choiceA: toChoice(args.attackA), choiceB: toChoice(args.attackB),
        ...(args.offset !== undefined && { offset: args.offset }),
        ...(args.inputDelayA !== undefined && { inputDelayA: args.inputDelayA }),
        ...(args.inputDelayB !== undefined && { inputDelayB: args.inputDelayB }),
        ...(args.poiseTakenA !== undefined && { poiseTakenA: args.poiseTakenA }),
        ...(args.poiseTakenB !== undefined && { poiseTakenB: args.poiseTakenB }),
      });
      return respond(renderTrade(r, !!args.breakdown), r);
    }),
  );

  const statEnum = z.enum(["vig", "mnd", "end", "str", "dex", "int", "fth", "arc"]);
  server.registerTool(
    "sweep_rune_level",
    {
      title: "Rune-level sweep",
      description: `Trade table across rune levels for one or both builds. RL changes add/remove points in each build's main damage stat by default (statA/statB to change). Ranges like "95..125" or "95..125:2". The RL-125 rule is not enforced here; other ladder rules are. ${NEVER_INVENT}`,
      inputSchema: { buildA: buildInput, buildB: buildInput, attackA: attackInput, attackB: attackInput, rlA: z.string().optional(), rlB: z.string().optional(), statA: statEnum.optional(), statB: statEnum.optional(), ...commonShape },
    },
    (args) => guard(() => {
      const r = apiSweep(ctx, build(args.buildA, "A"), build(args.buildB, "B"), {
        ...toCommon(args), choiceA: toChoice(args.attackA), choiceB: toChoice(args.attackB),
        ...(args.rlA && { rlA: args.rlA }), ...(args.rlB && { rlB: args.rlB }), ...(args.statA && { statA: args.statA }), ...(args.statB && { statB: args.statB }),
      });
      return respond(renderSweep(r), r);
    }),
  );

  server.registerTool(
    "check_legality",
    { title: "Ladder legality", description: "Check a build against the ERPvP ladder ruleset (bans, buff restrictions, RL 125, light load). Lists rules the calculator can't check.", inputSchema: { build: buildInput, scenario: commonShape.scenario } },
    (args) => guard(() => {
      const r = apiLegal(ctx, build(args.build, "build"), args.scenario ?? "duel-start");
      return respond(renderLegal(r), r);
    }),
  );

  server.registerTool(
    "explain_formula",
    {
      title: "Explain a formula",
      description: "Returns the relevant section of the public formulas guide (docs/public/formulas.md), e.g. topic \"defence curve\", \"two-handing\", \"counter hits\". Empty topic lists the sections.",
      inputSchema: { topic: z.string().optional() },
    },
    (args) => guard(() => {
      if (!args.topic?.trim()) return respond(formulaSections().map((s) => s.title).join("\n"), { sections: formulaSections().map((s) => s.title), credit: CREDIT_LINE });
      const s = findFormulaSection(args.topic);
      return respond(s ? `${s.body}\n\n${CREDIT_LINE}` : `No section matches "${args.topic}".`, { section: s, credit: CREDIT_LINE });
    }),
  );

  server.registerTool(
    "list_assumptions",
    { title: "List assumptions", description: "A1–A9 with status (assumed/confirmed), so answers can be caveated. Results name the unconfirmed ones they used in assumptionsUsed.", inputSchema: {} },
    () => guard(() => {
      const list = apiAssumptions();
      return respond(list.map((a) => `${a.id} [${a.status}] ${a.question} — ${a.reason}`).join("\n"), { assumptions: list, patch: ctx.data.patch, assumptionsUsed: [], credit: CREDIT_LINE });
    }),
  );

  return server;
}

/** Startup self-test for /health: data loaded and the planner-verified 286/243 reproduce. */
export function selfTest(): { ok: boolean; detail: string } {
  try {
    const ctx: Context = { data: loadGameData(), ruleset: loadLadderRuleset() };
    const armour = { head: "Verdigris Helm", body: "Verdigris Armor", arms: "Verdigris Gauntlets", legs: "Verdigris Greaves" };
    const mk = (str: number, dex: number, infusion: string): Build => ({ class: "Heavy Knight", stats: { vig: 60, mnd: 8, end: 40, str, dex, int: 7, fth: 8, arc: 9 }, rightHand: [{ weapon: "Shamshir", infusion, upgrade: 25 }], armour, talismans: [], buffs: [] });
    const r = apiHit(ctx, mk(59, 13, "Heavy"), mk(15, 57, "Keen"), { choiceA: { attack: "2h R1 1" } });
    const a = "total" in r.aToB ? r.aToB.total : null;
    const b = "total" in r.bToA ? r.bToA.total : null;
    return a === 286 && b === 243 ? { ok: true, detail: "golden 286/243 reproduced" } : { ok: false, detail: `self-test got ${a}/${b}, expected 286/243` };
  } catch (e) {
    return { ok: false, detail: `self-test failed: ${(e as Error).message}` };
  }
}
