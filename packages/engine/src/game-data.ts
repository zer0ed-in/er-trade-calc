// Indexes RawGameData once into lookup maps. Pure: no I/O.
import { decodeRegulationData, type Weapon } from "./ar/vendor/tom-clark.ts";
import {
  EngineError,
  type AnimationFrames,
  type ArmourPiece,
  type CalcCorrectGraphRow,
  type HitRow,
  type ItemWithEffects,
  type PlannerAttackEntry,
  type RawGameData,
  type WeaponArt,
  type WeaponMeta,
} from "./types.ts";

// Infusion name → affinity id in Tom Clark's data (0 Standard … 12 Occult; unique/somber weapons are -1).
export const INFUSIONS = ["Standard", "Heavy", "Keen", "Quality", "Fire", "Flame Art", "Lightning", "Sacred", "Magic", "Cold", "Poison", "Blood", "Occult"] as const;

// Greases only go on Standard, Heavy or Keen weapons (Zer0, in-game, 2026-11-12; docs/09 Q12). Not in the data copy.
// Weapon-art buffs (Sacred Blade, Lightning Slash…) are not greases and are not limited by this.
export const GREASE_INFUSIONS: readonly string[] = ["Standard", "Heavy", "Keen"];

// Shared extra hit rows (behaviors 500 and 500000000–500000008). They ride along with a real hit on normal attacks of ~30 weapons
// (Lance, Treespear, Great Club…). 500000000–500000008 resolve to AtkParam 1703001–1703009: MV 200–460, no stamina cost,
// opposeTarget 1; their purpose is unknown, so they stay excluded. Behavior 500 resolves to AtkParam 300 (MV 100). The planner drops them
// (router-*.js filters 500/500000003); we drop exactly these ids. Zero-stamina rows in general are real hits and stay.
export const SHARED_EXTRA_HIT_ROW_IDS: ReadonlySet<number> = new Set([500, 500000000, 500000001, 500000002, 500000003, 500000004, 500000005, 500000006, 500000007, 500000008]);
const isSharedExtraHit = (hitId: string) => SHARED_EXTRA_HIT_ROW_IDS.has(Number(hitId.split(":")[0]));
// Mounted attacks are out of scope (Zer0, 2026-11-13): removed from every move list.
const isMounted = (attackName: string) => /^Mounted\b/.test(attackName);

/** Move lists as the engine uses them: no mounted attacks, no shared extra hit rows, no attack left without hits. */
function cleanMovesets(movesets: Record<string, PlannerAttackEntry[]>): Map<string, PlannerAttackEntry[]> {
  const out = new Map<string, PlannerAttackEntry[]>();
  for (const [weapon, attacks] of Object.entries(movesets)) {
    out.set(
      weapon,
      attacks
        .filter((a) => !isMounted(a.name))
        .map((a) => ({ ...a, hitIds: a.hitIds.filter((id) => !isSharedExtraHit(id)) }))
        .filter((a) => a.hitIds.length > 0),
    );
  }
  return out;
}

export interface GameData {
  raw: RawGameData;
  patch: string;
  arWeapons: Map<string, Weapon>; // key `${weaponName}|${affinityId}`
  /** ReinforceParamWeapon id per AR weapon (same key) — selects the planner reinforcement table. */
  reinforceTypeId: Map<string, number>;
  weaponMeta: Map<string, WeaponMeta>;
  armour: Map<string, ArmourPiece>;
  talismans: Map<string, ItemWithEffects>;
  goods: Map<string, ItemWithEffects>;
  weaponArts: Map<string, WeaponArt>;
  classes: Map<string, RawGameData["classes"][number]>;
  movesets: Map<string, PlannerAttackEntry[]>;
  hits: Map<string, HitRow>;
  animations: Map<string, AnimationFrames>;
  graphs: Map<number, CalcCorrectGraphRow>;
  spEffect: (id: number) => Record<string, unknown> | undefined;
}

const byName = <T extends { name: string }>(rows: T[]) => new Map(rows.map((r) => [r.name, r]));

export function indexGameData(raw: RawGameData): GameData {
  const arWeapons = new Map<string, Weapon>();
  for (const w of decodeRegulationData(raw.tcRegulation)) arWeapons.set(`${w.weaponName}|${w.affinityId}`, w);
  const reinforceTypeId = new Map(raw.tcRegulation.weapons.map((w) => [`${w.weaponName}|${w.affinityId}`, w.reinforceTypeId]));
  const sp = new Map(raw.speffects.map((r) => [r["Row ID"] as number, r]));
  return {
    raw,
    patch: raw.patch,
    arWeapons,
    reinforceTypeId,
    weaponMeta: byName(raw.weapons),
    armour: byName(raw.armour),
    talismans: byName(raw.talismans),
    goods: byName(raw.goods),
    weaponArts: byName(raw.weaponArts),
    classes: byName(raw.classes),
    movesets: cleanMovesets(raw.movesets),
    hits: new Map(Object.entries(raw.hits)),
    animations: new Map(Object.entries(raw.animations)),
    graphs: new Map(Object.entries(raw.calcCorrectGraphs).map(([k, v]) => [Number(k), v])),
    spEffect: (id) => sp.get(id),
  };
}

export function requireFrom<T>(map: Map<string, T>, key: string, what: string): T {
  const v = map.get(key);
  if (v === undefined) throw new EngineError(`Unknown ${what}: "${key}" (not in the patch ${what} data).`, "unknown-name");
  return v;
}

/**
 * Planner CalcCorrectGraph interpolation (planner `getCorrectionGraphValueAt`), returning the raw value
 * (e.g. graph 100 at vig 60 → 1900 HP; defence graphs in defence points). Callers floor where the planner does.
 */
export function correctionGraphValue(data: GameData, graphId: number, x: number): number {
  const g = data.graphs.get(graphId);
  if (!g) throw new EngineError(`CalcCorrectGraph ${graphId} not in data`, "missing-data");
  const stages: [number, number, number, number, number][] = [
    [g.stageMaxVal4, g.stageMaxVal4 + 1, g.stageMaxGrowVal4, g.stageMaxGrowVal4, 0],
    [g.stageMaxVal3, g.stageMaxVal4, g.stageMaxGrowVal4, g.stageMaxGrowVal3, g.adjPt_maxGrowVal3],
    [g.stageMaxVal2, g.stageMaxVal3, g.stageMaxGrowVal3, g.stageMaxGrowVal2, g.adjPt_maxGrowVal2],
    [g.stageMaxVal1, g.stageMaxVal2, g.stageMaxGrowVal2, g.stageMaxGrowVal1, g.adjPt_maxGrowVal1],
    [g.stageMaxVal0, g.stageMaxVal1, g.stageMaxGrowVal1, g.stageMaxGrowVal0, g.adjPt_maxGrowVal0],
  ];
  for (const [lo, hi, growHi, growLo, adj] of stages) {
    if (x >= lo) {
      const t = (x - lo) / (hi - lo);
      const shaped = adj < 0 ? 1 - (1 - t) ** -adj : t ** adj;
      return growLo + (growHi - growLo) * shaped;
    }
  }
  return g.stageMaxGrowVal0;
}
