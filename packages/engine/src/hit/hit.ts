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
import { type GameData } from "../game-data.ts";
import { DAMAGE_TYPES, EngineError, NotSupportedError, type DamageType, type NegationType, type PerType } from "../types.ts";

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
  /** Skill attack rate for the weapon's upgrade level (ReinforceParamWeapon +0x7C; 4.0 at max). */
  skillRate: number;
  scaling: { stat: string; coefficient: number; from: "table override" | "weapon"; curve: number }[];
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
const TC_ATTRIBUTE = { str: "str", dex: "dex", int: "int", fth: "fai", arc: "arc" } as const;
type ReinforceStat = keyof typeof STAT_FOR_REINFORCE;
const REINFORCE_STAT = Object.fromEntries(Object.entries(STAT_FOR_REINFORCE).map(([k, v]) => [v, k])) as Record<string, ReinforceStat>;

/**
 * A3 (confirmed in-game, Zer0 2026-11-14): flat × R × (1 + Σ coefficient × curve(stat)).
 * R = ReinforceParamWeapon skill rate at the weapon's level (+0x7C; 4.0 at +25 / somber +10), the same for every infusion.
 * Coefficients: the hit's overwrite table (overwriteAttackElementCorrectId) gives override × reinforcement scaling rate;
 * a stat the table flags without an override, and every stat when the hit has no table (-1), uses the weapon's own
 * upgraded scaling for the stats its AttackElementCorrect flags — the same rule as weapon AR (Tom Clark).
 * curve = the weapon's CalcCorrectGraph for the damage type at the attacker's stat (no 2H bonus).
 */
function skillFlat(data: GameData, attacker: Fighter, attack: ResolvedAttack, hit: HitDef): { perType: PerType; detail: SkillScalingDetail } {
  const { weapon } = resolveArWeapon(data, attack.slot);
  const key = `${weapon.weaponName}|${weapon.affinityId}`;
  const reinforceId = data.reinforceTypeId.get(key);
  const reinforcement = reinforceId === undefined ? undefined : data.raw.reinforcements[String(reinforceId)]?.[attack.slot.upgrade];
  if (!reinforcement) throw new EngineError(`No reinforcement data for ${weapon.name} +${attack.slot.upgrade}`, "missing-data");
  const table = hit.skillTable === null ? undefined : data.raw.correctionAttack[String(hit.skillTable)];
  const weaponScaling = weapon.attributeScaling[attack.slot.upgrade] ?? {};
  const perType = {} as PerType;
  const detail: SkillScalingDetail = { table: hit.skillTable, skillRate: reinforcement.skillRate, scaling: [], note: "" };
  for (const t of DAMAGE_TYPES) {
    const flat = hit.flat[t];
    if (!flat) { perType[t] = 0; continue; }
    const typeIndex = DAMAGE_TYPES.indexOf(t) as 0 | 1 | 2 | 3 | 4;
    const graph = weapon.calcCorrectGraphs[typeIndex];
    // stat → [coefficient, where it came from]
    const coefficients: [keyof typeof TC_ATTRIBUTE, number, "table override" | "weapon"][] = [];
    if (table) {
      for (const [stat, flagged] of Object.entries(table.correction[t] ?? {})) {
        if (!flagged) continue;
        const short = STAT_FOR_REINFORCE[stat as ReinforceStat];
        const override = table.override[t]?.[stat];
        coefficients.push(override !== undefined
          ? [short, override * reinforcement.scaling[stat as ReinforceStat], "table override"]
          : [short, weaponScaling[TC_ATTRIBUTE[short]] ?? 0, "weapon"]);
      }
    } else {
      for (const [attr, correct] of Object.entries(weapon.attackElementCorrect[typeIndex] ?? {})) {
        if (!correct) continue;
        const short = (Object.keys(TC_ATTRIBUTE) as (keyof typeof TC_ATTRIBUTE)[]).find((k) => TC_ATTRIBUTE[k] === attr)!;
        coefficients.push([short, correct === true ? (weaponScaling[attr as never] ?? 0) : correct * reinforcement.scaling[REINFORCE_STAT[short]!], "weapon"]);
      }
    }
    let sum = 0;
    for (const [stat, coefficient, from] of coefficients) {
      const curve = graph[attacker.stats[stat]] ?? 0;
      sum += coefficient * curve;
      if (!detail.scaling.some((s) => s.stat === stat)) detail.scaling.push({ stat, coefficient, from, curve });
    }
    perType[t] = flat * reinforcement.skillRate * (1 + sum);
  }
  detail.note = table ? `scaled by table ${hit.skillTable} (A3)` : "no overwrite table on this hit; weapon's own scaling (A3)";
  return { perType, detail };
}

export function computeHit(data: GameData, attacker: Fighter, attack: ResolvedAttack, hit: HitDef, defender: Fighter, situation: HitSituation = NEUTRAL_SITUATION): HitDamage {
  const assumptions = new Set<AssumptionId>();
  const notes: string[] = [];

  // Weapon AR for this hit: the 2H bonus applies only if the attack is two-handed and the hit's AtkParam row doesn't disable it (A8, data).
  const ar = weaponAr(data, attack.slot, attacker.stats, { twoHanded: attack.twoHanded, disableTwoHandBonus: hit.disable2H.value ?? false });
  let unknown2H: string | undefined;
  if (attack.twoHanded && hit.disable2H.value === null) {
    unknown2H = new NotSupportedError(`2H bonus for hit ${hit.id}`, "the hit resolves to no AtkParam row, so whether the 2H bonus applies is unknown", "regulation data").line;
  } else if (attack.twoHanded && hit.disable2H.value && !ar.twoHandBonusApplied) {
    // Label only where it changes the number: the weapon would get the bonus (not paired) if the flag allowed it.
    const wouldApply = weaponAr(data, attack.slot, attacker.stats, { twoHanded: true, disableTwoHandBonus: false }).twoHandBonusApplied;
    if (wouldApply && !attack.isSkill) notes.push("2H str bonus off for this hit: game data, differs from planner (the planner applies it)");
  }

  // Buffs: right-hand weapon only (docs/03 rule 9; Q7), weapon must be buffable (data), added before MV.
  const meta = data.weaponMeta.get(attack.slot.weapon);
  let buffApplied = false;
  let buffNote: string | undefined;
  const ctx: HitContext = {
    attackerHpFraction: situation.attackerHpFraction,
    defenderHpFraction: situation.defenderHpFraction,
    hitCategories: hit.row.atkParam?.subCategories ?? null,
    counterHit: situation.counterHit,
    physAttribute: hit.physAttribute,
  };
  let buffEffects = attacker.buffs;
  if (buffEffects.length) {
    if (attack.hand !== "right") { buffEffects = []; buffNote = "buffs apply to the right-hand weapon only (Q7)"; }
    else if (meta && !meta.isBuffable) throw new EngineError(`${attack.slot.weapon} can't be buffed (weapon data), so ${[...new Set(attacker.buffs.map((b) => b.source))].join(", ")} can't apply.`, "illegal-buff");
    else {
      const greases = [...new Set(attacker.buffs.map((b) => b.source))].filter((name) => data.goods.get(name)?.category === "Grease");
      if (greases.length && meta && !meta.greaseInfusions.includes(attack.slot.infusion)) {
        throw new EngineError(`${attack.slot.infusion} ${attack.slot.weapon} can't take greases (game data: EquipParamWeapon.isEnhance), so ${greases.join(", ")} can't apply.`, "illegal-buff");
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
  let unknownReason: string | undefined = unknown2H;
  if (hit.kind !== "weapon") {
    assumptions.add("A3");
    if (hit.flatUnknownReason) unknownReason ??= hit.flatUnknownReason;
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
    warnings: [
      ...(ar.ineffectiveAttributes.length ? [`${attack.slot.weapon} requirements not met (${ar.ineffectiveAttributes.join(", ")}): AR penalised by 40%, no scaling for those damage types`] : []),
      ...notes,
    ],
    assumptions: [...assumptions].sort(),
  };
}
