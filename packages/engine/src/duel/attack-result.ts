// One attack (all landed hits, in order) from one fighter into another, plus the same choice both directions.
import type { AssumptionId } from "../assumptions.ts";
import { resolveAttack, type AttackChoice, type ResolvedAttack } from "../attacks/attacks.ts";
import { explainHit, resultMeta } from "../explain/explain.ts";
import type { GameData } from "../game-data.ts";
import { computeHit, NEUTRAL_SITUATION, type HitDamage, type HitSituation } from "../hit/hit.ts";
import { hitsToProc, procDamage, resistances, STATUS_RESISTANCE } from "../stats/status.ts";
import type { ResultMeta } from "../types.ts";
import type { Fighter } from "./fighter.ts";

export interface StatusSummary {
  status: string;
  buildupPerAttack: number;
  resistance: number;
  attacksToProc: number | null;
  procDamage: number | null;
  note: string;
}

export interface AttackResult {
  attacker: string;
  defender: string;
  attack: { name: string; type: string; hand: string; twoHanded: boolean; skill?: string; hitsLanded: number[]; hitsTotal: number };
  hits: HitDamage[];
  /** Σ hit damage; null if any landed hit's damage is unknown. */
  total: number | null;
  poiseDamage: number;
  status: StatusSummary[];
  assumptionsUsed: AssumptionId[];
}

export function computeAttack(data: GameData, attacker: Fighter, attack: ResolvedAttack, defender: Fighter, situation: HitSituation = NEUTRAL_SITUATION): AttackResult {
  const hits = attack.hits.map((h) => computeHit(data, attacker, attack, h, defender, situation));
  const total = hits.some((h) => h.damage === null) ? null : hits.reduce((a, h) => a + h.damage!, 0);
  const assumptions = new Set<AssumptionId>(attack.assumptions);
  hits.forEach((h) => h.assumptions.forEach((a) => assumptions.add(a)));

  const buildup: Record<string, number> = {};
  for (const h of hits) for (const [k, v] of Object.entries(h.status)) buildup[k] = (buildup[k] ?? 0) + v;
  const res = resistances(data, defender.stats, defender.armour, defender.effects);
  const status: StatusSummary[] = Object.entries(buildup).map(([k, v]) => {
    const kind = STATUS_RESISTANCE[k];
    const resistance = kind ? res.values[kind] : 0;
    const proc = procDamage(k, defender.maxHp);
    return {
      status: k,
      buildupPerAttack: v,
      resistance,
      attacksToProc: hitsToProc(v, resistance),
      procDamage: proc.damage,
      note: `${proc.note}; no buildup decay modelled${res.armourDataMissing.length ? `; no resistance data for ${res.armourDataMissing.join(", ")}` : ""}`,
    };
  });

  return {
    attacker: attacker.label,
    defender: defender.label,
    attack: {
      name: attack.name, type: attack.type, hand: attack.hand, twoHanded: attack.twoHanded,
      ...(attack.skillName && { skill: attack.skillName }),
      hitsLanded: attack.hits.map((h) => h.index), hitsTotal: attack.allHits.length,
    },
    hits,
    total,
    poiseDamage: attack.hits.reduce((a, h) => a + h.poiseDamage, 0),
    status,
    assumptionsUsed: [...assumptions].sort(),
  };
}

export function explainAttack(r: AttackResult): string[] {
  const lines = [`${r.attacker} → ${r.defender}: ${r.attack.name} (hits ${r.attack.hitsLanded.join(", ")} of ${r.attack.hitsTotal})`];
  for (const h of r.hits) lines.push(...explainHit(h, `  ${r.attack.name}`).map((l) => `  ${l}`));
  lines.push(`  attack total: ${r.total ?? "unknown"}`);
  return lines;
}

export interface BothWays {
  aToB: AttackResult | { unavailable: string };
  bToA: AttackResult | { unavailable: string };
  meta: ResultMeta;
}

/**
 * `ertc hit`: A's attack into B, and the same attack by B into A if B can do it (docs/06).
 * `choiceB` lets a caller pick B's attack explicitly (compute_hit tool).
 */
export function computeHitBothWays(data: GameData, a: Fighter, b: Fighter, choiceA: AttackChoice, choiceB: AttackChoice = { ...choiceA, hand: undefined, slot: undefined }): BothWays {
  const run = (atk: Fighter, def: Fighter, choice: AttackChoice) => {
    try {
      return computeAttack(data, atk, resolveAttack(data, atk.build, choice), def, { ...NEUTRAL_SITUATION, attackerHpFraction: atk.startHpFraction, defenderHpFraction: def.startHpFraction });
    } catch (e) {
      if ((e as { code?: string }).code === "unknown-attack") return { unavailable: `${atk.label} can't do "${choice.attack}".` };
      throw e;
    }
  };
  const aToB = run(a, b, choiceA);
  const bToA = run(b, a, choiceB);
  const used = [...("assumptionsUsed" in aToB ? aToB.assumptionsUsed : []), ...("assumptionsUsed" in bToA ? bToA.assumptionsUsed : [])];
  return { aToB, bToA, meta: resultMeta(data.patch, used) };
}
