// A build prepared for a duel under a scenario: effective stats, defences, armour, HP, poise, load, effect sources.
import { requireFrom, type GameData } from "../game-data.ts";
import { buildEffects, scenarioHpFraction, statBonuses, unconditionalMultiplier, type ScenarioOptions, type SourcedEffect } from "../effects/effects.ts";
import {
  armourCutRates, armourPoise, armourWeight, baseMaxEquipLoad, baseMaxFp, baseMaxHp, defences, equippedArmour, runeLevel, STAT_CAP, validateStats,
  type DefenceBreakdown,
} from "../stats/stats.ts";
import { EngineError, STAT_KEYS, type ArmourPiece, type Build, type NegationType, type Stats } from "../types.ts";

export interface Fighter {
  label: string;
  build: Build;
  scenario: ScenarioOptions;
  rl: number;
  /** Stats after equipment bonuses (capped at 99) — what AR, defences and HP use. */
  stats: Stats;
  defence: DefenceBreakdown;
  armour: ArmourPiece[];
  cutRates: Record<NegationType, number>;
  maxHp: number;
  maxFp: number;
  /** HP fraction at the start of the exchange (scenario / --hp-pct). */
  startHpFraction: number;
  poise: { armour: number; multiplier: number; total: number; sources: string[] };
  equipLoad: { weight: number; max: number; percent: number; roll: "Light" | "Medium" | "Heavy" | "Overloaded" };
  effects: SourcedEffect[];
  buffs: SourcedEffect[];
  /** Everything equipped or applied (build + scenario extras), whatever the scenario's effect rules — used by legality. */
  equipped: { talismans: string[]; tears: string[]; buffs: string[] };
}

export function prepareFighter(data: GameData, build: Build, scenario: ScenarioOptions, label = build.name ?? build.id ?? "build"): Fighter {
  validateStats(build.stats);
  const rl = runeLevel(data, build);
  const { attackerSide: effects, buffs } = buildEffects(data, build, scenario);
  const bonus = statBonuses(effects);
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, Math.min(STAT_CAP, build.stats[k] + (bonus[k] ?? 0))])) as Stats;

  const armour = equippedArmour(data, build);
  const hpMult = unconditionalMultiplier(effects, "Maximum Health");
  const poiseMult = unconditionalMultiplier(effects, "Poise");
  const loadMult = unconditionalMultiplier(effects, "Maximum Equip Load");
  const armourPoiseValue = armourPoise(armour);

  // Equip load: armour + every equipped weapon + talismans (planner equipLoadPercent; <30 Light, <70 Medium, <100 Heavy).
  let weight = armourWeight(armour);
  for (const slot of [...build.rightHand, ...(build.leftHand ?? [])]) if (slot) weight += requireFrom(data.weaponMeta, slot.weapon, "weapon").weight;
  if (scenario.scenario !== "base") for (const t of build.talismans) weight += requireFrom(data.talismans, t, "talisman").weight ?? 0;
  const maxLoad = baseMaxEquipLoad(data, stats) * loadMult.value;
  const percent = maxLoad ? (100 * weight) / maxLoad : 0;
  const roll = percent < 30 ? "Light" : percent < 70 ? "Medium" : percent < 100 ? "Heavy" : "Overloaded";

  const startHpFraction = scenarioHpFraction(scenario);
  if (!(startHpFraction > 0 && startHpFraction <= 1)) throw new EngineError("HP % must be between 1 and 100.", "invalid-option");

  return {
    label, build, scenario, rl, stats,
    defence: defences(data, stats),
    armour,
    cutRates: armourCutRates(armour),
    maxHp: Math.floor(baseMaxHp(data, stats) * hpMult.value),
    maxFp: baseMaxFp(data, stats),
    startHpFraction,
    poise: { armour: armourPoiseValue, multiplier: poiseMult.value, total: armourPoiseValue * poiseMult.value, sources: poiseMult.sources },
    equipLoad: { weight, max: maxLoad, percent, roll },
    effects,
    buffs,
    equipped: {
      talismans: [...new Set([...build.talismans, ...(scenario.extraTalismans ?? [])])],
      tears: [...new Set([...(build.tears ?? []), ...(scenario.extraTears ?? [])])],
      buffs: [...new Set([...build.buffs, ...(scenario.extraBuffs ?? [])])],
    },
  };
}
