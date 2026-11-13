// Effects from talismans, tears, armour, buffs and conditions → numeric modifiers.
// Source of values: the planner's curated effect tables (in the one-time copy; docs/09 Q9), except A9 (Lightning Slash, wiki).
// Planner conventions ported: PvP uses value_pvp when present (`value_pvp || value`); multiplicative "…Absorption" v → damage ×(2 − v).
import { ASSUMPTIONS, type AssumptionId } from "../assumptions.ts";
import { requireFrom, type GameData } from "../game-data.ts";
import { DAMAGE_TYPES, EngineError, type Build, type DamageType, type NegationType, type PerType, type PlannerEffect, type StatKey } from "../types.ts";

export type EffectSourceKind = "talisman" | "tear" | "armour" | "buff" | "condition";

export interface SourcedEffect {
  source: string;
  kind: EffectSourceKind;
  effect: PlannerEffect;
  /** Citation for the value, e.g. "planner talisman table" or "A9 (wiki)". */
  cite: string;
}

/** What is true at the moment a hit lands. Conditions are evaluated against this. */
export interface HitContext {
  /** Attacker's / defender's current HP as a fraction of max (1 = full). */
  attackerHpFraction: number;
  defenderHpFraction: number;
  twoHanded: boolean;
  isSkill: boolean;
  attackName: string;
  /** Defender is inside their own counter-hit window (#45) when this hit lands. */
  counterHit: boolean;
  physAttribute: string;
}

export interface IgnoredEffect {
  source: string;
  attribute: string;
  reason: string;
}

export interface AttackerModifiers {
  attackPowerMultiplier: PerType;
  flatAdd: PerType;
  statusAdd: Record<string, number>;
  applied: { source: string; attribute: string; value: number; cite: string }[];
  ignored: IgnoredEffect[];
  assumptions: AssumptionId[];
}

export interface DefenderModifiers {
  /** Multiply the armour cut rate by this (planner getAbsorptionMultiplier). */
  absorptionMultiplier: Record<NegationType, number>;
  /** Added to absorption % points (planner getFlatAbsorptionModifier); negative = more damage taken. */
  absorptionFlatPoints: Record<NegationType, number>;
  applied: { source: string; attribute: string; value: number; cite: string }[];
  ignored: IgnoredEffect[];
  assumptions: AssumptionId[];
}

const ELEMENT_ATTACK_ATTR: Record<string, DamageType> = {
  "Physical Attack Power": "physical",
  "Magic Attack Power": "magic",
  "Fire Attack Power": "fire",
  "Lightning Attack Power": "lightning",
  "Holy Attack Power": "holy",
};
const BUILDUP_ATTR: Record<string, string> = {
  "Bleed Buildup": "bleed", "Frost Buildup": "frostbite", "Poison Buildup": "poison", "Scarlet Rot Buildup": "scarlet_rot", "Sleep Buildup": "sleep", "Madness Buildup": "madness",
};
const STAT_ATTR: Record<string, StatKey> = {
  Vigor: "vig", Mind: "mnd", Endurance: "end", Strength: "str", Dexterity: "dex", Intelligence: "int", Faith: "fth", Arcane: "arc",
};
// planner getRelevantAbsorptionTypes
const ABSORPTION_ATTRS: Record<NegationType, string[]> = {
  standard: ["Absorption", "Physical Absorption"],
  strike: ["Absorption", "Physical Absorption"],
  slash: ["Absorption", "Physical Absorption"],
  pierce: ["Absorption", "Physical Absorption", "Pierce Absorption"],
  magic: ["Absorption", "Magic Absorption", "Elemental Absorption"],
  fire: ["Absorption", "Fire Absorption", "Elemental Absorption"],
  lightning: ["Absorption", "Lightning Absorption", "Elemental Absorption"],
  holy: ["Absorption", "Holy Absorption", "Elemental Absorption"],
};
const NEGATION_TYPES = Object.keys(ABSORPTION_ATTRS) as NegationType[];

export const pvpValue = (e: PlannerEffect) => e.value_pvp || e.value;

/** Evaluate one planner condition. `undefined` = not modelled → effect ignored and reported. */
function conditionHolds(cond: string, ctx: HitContext, side: "attacker" | "defender"): boolean | undefined {
  const hp = side === "attacker" ? ctx.attackerHpFraction : ctx.defenderHpFraction;
  const name = ctx.attackName;
  const hpBelow = cond.match(/^HP below (\d+)%$/);
  if (hpBelow) return hp < Number(hpBelow[1]) / 100;
  switch (cond) {
    case "HP above 100%": return hp >= 1;
    case "Two-Handed": return ctx.twoHanded;
    case "Skill Attack": return ctx.isSkill;
    case "Enhance Thrusting Counter Attacks": return ctx.counterHit && ctx.physAttribute === "pierce";
    case "Jump Attack": return /Jumping/.test(name);
    case "Running Attack": return /Running/.test(name);
    case "Guard Counter Attack": return /Guard Counter/.test(name);
    case "Charge Attack":
    case "Charged Attack": return /Charged/.test(name) && !/Feint/.test(name);
    case "Rolling or Backstep": return /Rolling|Backstep/.test(name);
    case "Roar Attack": return /Barbaric Roar|War Cry/.test(name) && /R2/.test(name);
    case "Horseback Attack": return /Mounted/.test(name);
    default: return undefined;
  }
}

function evaluate(effects: SourcedEffect[], ctx: HitContext, side: "attacker" | "defender", relevant: (attr: string) => boolean) {
  const active: SourcedEffect[] = [];
  const ignored: IgnoredEffect[] = [];
  for (const se of effects) {
    if (!relevant(se.effect.attribute)) continue;
    let ok = true;
    for (const c of se.effect.conditions ?? []) {
      const r = conditionHolds(c, ctx, side);
      if (r === undefined) {
        ignored.push({ source: se.source, attribute: se.effect.attribute, reason: `condition "${c}" is not modelled` });
        ok = false;
        break;
      }
      if (!r) ok = false;
    }
    if (ok) active.push(se);
  }
  return { active, ignored };
}

const assumptionsOf = (effects: SourcedEffect[]) => [...new Set(effects.filter((e) => e.cite.startsWith("A")).map((e) => e.cite.slice(0, 2) as AssumptionId))];

const ones = (): PerType => ({ physical: 1, magic: 1, fire: 1, lightning: 1, holy: 1 });
const zeros = (): PerType => ({ physical: 0, magic: 0, fire: 0, lightning: 0, holy: 0 });

export function attackerModifiers(effects: SourcedEffect[], ctx: HitContext): AttackerModifiers {
  const relevant = (a: string) => a === "Attack Power" || a in ELEMENT_ATTACK_ATTR || a in BUILDUP_ATTR;
  const { active, ignored } = evaluate(effects, ctx, "attacker", relevant);
  const out: AttackerModifiers = { attackPowerMultiplier: ones(), flatAdd: zeros(), statusAdd: {}, applied: [], ignored, assumptions: assumptionsOf(active) };
  for (const se of active) {
    const e = se.effect;
    const v = pvpValue(e);
    if (e.attribute === "Attack Power" && e.model === "multiplicative") for (const t of DAMAGE_TYPES) out.attackPowerMultiplier[t] *= v;
    else if (e.attribute in ELEMENT_ATTACK_ATTR) {
      const t = ELEMENT_ATTACK_ATTR[e.attribute]!;
      if (e.model === "multiplicative") out.attackPowerMultiplier[t] *= v;
      else if (e.model === "additive") out.flatAdd[t] += v;
      else { out.ignored.push({ source: se.source, attribute: e.attribute, reason: `model "${e.model}" not modelled` }); continue; }
    } else if (e.attribute in BUILDUP_ATTR && e.model === "additive") {
      const s = BUILDUP_ATTR[e.attribute]!;
      out.statusAdd[s] = (out.statusAdd[s] ?? 0) + v;
    } else { out.ignored.push({ source: se.source, attribute: e.attribute, reason: `model "${e.model}" not modelled` }); continue; }
    out.applied.push({ source: se.source, attribute: e.attribute, value: v, cite: se.cite });
  }
  return out;
}

export function defenderModifiers(effects: SourcedEffect[], ctx: HitContext): DefenderModifiers {
  const relevant = (a: string) => a.endsWith("Absorption");
  const { active, ignored } = evaluate(effects, ctx, "defender", relevant);
  const out: DefenderModifiers = {
    absorptionMultiplier: Object.fromEntries(NEGATION_TYPES.map((t) => [t, 1])) as Record<NegationType, number>,
    absorptionFlatPoints: Object.fromEntries(NEGATION_TYPES.map((t) => [t, 0])) as Record<NegationType, number>,
    applied: [],
    ignored,
    assumptions: assumptionsOf(active),
  };
  for (const se of active) {
    const e = se.effect;
    const v = pvpValue(e);
    for (const t of NEGATION_TYPES) {
      if (!ABSORPTION_ATTRS[t].includes(e.attribute)) continue;
      if (e.model === "multiplicative") out.absorptionMultiplier[t] *= 2 - v;
      else if (e.model === "additive") out.absorptionFlatPoints[t] += v;
    }
    out.applied.push({ source: se.source, attribute: e.attribute, value: v, cite: se.cite });
  }
  return out;
}

/** Counter-hit as a defender effect, per A4's chosen model. */
export function counterHitEffects(): { effects: SourcedEffect[]; pierceDamageMultiplier: number } {
  const a4 = ASSUMPTIONS.A4.choice;
  if (a4.model === "pierce-negation-minus-points") {
    return {
      effects: [{ source: "Counter hit", kind: "condition", cite: "A4 (planner counterhit, PvP)", effect: { attribute: "Pierce Absorption", model: "additive", value: -a4.pierceNegationPointsPvp } }],
      pierceDamageMultiplier: 1,
    };
  }
  return { effects: [], pierceDamageMultiplier: a4.pierceDamageMultiplier };
}

// ---- Collecting a build's effect sources -----------------------------------------------------------

export type ScenarioName = "base" | "duel-start" | "low-hp";

export interface ScenarioOptions {
  scenario: ScenarioName;
  /** Extra buffs/greases on top of the build's own (CLI --buff/--grease). */
  extraBuffs?: string[];
  extraTalismans?: string[];
  extraTears?: string[];
  /** Override current HP fraction (CLI --hp-pct / 100). */
  hpFraction?: number;
}

/** HP fraction a scenario starts from. low-hp = 50% so full-HP effects are off and below-20% effects are not yet on. */
export function scenarioHpFraction(opts: ScenarioOptions): number {
  if (opts.hpFraction !== undefined) return opts.hpFraction;
  return opts.scenario === "low-hp" ? 0.5 : 1;
}

/** Lightning Slash's buff is not in the copy; A9 supplies it (wiki-sourced). */
function a9LightningSlash(): SourcedEffect {
  const a9 = ASSUMPTIONS.A9.choice;
  return {
    source: "Lightning Slash",
    kind: "buff",
    cite: "A9 (wiki)",
    effect: { attribute: "Lightning Attack Power", model: "additive", value: a9.lightningFlat, duration: a9.durationSeconds },
  };
}

/** Effects of one named buff (grease from goods, or a weapon-art buff). Throws if it has no damage effect in data. */
export function buffEffects(data: GameData, name: string): SourcedEffect[] {
  if (name === "Lightning Slash") return [a9LightningSlash()];
  const grease = data.goods.get(name);
  if (grease) {
    if (grease.category !== "Grease") throw new EngineError(`${name} is not a grease or weapon buff.`, "invalid-build");
    return grease.effects.map((effect) => ({ source: name, kind: "buff", effect, cite: "planner goods table" }));
  }
  const art = data.weaponArts.get(name);
  if (art) {
    const fx = art.effects.filter((e) => e.attribute.endsWith("Attack Power") || e.attribute.endsWith("Buildup"));
    if (!fx.length) throw new EngineError(`${name} has no weapon-buff effect in the data.`, "missing-data");
    return fx.map((effect) => ({ source: name, kind: "buff", effect, cite: "planner weapon-art table" }));
  }
  throw new EngineError(`Unknown buff or grease: "${name}".`, "unknown-name");
}

/** All effect sources active for a build under a scenario (talismans/tears per scenario rules, armour always). */
export function buildEffects(data: GameData, build: Build, opts: ScenarioOptions): { attackerSide: SourcedEffect[]; defenderSide: SourcedEffect[]; buffs: SourcedEffect[] } {
  const useEquipment = opts.scenario !== "base"; // docs/03: base = armour only, no talismans/buffs/tears
  const talismans = [...(useEquipment ? build.talismans : []), ...(opts.extraTalismans ?? [])];
  const tears = [...(opts.scenario === "duel-start" ? (build.tears ?? []) : []), ...(opts.extraTears ?? [])];
  const buffNames = [...(useEquipment ? build.buffs : []), ...(opts.extraBuffs ?? [])];

  const all: SourcedEffect[] = [];
  for (const t of talismans) for (const effect of requireFrom(data.talismans, t, "talisman").effects) all.push({ source: t, kind: "talisman", effect, cite: "planner talisman table" });
  for (const t of tears) {
    const g = requireFrom(data.goods, t, "crystal tear");
    if (g.category !== "Crystal Tear") throw new EngineError(`${t} is not a crystal tear.`, "invalid-build");
    for (const effect of g.effects) all.push({ source: t, kind: "tear", effect, cite: "planner goods table" });
  }
  for (const slot of ["head", "body", "arms", "legs"] as const) {
    const n = build.armour[slot];
    if (n) for (const effect of requireFrom(data.armour, n, "armour").effects) all.push({ source: n, kind: "armour", effect, cite: "planner protector table" });
  }
  const buffs = buffNames.flatMap((b) => buffEffects(data, b));
  return { attackerSide: all, defenderSide: all, buffs };
}

/** Stat changes from equipment (e.g. Radagon's Soreseal +5 str), capped at 99 (planner finalStats). Applies in every scenario that uses equipment. */
export function statBonuses(effects: SourcedEffect[]): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {};
  for (const se of effects) {
    const k = STAT_ATTR[se.effect.attribute];
    if (k && se.effect.model === "additive" && !se.effect.conditions?.length) out[k] = (out[k] ?? 0) + pvpValue(se.effect);
  }
  return out;
}

/** Product of multiplicative values for an attribute with no conditions (Poise, Maximum Health, Maximum Equip Load). */
export function unconditionalMultiplier(effects: SourcedEffect[], attribute: string): { value: number; sources: string[] } {
  let value = 1;
  const sources: string[] = [];
  for (const se of effects) {
    if (se.effect.attribute !== attribute || se.effect.model !== "multiplicative" || se.effect.conditions?.length) continue;
    value *= pvpValue(se.effect);
    sources.push(se.source);
  }
  return { value, sources };
}
