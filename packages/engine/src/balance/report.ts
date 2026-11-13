// Balance search, step 6: the markdown report (the CLI writes it to reports/). Pure: date and file names come from the caller.
import { ASSUMPTIONS, unconfirmedAssumptions, type AssumptionId } from "../assumptions.ts";
import { A3_WARNING } from "../explain/explain.ts";
import { CREDIT_LINE } from "../credit.ts";
import { EngineError, notSupportedLine } from "../types.ts";
import { BASKET_CLASSES, EXTRA_CLASSES } from "./basket.ts";
import { LOUD_ASSUMPTIONS, NO_RULES, type BalanceEvaluator, type Matchup, type Rules, type SearchResult } from "./search.ts";
import type { Expansion, SetupsDoc } from "./setups.ts";

const r3 = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(3));
const ratioOf = (score: number) => Math.exp(score);

export interface BulkTableSummary { attackers: number; defenders: number; rows: number; unknownDamage: number }

/** Step 2: every attack (all classes) of every variant into every body at the reference RL, computed once. */
export function bulkTable(ev: BalanceEvaluator): { summary: BulkTableSummary; rows: Record<string, unknown>[] } {
  const bodies = [...new Map(ev.variants.map((v) => [v.body, v])).values()];
  const out: Record<string, unknown>[] = [];
  let unknown = 0;
  for (const v of ev.variants) for (const d of bodies) {
    const rows = ev.table(v, ev.rlFor(v, NO_RULES), d, ev.rlFor(d, NO_RULES), true);
    if (rows instanceof EngineError) continue;
    for (const r of rows) {
      if (r.damage === null) unknown++;
      out.push({ variant: v.id, defender: d.body, class: r.attack.class, attack: r.attack.attack, hits: r.attack.hits, damage: r.damage, perType: r.perType, poiseDamage: r.poiseDamage, startup: r.startup, hyperArmour: r.hyperArmour, status: r.status, ...(r.noFpDamage !== undefined && { noFpDamage: r.noFpDamage }), ...(r.notSupported && { notSupported: r.notSupported }) });
    }
  }
  return { summary: { attackers: ev.variants.length, defenders: bodies.length, rows: out.length, unknownDamage: unknown }, rows: out };
}

function rulesText(ev: BalanceEvaluator, rules: Rules): string[] {
  const lines: string[] = [];
  const stats = [...new Set(ev.variants.map((v) => v.damageStat))];
  for (const s of stats) {
    const base = rules.rl[s] ?? ev.config.referenceRl;
    const grips = ["1h", "2h"].filter((g) => rules.rlByGrip[`${s}|${g}`] !== undefined && rules.rlByGrip[`${s}|${g}`] !== base);
    lines.push(`- **${s}**: RL ${base}${grips.length ? ` (${grips.map((g) => `${g.toUpperCase()} ${rules.rlByGrip[`${s}|${g}`]}`).join(", ")})` : ""}`);
  }
  for (const b of rules.bans) lines.push(`- **ban**: ${b.label}`);
  return lines;
}

function matchupTable(ms: Matchup[], title: string): string[] {
  if (!ms.length) return [`_${title}: no matchups._`, ""];
  const classes = [...new Set(ms.flatMap((m) => m.perClass.map((p) => p.cls)))];
  const head = `| Setup | A (RL) | B (RL) | ${classes.map((c) => `${c} ratio / HTK gap`).join(" | ")} | worst ratio | round ratio (FP) |`;
  const sep = `|${"---|".repeat(5 + classes.length)}`;
  const rows = ms
    .slice()
    .sort((x, y) => y.score - x.score)
    .map((m) => {
      const cells = classes.map((c) => {
        const p = m.perClass.find((x) => x.cls === c);
        return p ? `${r3(p.ratio)} / ${p.htkGap ?? "—"}` : "—";
      });
      const side = (s: Matchup["a"]) => `${s.variant.id.split(" ").slice(1).join(" ")} — ${s.variant.body} (${s.rl})${m.view === "ash" && s.fpUses !== null ? `, FP uses ${s.fpUses}` : ""}`;
      return `| ${m.setup} | ${side(m.a)} | ${side(m.b)} | ${cells.join(" | ")} | ${r3(ratioOf(m.score))} | ${r3(m.roundRatio)} |`;
    });
  return [`**${title}**`, "", head, sep, ...rows, ""];
}

/** Body × body: worst ratio over the shared setups, per view. */
function bodyMatrix(ms: Matchup[], view: Matchup["view"]): string[] {
  const bodies = [...new Set(ms.flatMap((m) => [m.a.variant.body, m.b.variant.body]))];
  const worst = (x: string, y: string) => {
    const s = ms.filter((m) => m.view === view && ((m.a.variant.body === x && m.b.variant.body === y) || (m.a.variant.body === y && m.b.variant.body === x)));
    return s.length ? r3(ratioOf(Math.max(...s.map((m) => m.score)))) : "—";
  };
  return [`| ${view} | ${bodies.join(" | ")} |`, `|${"---|".repeat(bodies.length + 1)}`, ...bodies.map((x) => `| ${x} | ${bodies.map((y) => (x === y ? "·" : worst(x, y))).join(" | ")} |`), ""];
}

export function balanceReport(args: { ev: BalanceEvaluator; doc: SetupsDoc; expansion: Expansion; result: SearchResult; normalOnly?: SearchResult; bulk: BulkTableSummary; date: string; setupsPath: string; tablePath: string }): string {
  const { ev, expansion, result, bulk, normalOnly } = args;
  const cfg = ev.config;
  const refMs = ev.mirror(result.reference, true);
  const recMs = ev.mirror(result.recommended, true);
  const inObjective = (m: Matchup) => cfg.objective.includes(m.view);

  // Honesty rule (docs/10): uneven beyond the thresholds at the best rules found → say so and name the matchups.
  const uneven = recMs.filter((m) => inObjective(m) && (ratioOf(m.score) > cfg.maxRatio || (m.maxHtkGap ?? 0) >= cfg.maxHtkGap));
  const balanced = uneven.length === 0;

  // FP budget: blue flasks can't be counted (restore value not in the copy).
  ev.note(notSupportedLine("FP budget: 2 blue flasks (ladder limit)", "Flask of Cerulean Tears +12 restores via SpEffect 501062, which isn't in our SpEffect copy; FP uses count max FP only", "regulation.bin"), "all ash setups");

  const used = new Set<AssumptionId>(ev.assumptions);
  const unconfirmed = unconfirmedAssumptions(used);
  const L: string[] = [];
  L.push(`# Balance search — ${args.date}`, "");
  L.push(`Setups: \`${args.setupsPath}\` (patch ${args.doc.patch}). Ruleset: ERPvP ladder (official file unchanged; rules below are a separate recommended layer).`, "");
  if (used.has("A3")) L.push(`> ${A3_WARNING}. Ash results that include projectiles depend on it.`, "");
  for (const id of LOUD_ASSUMPTIONS) if (used.has(id) && id !== "A3") L.push(`> ⚠ ${id} used: ${ASSUMPTIONS[id].question} (${ASSUMPTIONS[id].status}).`);
  L.push("");

  L.push("## Verdict", "");
  const worstRec = recMs.filter(inObjective).sort((a, b) => b.score - a.score)[0];
  if (balanced) L.push(`The recommended rules balance every Mirror matchup within ratio ≤ ${cfg.maxRatio} and HTK gap < ${cfg.maxHtkGap}.`);
  else {
    L.push(`**No balanced set exists for these setups** under the thresholds (ratio ≤ ${cfg.maxRatio}, HTK gap < ${cfg.maxHtkGap}). ${uneven.length} Mirror matchup(s) stay uneven at the best rules found.`);
    if (worstRec) L.push("", `Worst remaining: **${worstRec.setup}** (${worstRec.view}) ${worstRec.a.variant.body} vs ${worstRec.b.variant.body}, ratio ${r3(ratioOf(worstRec.score))}, HTK gap ${worstRec.maxHtkGap ?? "—"}.`);
    const ashShare = uneven.filter((m) => m.view === "ash").length;
    L.push("", `Why: ${ashShare} of ${uneven.length} uneven matchups are ash matchups${used.has("A3") ? " (projectile scaling, A3, differs per ash and per stat)" : ""}; an RL cap moves both directions of a matchup at once, so it can't fix a gap that comes from which stat an ash scales with.`);
  }
  L.push("");

  L.push("## Recommended rules", "");
  L.push(...rulesText(ev, result.recommended), "");
  L.push(`Objective = worst Mirror matchup's ratio over views [${cfg.objective.join(", ")}]: RL 125 ${r3(ratioOf(result.objectives.reference))} → RL per stat ${r3(ratioOf(result.objectives.rlOnly))} → + per grip ${r3(ratioOf(result.objectives.byGrip))} → + bans ${r3(ratioOf(result.objectives.recommended))}.`, "");
  L.push("Each rule's effect (in search order):", "", "| Rule | worst ratio before | after |", "|---|---|---|");
  for (const s of result.steps) L.push(`| ${s.rule} | ${r3(ratioOf(s.before))} | ${r3(ratioOf(s.after))} |`);
  if (!result.steps.length) L.push("| (none: RL 125 was already the best found) | | |");
  const atEdge = Object.entries({ ...result.recommended.rl, ...result.recommended.rlByGrip }).filter(([, rl]) => rl === cfg.rlMin || rl === cfg.rlMax);
  if (atEdge.length) L.push("", `Note: ${atEdge.map(([k, rl]) => `${k} = ${rl}`).join(", ")} sits at the edge of the searched range (${cfg.rlMin}–${cfg.rlMax}); the true optimum may lie outside it.`);
  L.push("", "Sensitivity (worst ratio with that stat's RL moved ±5 from the recommendation):", "", "| Stat | −5 | +5 |", "|---|---|---|");
  for (const s of result.sensitivity) L.push(`| ${s.stat} | ${s.minus5 === null ? "invalid" : r3(ratioOf(s.minus5))} | ${s.plus5 === null ? "invalid" : r3(ratioOf(s.plus5))} |`);
  L.push("");

  if (normalOnly) {
    const saved = cfg.objective;
    cfg.objective = ["normal"];
    const nMs = ev.mirror(normalOnly.recommended, true);
    const nUneven = nMs.filter((m) => m.view === "normal" && (ratioOf(m.score) > cfg.maxRatio || (m.maxHtkGap ?? 0) >= cfg.maxHtkGap));
    cfg.objective = saved;
    L.push("## Normal moveset only (no A3 dependence)", "");
    L.push("The same search with the objective limited to normal attacks, because ash projectile numbers depend on A3 (unverified).", "");
    L.push(...rulesText(ev, normalOnly.recommended), "");
    L.push(`Worst normal Mirror ratio: RL 125 ${r3(ratioOf(normalOnly.objectives.reference))} → recommended ${r3(ratioOf(normalOnly.objectives.recommended))}. ${nUneven.length ? `**No balanced set exists** for the normal moveset either: ${nUneven.length} matchup(s) stay above ratio ${cfg.maxRatio} or HTK gap ${cfg.maxHtkGap}.` : "Every normal Mirror matchup is within the thresholds."}`, "");
    L.push("| Rule | worst ratio before | after |", "|---|---|---|");
    for (const s of normalOnly.steps) L.push(`| ${s.rule} | ${r3(ratioOf(s.before))} | ${r3(ratioOf(s.after))} |`);
    if (!normalOnly.steps.length) L.push("| (none) | | |");
    L.push("", "Worst normal ratio per body pair with these rules:", "", ...bodyMatrix(nMs, "normal"));
  }

  L.push("## Ban candidates (Cross view outliers)", "");
  L.push(`A combo is a candidate only when its class damage is ≥ ${1 + cfg.outlierThreshold}× the best combo with a different weapon or ash into the same body (threshold ${cfg.outlierThreshold}). Being the best is not enough. The greedy pass adds the candidate that most improves the worst Mirror matchup, then re-evaluates.`, "");
  if (!result.outliersConsidered.length) L.push("_No combo crossed the threshold._", "");
  else {
    L.push("| Candidate | class | into | damage | next best (combo) | × | adopted |", "|---|---|---|---|---|---|---|");
    for (const c of result.outliersConsidered.sort((a, b) => b.ratio - a.ratio)) L.push(`| ${c.ban.label} | ${c.cls} | ${c.defender} | ${c.damage.toFixed(1)} | ${c.nextBest.toFixed(1)} (${c.nextBestCombo}) | ${c.ratio.toFixed(3)} | ${result.recommended.bans.some((b) => b.label === c.ban.label) ? "yes" : "no (didn't improve the worst matchup)"} |`);
    L.push("");
  }

  L.push("## Mirror view: same setup across bodies", "");
  L.push("Ratio = A's damage into B ÷ B's damage into A (mean over the class's attacks; even = 1). HTK gap = HTK(A→B) − HTK(B→A), best attack of the class, status procs and duel state included. Round ratio = basket-weighted damage with ashes capped by FP (No-FP variant after FP runs out). Normal moveset and ashes are always separate.", "");
  for (const view of ["normal", "ash"] as const) {
    L.push(`### ${view === "normal" ? "Normal moveset" : "Ashes of war"}`, "", "Worst ratio per body pair (RL 125 → recommended):", "");
    L.push("RL 125:", "", ...bodyMatrix(refMs, view), "Recommended:", "", ...bodyMatrix(recMs, view));
    L.push(...matchupTable(refMs.filter((m) => m.view === view), "All matchups at RL 125"));
    L.push(...matchupTable(recMs.filter((m) => m.view === view), "All matchups with the recommended rules"));
  }

  L.push("## Worst matchups", "");
  for (const [label, ms] of [["RL 125", refMs], ["Recommended", recMs]] as const) {
    L.push(`**${label}**`, "");
    for (const m of ms.filter(inObjective).sort((a, b) => b.score - a.score).slice(0, 10)) L.push(`- ${m.setup} (${m.view}): ${m.a.variant.id} vs ${m.b.variant.id} — ratio ${r3(ratioOf(m.score))}, HTK gap ${m.maxHtkGap ?? "—"}`);
    L.push("");
  }

  L.push("## Setups expanded", "");
  const perBody = new Map<string, number>();
  for (const v of expansion.variants) perBody.set(v.body, (perBody.get(v.body) ?? 0) + 1);
  L.push(`${expansion.variants.length} legal variants (${[...perBody].map(([b, n]) => `${b} ${n}`).join(", ")}). Bodies without any legal variant: ${Object.keys(args.doc.bodies).filter((b) => !perBody.has(b)).join(", ") || "none"}.`, "");
  L.push(`Bulk table: ${bulk.rows} attack rows (${bulk.attackers} variants × ${bulk.defenders} bodies, every classified attack), ${bulk.unknownDamage} with unknown damage; written to \`${args.tablePath}\`.`, "");
  L.push("Skipped, with reasons:", "", "| Kind | Where | Reason |", "|---|---|---|");
  for (const s of expansion.skipped) L.push(`| ${s.kind} | ${s.where} | ${s.reason} |`);
  L.push("");

  L.push("## Not supported right now", "");
  for (const [line, where] of [...ev.notSupported].sort()) L.push(`- ${line}`, `  - in: ${[...where].slice(0, 12).join("; ")}${where.size > 12 ? `; … (${where.size} total)` : ""}`);
  L.push("");

  L.push("## Method and settings", "");
  L.push(`- Attack classes in the basket (weight): ${BASKET_CLASSES.map((c) => `${c} ${cfg.weights[c] ?? 0}`).join(", ")}. Classified but weight 0: ${EXTRA_CLASSES.join(", ")}. No mounted attacks.`);
  L.push(`- Each side uses its best legal variant of the setup (infusion, grease or ash buff) against the other body. In the ash view both sides use the same ash.`);
  L.push(`- Bodies, armour, class: as in setups.yaml; no talismans or tears; duel-start scenario; equip load must be a medium roll; requirements_rule: ${args.doc.defaults.requirements_rule}`);
  L.push(`- RL search: coordinate descent over ${cfg.rlMin}–${cfg.rlMax} step ${cfg.rlStep}, ≤ ${cfg.maxPasses} passes; then per grip; then greedy outlier bans (≤ ${cfg.maxBans}). RL moves the body's main damage stat (D15); the dex-faith body follows dex. Objective: worst |ln ratio|, tie-break total HTK gap.`);
  L.push(`- FP: ${cfg.ashCastsPerRound} ash casts per round in the round view.`);
  L.push("");
  L.push("## Assumptions used", "");
  for (const id of unconfirmed) L.push(`- ${LOUD_ASSUMPTIONS.includes(id) ? "**⚠ " : ""}${id}${LOUD_ASSUMPTIONS.includes(id) ? "**" : ""} — ${ASSUMPTIONS[id].question}`);
  for (const id of LOUD_ASSUMPTIONS) if (!unconfirmed.includes(id)) L.push(`- ${id} — not used by any computed number in this run`);
  L.push("", "---", "", CREDIT_LINE, "");
  return L.join("\n");
}
