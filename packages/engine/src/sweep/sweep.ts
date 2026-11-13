// RL sweeps (docs/06 `ertc sweep`, D15): change a build's RL by adding/removing points in one stat, recompute everything.
// Pure, one row per point, invalid points reported not dropped.
import type { AssumptionId } from "../assumptions.ts";
import type { AttackChoice } from "../attacks/attacks.ts";
import { resultMeta } from "../explain/explain.ts";
import type { ScenarioOptions } from "../effects/effects.ts";
import type { GameData } from "../game-data.ts";
import { computeTrade } from "../interaction/trade.ts";
import { runeLevel } from "../stats/stats.ts";
import { prepareFighter } from "../duel/fighter.ts";
import { EngineError, STAT_KEYS, type Build, type ResultMeta, type StatKey } from "../types.ts";

export interface SweepSide {
  /** Stat that RL changes come out of / go into (D15 default: the build's main damage stat). */
  stat?: StatKey;
  /** RL values to evaluate; omit to keep the build's RL. */
  rls?: number[];
}

export interface SweepOptions {
  a: SweepSide;
  b: SweepSide;
  scenario: ScenarioOptions;
  choiceA: AttackChoice;
  choiceB: AttackChoice;
}

export interface SweepRow {
  rlA: number;
  rlB: number;
  statA?: { stat: StatKey; value: number };
  statB?: { stat: StatKey; value: number };
  valid: boolean;
  invalidReason?: string;
  aToB?: number | null;
  bToA?: number | null;
  htkAtoB?: number | null;
  htkBtoA?: number | null;
  verdict?: string;
  equipRollA?: string;
  equipRollB?: string;
}

export interface SweepResult {
  rows: SweepRow[];
  meta: ResultMeta;
}

const DAMAGE_STATS: StatKey[] = ["str", "dex", "int", "fth", "arc"];

/** The build's main damage stat: the highest of str/dex/int/fth/arc (ties → first in that order). */
export function mainDamageStat(build: Build): StatKey {
  return DAMAGE_STATS.reduce((best, k) => (build.stats[k] > build.stats[best] ? k : best), "str" as StatKey);
}

/** Build moved to `targetRl` by changing one stat (throws EngineError if that leaves 1–99 or goes under the class base). */
export function withRuneLevel(data: GameData, build: Build, targetRl: number, stat: StatKey): Build {
  const delta = targetRl - runeLevel(data, build);
  const value = build.stats[stat] + delta;
  const base = data.classes.get(build.class)!.base[stat];
  if (value < base) throw new EngineError(`RL ${targetRl} needs ${stat} ${value}, below the ${build.class} base of ${base}`, "invalid-build");
  if (value > 99) throw new EngineError(`RL ${targetRl} needs ${stat} ${value}, above 99`, "invalid-build");
  return { ...build, stats: { ...build.stats, [stat]: value } };
}

export function parseRlRange(spec: string): number[] {
  const m = spec.trim().match(/^(\d+)(?:\.\.(\d+))?(?::(\d+))?$/);
  if (!m) throw new EngineError(`RL range "${spec}" must look like 125, 95..125 or 95..125:2`, "invalid-option");
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  const step = m[3] ? Number(m[3]) : 1;
  if (step < 1 || to < from || (to - from) / step > 500) throw new EngineError(`RL range "${spec}" is empty or too large (max 500 points)`, "invalid-option");
  const out: number[] = [];
  for (let rl = from; rl <= to; rl += step) out.push(rl);
  return out;
}

export function sweepRuneLevel(data: GameData, a: Build, b: Build, opts: SweepOptions): SweepResult {
  const statA = opts.a.stat ?? mainDamageStat(a);
  const statB = opts.b.stat ?? mainDamageStat(b);
  for (const s of [statA, statB]) if (!STAT_KEYS.includes(s)) throw new EngineError(`Unknown stat "${s}"`, "invalid-option");
  const rlsA = opts.a.rls ?? [runeLevel(data, a)];
  const rlsB = opts.b.rls ?? [runeLevel(data, b)];
  const rows: SweepRow[] = [];
  const used = new Set<AssumptionId>();
  for (const rlA of rlsA) for (const rlB of rlsB) {
    const row: SweepRow = { rlA, rlB, valid: false };
    try {
      const ba = opts.a.rls ? withRuneLevel(data, a, rlA, statA) : a;
      const bb = opts.b.rls ? withRuneLevel(data, b, rlB, statB) : b;
      row.statA = { stat: statA, value: ba.stats[statA] };
      row.statB = { stat: statB, value: bb.stats[statB] };
      const fa = prepareFighter(data, ba, opts.scenario, "A");
      const fb = prepareFighter(data, bb, opts.scenario, "B");
      const t = computeTrade(data, fa, fb, opts.choiceA, opts.choiceB);
      t.meta.assumptionsUsed.forEach((x) => used.add(x));
      Object.assign(row, {
        valid: true,
        aToB: t.a.damage?.total ?? null,
        bToA: t.b.damage?.total ?? null,
        htkAtoB: t.a.hitsToKill?.attacks ?? null,
        htkBtoA: t.b.hitsToKill?.attacks ?? null,
        verdict: t.verdict.kind === "no-trade" ? `no trade (${t.verdict.winner} wins)` : t.verdict.kind,
        equipRollA: fa.equipLoad.roll,
        equipRollB: fb.equipLoad.roll,
      });
      const warnings = t.a.damage?.hits.flatMap((h) => h.warnings) ?? [];
      if (warnings.length) row.invalidReason = warnings[0];
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      row.invalidReason = e.message;
    }
    rows.push(row);
  }
  return { rows, meta: resultMeta(data.patch, used) };
}
