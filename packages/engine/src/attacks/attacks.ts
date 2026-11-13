// Attack → ordered list of hits. Attack names are the planner's (e.g. "2h R1 1", "Storm Blade - Wind Slash 1").
import { ASSUMPTIONS, type AssumptionId } from "../assumptions.ts";
import { requireFrom, type GameData } from "../game-data.ts";
import { DAMAGE_TYPES, EngineError, type Build, type HitRow, type PerType, type PhysAttribute, type PlannerAttackEntry, type WeaponSlot } from "../types.ts";

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
  poiseDamage: number;
  damageLevel: number;
  /** Data frame index of the hit (0-based; planner shows +1, A2). */
  startup: number;
  /** Whether the 2H strength bonus is disabled for this hit, and why. */
  disable2H: { value: boolean; source: "AtkParam" | "A8" };
  /** Skill scaling table (overwriteAttackElementCorrectId) when the hit carries its own flat damage. */
  skillTable: number | null;
  /** Hit's flat damage can't be scaled because its AtkParam row is missing from the copy. */
  flatUnknownReason?: string;
}

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

/** Attacks this slot can perform from this hand. */
export function attacksForSlot(data: GameData, slot: WeaponSlot, hand: Hand): PlannerAttackEntry[] {
  const moveset = requireFrom(data.movesets, slot.weapon, "weapon moveset");
  const skill = slotSkillName(data, slot);
  if (slot.ashOfWar && !moveset.some((a) => a.type === "WeaponSkill" && a.categories[0] === slot.ashOfWar)) {
    throw new EngineError(`${slot.ashOfWar} can't be used on ${slot.weapon} (no such skill in the weapon's attack data).`, "illegal-ash");
  }
  return moveset.filter((a) => {
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
}

export function listAttacks(data: GameData, build: Build): AttackListing[] {
  const out: AttackListing[] = [];
  for (const hand of ["right", "left"] as const) {
    const slots = (hand === "right" ? build.rightHand : build.leftHand) ?? [];
    slots.forEach((slot, i) => {
      if (!slot) return;
      const skill = slotSkillName(data, slot);
      out.push({
        hand, slot: i, weapon: slot.weapon, ...(skill && { skill }),
        attacks: attacksForSlot(data, slot, hand).map((a) => ({ name: a.name, type: a.type, hits: a.hitIds.length })),
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

function hitDef(data: GameData, id: string, index: number, isSkill: boolean): { hit: HitDef; assumptions: AssumptionId[] } {
  const row = requireFrom(data.hits, id, "hit row");
  const mv = perType(row, "DamageMV");
  const flat = perType(row, "DamageFlat");
  const hasMv = DAMAGE_TYPES.some((t) => mv[t] > 0);
  const hasFlat = DAMAGE_TYPES.some((t) => flat[t] > 0);
  const assumptions: AssumptionId[] = [];
  let disable2H: HitDef["disable2H"];
  if (row.atkParam) disable2H = { value: row.atkParam.isDisableBothHandsAtkBonus === 1, source: "AtkParam" };
  else {
    const a8 = ASSUMPTIONS.A8.choice;
    disable2H = { value: isSkill ? !a8.missingRowSkillHit2H : !a8.missingRowNormalAttack2H, source: "A8" };
  }
  const overwrite = row.atkParam?.overwriteAttackElementCorrectId ?? null;
  const hit: HitDef = {
    index, id, row, mv, flat,
    kind: hasMv && hasFlat ? "mixed" : hasFlat ? "flat" : "weapon",
    finalRate: Object.fromEntries(DAMAGE_TYPES.map((t) => [t, row[ROW_RATES[t]] as number])) as PerType,
    physAttribute: toPhysAttribute(row.physAttribute),
    poiseDamage: row.poiseDamageFlat,
    damageLevel: row.damageLevel,
    startup: row.startup,
    disable2H,
    skillTable: hasFlat && overwrite !== null && overwrite >= 0 ? overwrite : null,
  };
  if (hasFlat && !row.atkParam) hit.flatUnknownReason = `hit ${id} has its own flat damage but no AtkParam row in the copy, so its scaling table is unknown`;
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
    const entry = attacksForSlot(data, slot, hand).find((a) => a.name === choice.attack);
    if (!entry) return undefined;
    const isSkill = entry.type === "WeaponSkill";
    const assumptions = new Set<AssumptionId>();
    const allHits = entry.hitIds.map((id, i) => {
      const { hit, assumptions: a } = hitDef(data, id, i + 1, isSkill);
      a.forEach((x) => assumptions.add(x));
      return hit;
    });
    const twoHanded = isSkill ? choice.grip === "2h" : /^2h /.test(entry.name);
    const hits = selectHits(allHits, choice.hits);
    // A8 matters only when it decides whether a two-handed hit gets the str bonus.
    if (twoHanded && hits.some((h) => h.disable2H.source === "A8")) assumptions.add("A8");
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
