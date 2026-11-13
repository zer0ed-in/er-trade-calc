// Shared engine types. The engine never reads files: `RawGameData` is handed in (packages/data loads it).
import type { EncodedRegulationDataJson } from "./ar/vendor/tom-clark.ts";
import type { AssumptionId } from "./assumptions.ts";

export const STAT_KEYS = ["vig", "mnd", "end", "str", "dex", "int", "fth", "arc"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const DAMAGE_TYPES = ["physical", "magic", "fire", "lightning", "holy"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type PerType<T = number> = Record<DamageType, T>;

/** Physical attribute of a hit — decides which armour negation applies to the physical share. */
export type PhysAttribute = "standard" | "slash" | "strike" | "pierce";
export type NegationType = PhysAttribute | Exclude<DamageType, "physical">;

// ---- Builds ---------------------------------------------------------------------------------------

export interface WeaponSlot {
  weapon: string;
  /** "Standard" | "Heavy" | "Keen" | … ; somber/unique weapons use "Standard". */
  infusion: string;
  upgrade: number;
  ashOfWar?: string;
}

export interface Build {
  id?: string;
  name?: string;
  class: string;
  stats: Stats;
  /** Up to 3 slots; index 0 is the active weapon unless chosen otherwise. */
  rightHand: (WeaponSlot | null)[];
  leftHand?: (WeaponSlot | null)[];
  armour: { head?: string | null; body?: string | null; arms?: string | null; legs?: string | null };
  talismans: string[];
  /** Crystal tears mixed in the physick (only relevant ones are modelled, e.g. Opaline Hardtear, Crimson Bubbletear). */
  tears?: string[];
  /** Active weapon buffs / greases on the right-hand weapon, e.g. "Sacred Blade", "Drawstring Dragonbolt Grease". */
  buffs: string[];
}

// ---- Raw generated data (packages/data/gen/<patch>/) -------------------------------------------

export interface PlannerEffect {
  attribute: string;
  value: number;
  value_pvp?: number;
  model: string;
  type?: string;
  conditions?: string[];
  duration?: number;
  activation?: string;
}

export interface CalcCorrectGraphRow {
  stageMaxVal0: number; stageMaxVal1: number; stageMaxVal2: number; stageMaxVal3: number; stageMaxVal4: number;
  stageMaxGrowVal0: number; stageMaxGrowVal1: number; stageMaxGrowVal2: number; stageMaxGrowVal3: number; stageMaxGrowVal4: number;
  adjPt_maxGrowVal0: number; adjPt_maxGrowVal1: number; adjPt_maxGrowVal2: number; adjPt_maxGrowVal3: number; adjPt_maxGrowVal4: number;
}

export interface ArmourPiece {
  id: number;
  name: string;
  slot: "head" | "body" | "arms" | "legs";
  weight: number;
  cutRate: Record<NegationType, number>;
  poise: number;
  effects: PlannerEffect[];
  resistances: Record<"immunity" | "robustness" | "focus" | "vitality", number> | null;
}

export interface ItemWithEffects {
  id: number;
  name: string;
  weight?: number;
  category?: string;
  effects: PlannerEffect[];
  conflicts?: string[];
}

export interface WeaponArt {
  id: number;
  name: string;
  types: string[];
  effects: PlannerEffect[];
  fpCost: Record<"L1" | "L2" | "R1" | "R2", number | undefined>;
}

export interface WeaponMeta {
  id: number;
  name: string;
  category: string;
  weight: number;
  isBuffable: boolean;
  allowAshOfWar: boolean;
  attackAttributes: string[];
  requirements: Record<string, number>;
  somber: boolean;
  defaultSkillId: number;
}

export interface PlannerAttackEntry {
  name: string;
  filename: string;
  hitIds: string[];
  type: string; // "Attack" | "WeaponSkill" | "Casting" | "Item"
  categories: string[];
  ha?: { damageMultiplier: number; poiseContribution: number; poiseDamageMultiplier: number; armourPoiseContribution: number };
  /** Where the entry came from: the planner's per-weapon table (default) or FDE's animation `users` lists (ashes the planner lacks). */
  source?: "fde-animation-users";
}

export interface HitRow {
  damageLevel: number;
  physicalDamageMV: number; magicDamageMV: number; fireDamageMV: number; lightningDamageMV: number; holyDamageMV: number;
  physicalDamageFlat: number; magicDamageFlat: number; fireDamageFlat: number; lightningDamageFlat: number; holyDamageFlat: number;
  physDamageRateFinal: number; magicDamageRateFinal: number; fireDamageRateFinal: number; lightningDamageRateFinal: number; holyDamageRateFinal: number;
  poiseDamageFlat: number;
  poiseDamageMV: number;
  statusMV: number;
  buffMV: number;
  staminaCost: number;
  physAttribute: string;
  startup: number;
  bloodBuildup: number; frostBuildup: number; poisonBuidup: number; scarletRotBuidup: number; sleepBuildup: number; madnessBuildup: number; curseBuildup: number;
  atkParam: null | {
    id: number;
    isAddBaseAtk: number;
    overwriteAttackElementCorrectId: number;
    isDisableBothHandsAtkBonus: number;
    finalDamageRateId: number;
    atkAttribute: number;
  };
}

export interface AnimationFrames {
  name: string;
  /** FDE labels, e.g. Attack, WeaponSkill, HasBullet, HyperArmour. */
  labels?: string[];
  activeFrames: { range: [number, number]; params?: { AtkParamID?: string[] } }[];
  hyperArmour: { range: [number, number]; id?: number; super?: boolean }[];
  spEffects: { range: [number, number]; id: number }[];
}

export type CorrectionAttackRow = {
  correction: Record<DamageType, Record<string, boolean>>;
  override: Record<DamageType, Record<string, number>>;
  ratio: Record<DamageType, Record<string, number>>;
};

export interface ReinforcementLevel {
  level: number;
  damage: Record<DamageType | "stamina", number>;
  scaling: Record<"strength" | "dexterity" | "intelligence" | "faith" | "arcane", number>;
}

export interface RawGameData {
  patch: string;
  tcRegulation: EncodedRegulationDataJson;
  calcCorrectGraphs: Record<string, CalcCorrectGraphRow>;
  classes: { name: string; level: number; base: Stats }[];
  statTables: { maxEquipLoadByEndurance: number[]; maxFpByMind: number[]; maxStaminaByEndurance: number[] };
  correctionAttack: Record<string, CorrectionAttackRow>;
  reinforcements: Record<string, ReinforcementLevel[]>;
  talismans: ItemWithEffects[];
  goods: ItemWithEffects[];
  weaponArts: WeaponArt[];
  armour: ArmourPiece[];
  weapons: WeaponMeta[];
  movesets: Record<string, PlannerAttackEntry[]>;
  hits: Record<string, HitRow>;
  animations: Record<string, AnimationFrames>;
  speffects: Record<string, unknown>[];
  plannerRulesets: unknown;
  /** Which ash fits which weapon and infusion (gen ash-compat.json, planner rule verified against EquipParamGem). */
  ashCompat: AshCompat;
}

export interface AshCompat {
  weapons: Record<string, { category: string; somber: boolean; ashes: Record<string, string[]> }>;
  ashes: Record<string, { default_affinity: string; affinities: string[]; weapon_classes: string[]; usable_from_off_hand: boolean }>;
}

// ---- Results --------------------------------------------------------------------------------------

export interface Sourced<T> {
  value: T;
  /** Where the number came from, e.g. "gen/1.17 armour.json (EquipParamProtector)". */
  source: string;
}

export interface ResultMeta {
  patch: string;
  assumptionsUsed: AssumptionId[];
  /** Loud warnings to show at the top of any rendering (e.g. projectile damage uses unverified A3). */
  warnings: string[];
  /** "Not supported right now: <what> — <why> — <what will fix it>" lines; empty when everything was computed. */
  notSupported: string[];
  credit: string;
}

/** Engine errors are user-facing: plain English, naming the rule or missing data. */
export const NOT_SUPPORTED = "Not supported right now";
export const notSupportedLine = (what: string, why: string, fix: string) => `${NOT_SUPPORTED}: ${what} — ${why} — ${fix}`;

export class EngineError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "EngineError";
  }
}

/** Data we don't have (never guessed). Batches catch it, continue, and list it at the end. */
export class NotSupportedError extends EngineError {
  readonly line: string;
  constructor(what: string, why: string, fix: string) {
    super(notSupportedLine(what, why, fix), "not-supported");
    this.line = notSupportedLine(what, why, fix);
  }
}
