// Attack → ordered list of hits. Attack names are the planner's (e.g. "2h R1 1", "Storm Blade - Wind Slash 1").
import type { AssumptionId } from "../assumptions.ts";
import { requireFrom, type GameData } from "../game-data.ts";
import { DAMAGE_TYPES, EngineError, NotSupportedError, type Build, type HitRow, type PerType, type PhysAttribute, type PlannerAttackEntry, type WeaponSlot } from "../types.ts";

export type Hand = "right" | "left";

export interface AttackChoice {
  /** Planner attack name, e.g. "2h R1 1". */
  attack: string;
  /** Which hand's weapon performs it. Default: right hand, then left hand if not found. */
  hand?: Hand;
  /** Weapon slot index in that hand (0–2). Default 0. */
  slot?: number;
  /** Grip while using a skill (ashes ignore 2H for damage, but "Two-Handed" effects check it). Normal attacks: from the name. */
  grip?: "1h" | "2h";
  /** Which hits landed: "all" (default), "first", indices ("1,2"), or kinds ("weapon"/"flat"; aliases blade, wind, projectile). */
  hits?: string;
}

export type HitKind = "weapon" | "flat" | "mixed";

export interface HitDef {
  index: number; // 1-based within the attack
  id: string;
  kind: HitKind;
  row: HitRow;
  mv: PerType;
  flat: PerType;
  finalRate: PerType;
  physAttribute: PhysAttribute;
  /** PvP poise damage, display units (see `poise`). */
  poiseDamage: number;
  poise: PoiseDamageDetail;
  damageLevel: number;
  /** Hitstun level the defender gets (dmgLevel_vsPlayer if set, else dmgLevel). Duration is not supported (needs animations). */
  hitstun: { level: number; name: string };
  /** The hit's own stamina damage if blocked (AtkParam atkStam; 0 on most weapon hits, which use the weapon's stamina attack). null without a row. Blocking is not modelled. */
  staminaDamage: number | null;
  /** Data frame index of the hit (0-based; planner shows +1, A2). 0 with `timingUnknown` when frames aren't in the data. */
  startup: number;
  /** Whether the 2H strength bonus is disabled for this hit (null = unknown: no AtkParam row). */
  disable2H: { value: boolean | null; source: "AtkParam" | "none" };
  /** Skill scaling table (overwriteAttackElementCorrectId) when the hit carries its own flat damage. */
  skillTable: number | null;
  /** Hit's flat damage can't be scaled because it resolves to no AtkParam row. */
  flatUnknownReason?: string;
  /** Set when the hit's active frames aren't in the data (Kick): trades and timing can't be judged. */
  timingUnknown?: string;
}

export interface PoiseDamageDetail {
  /** "regulation": (atkSuperArmor + saWeaponDamage × atkSuperArmorCorrection/100) × saRate × 10. "planner": no AtkParam row. */
  source: "regulation" | "planner";
  formula: string;
  /** The planner's own value for this hit when it differs (it omits the flat part, e.g. Beast's Roar). */
  plannerValue?: number;
}

/** Damage level names (wiki.gg "Damage Level"). */
export const HITSTUN_NAMES: Record<number, string> = {
  0: "none", 1: "short", 2: "moderate", 3: "long", 4: "knockback", 5: "push + long stagger", 6: "faceplant", 7: "knockdown",
  8: "very short", 9: "launch", 10: "knockdown", 11: "knockback + down",
};
export const HITSTUN_DURATION_NOT_SUPPORTED: [string, string, string] = ["Hitstun duration", "needs the hit-reaction animations, which aren't in the data", "animation data"];

export interface ResolvedAttack {
  name: string;
  type: string;
  isSkill: boolean;
  skillName?: string;
  hand: Hand;
  slotIndex: number;
  slot: WeaponSlot;
  twoHanded: boolean;
  entry: PlannerAttackEntry;
  /** All hits of the attack, in data order. */
  allHits: HitDef[];
  /** Hits that landed (per AttackChoice.hits). */
  hits: HitDef[];
  assumptions: AssumptionId[];
}

const ROW_RATES: Record<keyof PerType, keyof HitRow> = {
  physical: "physDamageRateFinal", magic: "magicDamageRateFinal", fire: "fireDamageRateFinal", lightning: "lightningDamageRateFinal", holy: "holyDamageRateFinal",
};
const perType = (row: HitRow, suffix: "DamageMV" | "DamageFlat"): PerType =>
  Object.fromEntries(DAMAGE_TYPES.map((t) => [t, row[`${t}${suffix}` as keyof HitRow] as number])) as PerType;

/** The skill a slot carries: its ash of war, else the weapon's default skill. */
export function slotSkillName(data: GameData, slot: WeaponSlot): string | undefined {
  if (slot.ashOfWar) return slot.ashOfWar;
  const meta = data.weaponMeta.get(slot.weapon);
  if (!meta) return undefined;
  return data.raw.weaponArts.find((a) => a.id === meta.defaultSkillId)?.name;
}

// Kick has no planner or FDE hit row. Its behaviors 300000085/86 → AtkParam 301100800/801 are built into hits.json by the
// data build (source "regulation"). Its animation a712_040000 has no active-frame events, so its timing is unknown.
export const KICK = "Kick";
export const KICK_HIT_IDS = ["300000085:kick", "300000086:kick"];
const KICK_ENTRY: PlannerAttackEntry = { name: KICK, filename: "a712_040000", hitIds: KICK_HIT_IDS, type: "WeaponSkill", categories: [KICK] };
export const KICK_NOT_SUPPORTED: [string, string, string] = ["Kick trade / timing", "Kick's active frames aren't in the data (FDE a712_040000 has no hit events for behaviors 85/86)", "animation data"];

/** Whether the game lets this weapon carry this ash (ash-compat; the weapon's own default skill always counts). */
function gameAllowsAsh(data: GameData, weapon: string, ash: string): boolean {
  return !!data.raw.ashCompat.weapons[weapon]?.ashes[ash];
}

/**
 * Why this slot's skill can't be computed, or null if it can. A skill the game allows but our copy has no attack data for
 * is "not supported" (never borrowed from another weapon class); one the game doesn't allow is an illegal-ash error.
 */
export function skillSupport(data: GameData, slot: WeaponSlot): NotSupportedError | null {
  const skill = slotSkillName(data, slot);
  if (!skill || skill === KICK) return null;
  const moveset = requireFrom(data.movesets, slot.weapon, "weapon moveset");
  if (moveset.some((a) => a.type === "WeaponSkill" && a.categories[0] === skill)) return null;
  if (slot.ashOfWar && !gameAllowsAsh(data, slot.weapon, slot.ashOfWar)) {
    throw new EngineError(`${slot.ashOfWar} can't be used on ${slot.weapon} (the game doesn't allow this ash on this weapon).`, "illegal-ash");
  }
  return new NotSupportedError(`${skill} on ${slot.weapon}`, "no attack data for this skill on this weapon in our copy (planner table or FDE animations)", "animation data for this weapon's ash section (NOTES.md §3)");
}

/** Attacks this slot can perform from this hand. With `strict` (default), an unsupported skill throws NotSupportedError. */
export function attacksForSlot(data: GameData, slot: WeaponSlot, hand: Hand, strict = true): PlannerAttackEntry[] {
  const moveset = requireFrom(data.movesets, slot.weapon, "weapon moveset");
  const skill = slotSkillName(data, slot);
  if (slot.ashOfWar === KICK && !gameAllowsAsh(data, slot.weapon, KICK)) throw new EngineError(`Kick can't be used on ${slot.weapon} (the game doesn't allow this ash on this weapon).`, "illegal-ash");
  const unsupported = skillSupport(data, slot);
  if (unsupported && strict) throw unsupported;
  const kick = skill === KICK && !moveset.some((a) => a.categories[0] === KICK) && hand === "right" ? [KICK_ENTRY] : [];
  return [...moveset, ...kick].filter((a) => {
    if (a.type === "WeaponSkill") return hand === "right" && a.categories[0] === skill; // skills are used from the right-hand weapon
    const offhand = /^(Offhand|Paired)\b/.test(a.name);
    return hand === "left" ? offhand || /^2h /.test(a.name) : !offhand;
  });
}

export interface AttackListing {
  hand: Hand;
  slot: number;
  weapon: string;
  skill?: string;
  attacks: { name: string; type: string; hits: number }[];
  /** Skill attacks we can't list (no data); the normal moveset is still listed. */
  notSupported?: string;
}

export function listAttacks(data: GameData, build: Build): AttackListing[] {
  const out: AttackListing[] = [];
  for (const hand of ["right", "left"] as const) {
    const slots = (hand === "right" ? build.rightHand : build.leftHand) ?? [];
    slots.forEach((slot, i) => {
      if (!slot) return;
      const skill = slotSkillName(data, slot);
      // Only an explicitly mounted ash is flagged here; a default skill without data (e.g. Quickstep) is flagged when asked for.
      const unsupported = hand === "right" && slot.ashOfWar ? skillSupport(data, slot) : null;
      out.push({
        hand, slot: i, weapon: slot.weapon, ...(skill && { skill }),
        attacks: attacksForSlot(data, slot, hand, false).map((a) => ({ name: a.name, type: a.type, hits: a.hitIds.length })),
        ...(unsupported && { notSupported: unsupported.line }),
      });
    });
  }
  return out;
}

function toPhysAttribute(s: string): PhysAttribute {
  const v = s.toLowerCase();
  if (v === "slash" || v === "strike" || v === "pierce" || v === "standard") return v;
  throw new EngineError(`Unexpected physical attribute "${s}" in hit data.`, "missing-data");
}

const notSupportedLineFor = ([what, why, fix]: [string, string, string]) => new NotSupportedError(what, why, fix).line;

/**
 * PvP poise damage in display units: (atkSuperArmor + saWeaponDamage × atkSuperArmorCorrection/100) × saRate × 10.
 * Matches the planner on every normal attack (Shamshir 1H R1 5 raw → 110); the planner leaves out the flat part (atkSuperArmor),
 * so flat-poise skill hits (Beast's Roar, Ice Spear) show 0 there.
 */
function poiseOf(row: HitRow, weaponName: string, data: GameData): { value: number; detail: PoiseDamageDetail } {
  const a = row.atkParam;
  if (!a) {
    if (row.poiseDamageFlat === null) throw new EngineError(`Hit has neither an AtkParam row nor a planner poise value.`, "missing-data");
    return { value: row.poiseDamageFlat, detail: { source: "planner", formula: `${row.poiseDamageFlat} (planner; no AtkParam row)` } };
  }
  const weapon = requireFrom(data.weaponMeta, weaponName, "weapon");
  const raw = a.atkSuperArmor + weapon.saWeaponDamage * (a.atkSuperArmorCorrection / 100);
  const value = raw * row.saDamageRateFinal * 10;
  const detail: PoiseDamageDetail = {
    source: "regulation",
    formula: `(${a.atkSuperArmor} + ${weapon.saWeaponDamage} × ${a.atkSuperArmorCorrection}/100) × ${row.saDamageRateFinal} × 10`,
  };
  if (row.poiseDamageFlat !== null && Math.abs(row.poiseDamageFlat - value) > 0.01) detail.plannerValue = row.poiseDamageFlat;
  return { value, detail };
}

function hitDef(data: GameData, id: string, index: number, weaponName: string): { hit: HitDef; assumptions: AssumptionId[] } {
  const row = requireFrom(data.hits, id, "hit row");
  const mv = perType(row, "DamageMV");
  const flat = perType(row, "DamageFlat");
  const hasMv = DAMAGE_TYPES.some((t) => mv[t] > 0);
  const hasFlat = DAMAGE_TYPES.some((t) => flat[t] > 0);
  const assumptions: AssumptionId[] = [];
  // A8 (confirmed, data): the resolved AtkParam row decides; no row → unknown (not supported when two-handed).
  const disable2H: HitDef["disable2H"] = row.atkParam ? { value: row.atkParam.isDisableBothHandsAtkBonus === 1, source: "AtkParam" } : { value: null, source: "none" };
  const overwrite = row.atkParam?.overwriteAttackElementCorrectId ?? null;
  const poise = poiseOf(row, weaponName, data);
  const level = row.atkParam ? (row.atkParam.dmgLevel_vsPlayer || row.atkParam.dmgLevel) : row.damageLevel;
  const hit: HitDef = {
    index, id, row, mv, flat,
    kind: hasMv && hasFlat ? "mixed" : hasFlat ? "flat" : "weapon",
    finalRate: Object.fromEntries(DAMAGE_TYPES.map((t) => [t, row[ROW_RATES[t]] as number])) as PerType,
    physAttribute: toPhysAttribute(row.physAttribute),
    poiseDamage: poise.value,
    poise: poise.detail,
    damageLevel: level,
    hitstun: { level, name: HITSTUN_NAMES[level] ?? `level ${level}` },
    staminaDamage: row.atkParam?.atkStam ?? null,
    startup: row.startup ?? 0,
    disable2H,
    skillTable: hasFlat && overwrite !== null && overwrite >= 0 ? overwrite : null,
  };
  if (row.startup === null) hit.timingUnknown = notSupportedLineFor(KICK_NOT_SUPPORTED);
  if (hasFlat && !row.atkParam) hit.flatUnknownReason = `hit ${id} has its own flat damage but resolves to no AtkParam row, so its scaling table is unknown`;
  if (hasFlat) assumptions.push("A3");
  return { hit, assumptions };
}

const HIT_KIND_ALIASES: Record<string, HitKind> = { weapon: "weapon", blade: "weapon", swing: "weapon", flat: "flat", wind: "flat", projectile: "flat", wave: "flat", bolt: "flat" };

export function selectHits(all: HitDef[], spec: string | undefined): HitDef[] {
  const s = (spec ?? "all").trim().toLowerCase();
  if (s === "all") return all;
  if (s === "first") return all.slice(0, 1);
  const picked = new Set<HitDef>();
  for (const part of s.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (/^\d+$/.test(part)) {
      const h = all[Number(part) - 1];
      if (!h) throw new EngineError(`Hit ${part} doesn't exist (this attack has ${all.length} hits).`, "invalid-hits");
      picked.add(h);
    } else if (HIT_KIND_ALIASES[part]) {
      const kind = HIT_KIND_ALIASES[part]!;
      const matches = all.filter((h) => h.kind === kind || h.kind === "mixed");
      if (!matches.length) throw new EngineError(`This attack has no ${part} hit (hits: ${all.map((h) => `${h.index}:${h.kind}`).join(", ")}).`, "invalid-hits");
      matches.forEach((h) => picked.add(h));
    } else throw new EngineError(`Unknown hit selector "${part}". Use all, first, numbers (1,2) or weapon/flat (blade/wind).`, "invalid-hits");
  }
  return all.filter((h) => picked.has(h));
}

export function resolveAttack(data: GameData, build: Build, choice: AttackChoice): ResolvedAttack {
  const tryHand = (hand: Hand): ResolvedAttack | undefined => {
    const slots = (hand === "right" ? build.rightHand : build.leftHand) ?? [];
    const slotIndex = choice.slot ?? 0;
    const slot = slots[slotIndex];
    if (!slot) return undefined;
    // Normal attacks stay available when the slot's skill has no data; asking for the skill itself reports it as not supported.
    const entry = attacksForSlot(data, slot, hand, false).find((a) => a.name === choice.attack);
    if (!entry) {
      const unsupported = hand === "right" ? skillSupport(data, slot) : null;
      if (unsupported && choice.attack.startsWith(slotSkillName(data, slot)!)) throw unsupported;
      return undefined;
    }
    const isSkill = entry.type === "WeaponSkill";
    const assumptions = new Set<AssumptionId>();
    const allHits = entry.hitIds.map((id, i) => {
      const { hit, assumptions: a } = hitDef(data, id, i + 1, slot.weapon);
      a.forEach((x) => assumptions.add(x));
      return hit;
    });
    const twoHanded = isSkill ? choice.grip === "2h" : /^2h /.test(entry.name);
    const hits = selectHits(allHits, choice.hits);
    if (!hits.some((h) => h.kind !== "weapon")) assumptions.delete("A3");
    return {
      name: entry.name, type: entry.type, isSkill, ...(isSkill && { skillName: entry.categories[0] }),
      hand, slotIndex, slot, twoHanded, entry, allHits, hits, assumptions: [...assumptions],
    };
  };
  const hands: Hand[] = choice.hand ? [choice.hand] : ["right", "left"];
  for (const h of hands) {
    const r = tryHand(h);
    if (r) return r;
  }
  const available = listAttacks(data, build).flatMap((l) => l.attacks.map((a) => a.name)).slice(0, 12);
  throw new EngineError(`This build can't do "${choice.attack}". Some available attacks: ${available.join(", ")}… (use the attacks command for the full list).`, "unknown-attack");
}
