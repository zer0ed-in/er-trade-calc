// One hit, A into B (docs/03 "The function"):
//   A_t = [(AR_t + Flat_t) × MV_t/100 + Skill_t] × Π(attacker multipliers)
//   d_t = A_t × curve(A_t / D_t) × (1 − N_t) × FinalRate_t × (defender HA damage multiplier)
//   damage = floor(Σ_t d_t)
import type { AssumptionId } from "../assumptions.ts";
import { weaponAr } from "../ar/weapon-ar.ts";
import { resolveArWeapon } from "../ar/weapon-ar.ts";
import type { HitDef, ResolvedAttack } from "../attacks/attacks.ts";
import { attackerModifiers, counterHitEffects, defenderModifiers, type HitContext, type IgnoredEffect } from "../effects/effects.ts";
import type { Fighter } from "../duel/fighter.ts";
import { GREASE_INFUSIONS, type GameData } from "../game-data.ts";
import { DAMAGE_TYPES, EngineError, type DamageType, type NegationType, type PerType } from "../types.ts";

/** Planner `adjustForDefense` factor (docs/03 rule 2): share of attack kept after defence, by ratio r = A/D. */
export function defenceCurve(ratio: number): number {
  if (ratio >= 8) return 0.9;
  if (ratio > 2.5) return 0.9 - 0.2 * ((8 - ratio) / 5.5) ** 2;
  if (ratio >= 1) return 0.7 - 0.3 * ((2.5 - ratio) / 1.5) ** 2;
  if (ratio > 0.12) return 0.1 + 0.3 * ((ratio - 0.12) / 0.88) ** 2;
  return 0.1;
}

export interface HitSituation {
  attackerHpFraction: number;
  defenderHpFraction: number;
  /** Defender is inside their own counter-hit window when this lands. */
  counterHit: boolean;
  /** Defender's HA damage multiplier if this lands during their hyper armour (planner `ha.damageMultiplier`), else 1. */
  defenderDamageMultiplier: number;
}

export const NEUTRAL_SITUATION: HitSituation = { attackerHpFraction: 1, defenderHpFraction: 1, counterHit: false, defenderDamageMultiplier: 1 };

export interface TypeBreakdown {
  type: DamageType;
  ar: number;
  flatBuff: number;
  mv: number;
  weaponPart: number;
  skillPart: number;
  attackerMultiplier: number;
  attackValue: number;
  defence: number;
  ratio: number;
  curve: number;
  negationType: NegationType;
  negation: number; // fraction 0–1
  finalRate: number;
  damage: number;
}

export interface SkillScalingDetail {
  table: number | null;
  upgradeRate: number;
  scaling: { stat: string; override: number; correctRate: number; curve: number }[];
  note: string;
}

export interface HitDamage {
  hit: HitDef;
  damage: number | null;
  unknownReason?: string;
  types: TypeBreakdown[];
  twoHandBonusApplied: boolean;
  effectiveStr: number;
  buffApplied: boolean;
  buffNote?: string;
  skill?: SkillScalingDetail;
  status: Record<string, number>;
  attackerEffects: { source: string; attribute: string; value: number; cite: string }[];
  defenderEffects: { source: string; attribute: string; value: number; cite: string }[];
  ignoredEffects: IgnoredEffect[];
  /** e.g. unmet weapon requirements (game applies a −40% penalty and no scaling). */
  warnings: string[];
  assumptions: AssumptionId[];
}

const STAT_FOR_REINFORCE = { strength: "str", dexterity: "dex", intelligence: "int", faith: "fth", arcane: "arc" } as const;

/**
 * A3 (assumed): flat × U × (1 + Σ override × correctRate(upgrade) × curve(stat)).
 * U = the weapon's upgrade damage rate for the type; correctRate = reinforcement scaling for the stat; curve = weapon's
 * CalcCorrectGraph for that damage type at the attacker's stat (no 2H bonus). Stats/rates come from the hit's own table.
 */
function skillFlat(data: GameData, attacker: Fighter, attack: ResolvedAttack, hit: HitDef): { perType: PerType; detail: SkillScalingDetail } {
  const { weapon } = resolveArWeapon(data, attack.slot);
  const key = `${weapon.weaponName}|${weapon.affinityId}`;
  const reinforceId = data.reinforceTypeId.get(key);
  const reinforcement = reinforceId === undefined ? undefined : data.raw.reinforcements[String(reinforceId)]?.[attack.slot.upgrade];
  if (!reinforcement) throw new EngineError(`No reinforcement data for ${weapon.name} +${attack.slot.upgrade}`, "missing-data");
  const table = hit.skillTable === null ? undefined : data.raw.correctionAttack[String(hit.skillTable)];
  const perType = {} as PerType;
  const detail: SkillScalingDetail = { table: hit.skillTable, upgradeRate: 0, scaling: [], note: "" };
  for (const t of DAMAGE_TYPES) {
    const flat = hit.flat[t];
    if (!flat) { perType[t] = 0; continue; }
    const U = reinforcement.damage[t];
    let sum = 0;
    if (table) {
      for (const [stat, override] of Object.entries(table.override[t] ?? {})) {
        if (!table.correction[t]?.[stat]) continue;
        const reinforceStat = stat as keyof typeof STAT_FOR_REINFORCE;
        const correctRate = reinforcement.scaling[reinforceStat];
        const graph = weapon.calcCorrectGraphs[DAMAGE_TYPES.indexOf(t) as 0 | 1 | 2 | 3 | 4];
        const statValue = attacker.stats[STAT_FOR_REINFORCE[reinforceStat]];
        const curve = graph[statValue] ?? 0;
        sum += override * correctRate * curve;
        if (!detail.scaling.some((s) => s.stat === STAT_FOR_REINFORCE[reinforceStat])) detail.scaling.push({ stat: STAT_FOR_REINFORCE[reinforceStat], override, correctRate, curve });
      }
    }
    detail.upgradeRate = U;
    perType[t] = flat * U * (1 + sum);
  }
  detail.note = table ? `scaled by table ${hit.skillTable} (A3)` : "no scaling table on this hit; flat × upgrade rate only (A3)";
  return { perType, detail };
}

export function computeHit(data: GameData, attacker: Fighter, attack: ResolvedAttack, hit: HitDef, defender: Fighter, situation: HitSituation = NEUTRAL_SITUATION): HitDamage {
  const assumptions = new Set<AssumptionId>();
  if (hit.disable2H.source === "A8" && attack.twoHanded) assumptions.add("A8");

  // Weapon AR for this hit: the 2H bonus applies only if the attack is two-handed and the hit doesn't disable it.
  const ar = weaponAr(data, attack.slot, attacker.stats, { twoHanded: attack.twoHanded, disableTwoHandBonus: hit.disable2H.value });

  // Buffs: right-hand weapon only (docs/03 rule 9; Q7), weapon must be buffable (data), added before MV.
  const meta = data.weaponMeta.get(attack.slot.weapon);
  let buffApplied = false;
  let buffNote: string | undefined;
  const ctx: HitContext = {
    attackerHpFraction: situation.attackerHpFraction,
    defenderHpFraction: situation.defenderHpFraction,
    twoHanded: attack.twoHanded,
    isSkill: attack.isSkill,
    attackName: attack.name,
    counterHit: situation.counterHit,
    physAttribute: hit.physAttribute,
  };
  let buffEffects = attacker.buffs;
  if (buffEffects.length) {
    if (attack.hand !== "right") { buffEffects = []; buffNote = "buffs apply to the right-hand weapon only (Q7)"; }
    else if (meta && !meta.isBuffable) throw new EngineError(`${attack.slot.weapon} can't be buffed (weapon data), so ${[...new Set(attacker.buffs.map((b) => b.source))].join(", ")} can't apply.`, "illegal-buff");
    else {
      const greases = [...new Set(attacker.buffs.map((b) => b.source))].filter((name) => data.goods.get(name)?.category === "Grease");
      if (greases.length && !GREASE_INFUSIONS.includes(attack.slot.infusion)) {
        throw new EngineError(`Greases only go on Standard, Heavy or Keen weapons; ${attack.slot.weapon} is ${attack.slot.infusion}, so ${greases.join(", ")} can't apply.`, "illegal-buff");
      }
      buffApplied = true;
    }
  }
  const atk = attackerModifiers([...attacker.effects, ...buffEffects], ctx);
  atk.assumptions.forEach((a) => assumptions.add(a));

  const counter = situation.counterHit ? counterHitEffects() : { effects: [], pierceDamageMultiplier: 1 };
  if (situation.counterHit) assumptions.add("A4");
  const def = defenderModifiers([...defender.effects, ...counter.effects], ctx);
  def.assumptions.forEach((a) => assumptions.add(a));

  let skillPart: PerType = { physical: 0, magic: 0, fire: 0, lightning: 0, holy: 0 };
  let skill: SkillScalingDetail | undefined;
  let unknownReason: string | undefined;
  if (hit.kind !== "weapon") {
    assumptions.add("A3");
    if (hit.flatUnknownReason) unknownReason = hit.flatUnknownReason;
    else ({ perType: skillPart, detail: skill } = skillFlat(data, attacker, attack, hit));
  }

  const types: TypeBreakdown[] = [];
  let total = 0;
  for (const t of DAMAGE_TYPES) {
    // A flat buff only adds to a weapon-based hit (MV > 0); a lone buff on a projectile is not modelled (Q8).
    const flatBuff = hit.mv[t] > 0 && buffApplied ? atk.flatAdd[t] : 0;
    const weaponPart = (ar.ar[t] + flatBuff) * (hit.mv[t] / 100);
    const base = weaponPart + skillPart[t];
    if (base <= 0) continue;
    // Physical-share multipliers: "Attack Power" applies to all types; "Physical Attack Power" only to physical (both in attackPowerMultiplier).
    const attackerMultiplier = atk.attackPowerMultiplier[t];
    const attackValue = base * attackerMultiplier;
    const defence = defender.defence.total[t];
    const ratio = attackValue / defence;
    const curve = defenceCurve(ratio);
    const negationType: NegationType = t === "physical" ? hit.physAttribute : t;
    // planner getTotalAbsorption: abs% = 100(1 − Πcut × multiplier) + flat points
    const remaining = defender.cutRates[negationType] * def.absorptionMultiplier[negationType] - def.absorptionFlatPoints[negationType] / 100;
    const negation = 1 - remaining;
    const pierceMult = negationType === "pierce" ? counter.pierceDamageMultiplier : 1;
    const finalRate = hit.finalRate[t];
    const damage = attackValue * curve * remaining * pierceMult * finalRate * situation.defenderDamageMultiplier;
    total += damage;
    types.push({ type: t, ar: ar.ar[t], flatBuff, mv: hit.mv[t], weaponPart, skillPart: skillPart[t], attackerMultiplier, attackValue, defence, ratio, curve, negationType, negation, finalRate, damage });
  }

  const status: Record<string, number> = {};
  const statusMv = hit.row.statusMV / 100;
  for (const [k, v] of Object.entries(ar.status)) status[k] = v * statusMv;
  if (buffApplied && hit.mv.physical + hit.mv.magic + hit.mv.fire + hit.mv.lightning + hit.mv.holy > 0) for (const [k, v] of Object.entries(atk.statusAdd)) status[k] = (status[k] ?? 0) + v * statusMv;

  return {
    hit,
    damage: unknownReason ? null : Math.floor(total),
    ...(unknownReason && { unknownReason }),
    types,
    twoHandBonusApplied: ar.twoHandBonusApplied,
    effectiveStr: ar.effectiveStr,
    buffApplied,
    ...(buffNote && { buffNote }),
    ...(skill && { skill }),
    status,
    attackerEffects: atk.applied,
    defenderEffects: def.applied,
    ignoredEffects: [...atk.ignored, ...def.ignored],
    warnings: ar.ineffectiveAttributes.length
      ? [`${attack.slot.weapon} requirements not met (${ar.ineffectiveAttributes.join(", ")}): AR penalised by 40%, no scaling for those damage types`]
      : [],
    assumptions: [...assumptions].sort(),
  };
}
