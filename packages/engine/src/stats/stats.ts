// Character stats derived from the build: RL, defences, HP, FP, equip load, poise. Formulas ported from the planner (cited per function).
import { correctionGraphValue, requireFrom, type GameData } from "../game-data.ts";
import { EngineError, STAT_KEYS, type ArmourPiece, type Build, type NegationType, type PerType, type Stats } from "../types.ts";

// CalcCorrectGraph ids the planner uses for defences / HP (planner `defenses`, `calculateMaxHealth`).
const GRAPH = { levelDefence: 102, strDefence: 130, intDefence: 132, vigFireDefence: 133, arcHolyDefence: 135, hp: 100 } as const;

export const STAT_CAP = 99; // planner `finalStats`: Math.min(stat, 99)

export function validateStats(stats: Stats): void {
  for (const k of STAT_KEYS) {
    const v = stats[k];
    if (!Number.isInteger(v) || v < 1 || v > STAT_CAP) throw new EngineError(`Stat ${k} must be an integer 1–99 (got ${v}).`, "invalid-build");
  }
}

/** RL = class level + Σ(stat − class base) (docs/03 rule 15). */
export function runeLevel(data: GameData, build: Pick<Build, "class" | "stats">): number {
  const cls = requireFrom(data.classes, build.class, "class");
  let rl = cls.level;
  for (const k of STAT_KEYS) {
    if (build.stats[k] < cls.base[k]) throw new EngineError(`${k} ${build.stats[k]} is below the ${build.class} base of ${cls.base[k]}.`, "invalid-build");
    rl += build.stats[k] - cls.base[k];
  }
  return rl;
}

const statSum = (s: Stats) => STAT_KEYS.reduce((a, k) => a + s[k], 0);

export interface DefenceBreakdown {
  levelPart: number;
  statPart: PerType;
  total: PerType;
}

/**
 * Defence per damage type (planner `defenses`): floor(levelGraph(Σ stats)) + floor(statGraph(stat)).
 * Each part is floored separately — this matches all 66 planner-verified probes (flooring the sum does not; see docs/03 rule 3).
 * The level graph is indexed by the sum of the eight stats (= RL + 79 for every class).
 */
export function defences(data: GameData, stats: Stats): DefenceBreakdown {
  const g = (id: number, x: number) => Math.floor(correctionGraphValue(data, id, x));
  const levelPart = g(GRAPH.levelDefence, statSum(stats));
  const statPart: PerType = {
    physical: g(GRAPH.strDefence, stats.str),
    magic: g(GRAPH.intDefence, stats.int),
    fire: g(GRAPH.vigFireDefence, stats.vig),
    lightning: 0, // lightning defence = level part only (docs/03 rule 4)
    holy: g(GRAPH.arcHolyDefence, stats.arc),
  };
  const total = Object.fromEntries(Object.entries(statPart).map(([t, v]) => [t, levelPart + v])) as PerType;
  return { levelPart, statPart, total };
}

/** Max HP before effects (planner `calculateMaxHealth`: floor(graph 100 at vigor)). */
export function baseMaxHp(data: GameData, stats: Stats): number {
  return Math.floor(correctionGraphValue(data, GRAPH.hp, stats.vig));
}

export function baseMaxFp(data: GameData, stats: Stats): number {
  const v = data.raw.statTables.maxFpByMind[stats.mnd];
  if (v === undefined) throw new EngineError(`No FP value for mind ${stats.mnd}`, "missing-data");
  return Math.trunc(v);
}

/** Max equip load before talisman multipliers (planner `calculateEquipLoad` table by endurance). */
export function baseMaxEquipLoad(data: GameData, stats: Stats): number {
  const v = data.raw.statTables.maxEquipLoadByEndurance[stats.end];
  if (v === undefined) throw new EngineError(`No equip load value for endurance ${stats.end}`, "missing-data");
  return v;
}

export function equippedArmour(data: GameData, build: Build): ArmourPiece[] {
  const out: ArmourPiece[] = [];
  for (const slot of ["head", "body", "arms", "legs"] as const) {
    const name = build.armour[slot];
    if (!name) continue;
    const piece = requireFrom(data.armour, name, "armour");
    if (piece.slot !== slot) throw new EngineError(`${name} is ${piece.slot} armour, not ${slot}.`, "invalid-build");
    out.push(piece);
  }
  return out;
}

/** Armour-only damage multiplier per negation type: Π cutRate (docs/03 rule 8). Negation % = 1 − this. */
export function armourCutRates(pieces: ArmourPiece[]): Record<NegationType, number> {
  const types: NegationType[] = ["standard", "slash", "strike", "pierce", "magic", "fire", "lightning", "holy"];
  return Object.fromEntries(types.map((t) => [t, pieces.reduce((m, p) => m * p.cutRate[t], 1)])) as Record<NegationType, number>;
}

export function armourPoise(pieces: ArmourPiece[]): number {
  return pieces.reduce((a, p) => a + p.poise, 0);
}

export function armourWeight(pieces: ArmourPiece[]): number {
  return pieces.reduce((a, p) => a + p.weight, 0);
}
