// Status resistances, proc damage and hits-to-proc. Ported from the planner (`baseResistances`, `calculateStatusEffectsDamage`).
import { correctionGraphValue, type GameData } from "../game-data.ts";
import { pvpValue, type SourcedEffect } from "../effects/effects.ts";
import { STAT_KEYS, type ArmourPiece, type Stats } from "../types.ts";

export type ResistanceKind = "immunity" | "robustness" | "focus" | "vitality";

/** Which resistance each status uses. */
export const STATUS_RESISTANCE: Record<string, ResistanceKind> = {
  poison: "immunity", scarlet_rot: "immunity", bleed: "robustness", frostbite: "robustness", sleep: "focus", madness: "focus", deathblight: "vitality",
};

// planner baseResistances: level graph (Σ stats) + stat graph, each floored.
const GRAPHS: Record<ResistanceKind, [number, number, keyof Stats]> = {
  immunity: [110, 120, "vig"],
  robustness: [112, 122, "end"],
  focus: [114, 124, "mnd"],
  vitality: [116, 126, "arc"],
};

// Effect attribute names in the planner's curated effect tables (e.g. Divine Bird Helm "Focus −45").
const RESISTANCE_ATTR: Record<string, ResistanceKind> = { Immunity: "immunity", Robustness: "robustness", Focus: "focus", Vitality: "vitality" };

/**
 * Resistances = level graph + stat graph + armour fields + unconditional additive resistance effects (equipped gear).
 * Effects use the item's own value. The planner divides these by the effect's tick_interval (Divine Bird Helm −45 → −90);
 * in-game the helm lowers Focus by 43 (Zer0, 2026-11), so the planner's halving is not followed (docs/09 Q14).
 */
export function resistances(data: GameData, stats: Stats, armour: ArmourPiece[], effects: SourcedEffect[] = []): { values: Record<ResistanceKind, number>; armourDataMissing: string[]; effectSources: string[] } {
  const sum = STAT_KEYS.reduce((a, k) => a + stats[k], 0);
  const g = (id: number, x: number) => Math.floor(correctionGraphValue(data, id, x));
  const values = {} as Record<ResistanceKind, number>;
  const armourDataMissing = armour.filter((p) => !p.resistances).map((p) => p.name);
  for (const [kind, [levelGraph, statGraph, stat]] of Object.entries(GRAPHS) as [ResistanceKind, (typeof GRAPHS)[ResistanceKind]][]) {
    values[kind] = g(levelGraph, sum) + g(statGraph, stats[stat]) + armour.reduce((a, p) => a + (p.resistances?.[kind] ?? 0), 0);
  }
  const effectSources: string[] = [];
  for (const se of effects) {
    const kind = RESISTANCE_ATTR[se.effect.attribute];
    if (!kind || se.effect.model !== "additive" || se.effect.conditions?.length) continue;
    const v = pvpValue(se.effect);
    values[kind] += v;
    effectSources.push(`${se.source}: ${se.effect.attribute} ${v > 0 ? "+" : ""}${v}`);
  }
  return { values, armourDataMissing, effectSources };
}

export interface StatusProc {
  status: string;
  /** Proc damage vs this max HP (planner formulas). null = the planner shows a damage-over-time or no direct value. */
  damage: number | null;
  note: string;
}

/** Proc damage the planner shows for a defender with this max HP (`calculateStatusEffectsDamage`). */
export function procDamage(status: string, maxHp: number): StatusProc {
  const hp = Math.trunc(maxHp);
  switch (status) {
    case "bleed": {
      const base = Math.max(1, Math.trunc(hp * 0.15));
      return { status, damage: base + 100, note: `15% max HP + 100 (planner bleedDamage1; planner also lists a +200 variant = ${base + 200})` };
    }
    case "frostbite": return { status, damage: Math.max(1, Math.trunc(30 + hp * 0.1)), note: "10% max HP + 30 (planner)" };
    case "madness": return { status, damage: Math.max(1, Math.trunc(100 + hp * 0.15)), note: "15% max HP + 100 (planner)" };
    default: return { status, damage: null, note: "damage over time / no direct proc damage modelled in phase 1" };
  }
}

/** Hits of a given buildup needed to reach the resistance (no decay modelled). */
export function hitsToProc(buildupPerHit: number, resistance: number): number | null {
  if (buildupPerHit <= 0) return null;
  return Math.ceil(resistance / buildupPerHit);
}
