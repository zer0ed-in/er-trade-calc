// Ash-of-war compatibility (which ash fits which weapon, with which infusions). Port of the planner's rule
// (Nc/Pc in notifications-*.js), verified 116/116 against the game's EquipParamGem by Row ID.
// Output must stay byte-identical to the reference generator's (Python json.dump, indent 1, no trailing newline),
// so field order, null for missing values and key sorting mirror it exactly.
import { evalLiteral, matchLiteralEnd } from "./js-literal.ts";

export const AFFINITIES = ["Standard", "Heavy", "Keen", "Quality", "Fire", "Flame Art", "Lightning", "Sacred", "Magic", "Cold", "Poison", "Blood", "Occult"] as const;
// Classes that never take a melee ash (ranged, catalysts, shields, torches, perfume).
const SKIP_CATEGORIES = new Set(["Light Bow", "Bow", "Greatbow", "Crossbow", "Ballista", "Glintstone Staff", "Sacred Seal", "Small Shield", "Medium Shield", "Greatshield", "Torch", "Thrusting Shield", "Perfume Bottle"]);

export interface PlannerAsh {
  id: number;
  name: string;
  armament_categories: string[];
  default_affinity: string;
  possible_affinities: string[];
  skill_id: number;
  apply_aow_exclusions?: boolean;
  dlc?: number[];
}
interface Armament {
  category: string;
  allow_ash_of_war?: boolean;
  apply_aow_exclusions?: boolean;
  is_buffable?: boolean;
  requirements?: Record<string, number>;
  weight?: number;
  dlc?: number[];
  default_skill_id?: number;
  affinity: Record<string, unknown>;
}

/**
 * The planner's ash table (`"Lightning Slash":{full_hex_id:…}` and siblings). Some entries are variable references
 * (e.g. `Gravitas:Pn`); those are resolved to the identifier's literal assignment. Empty placeholder assignments
 * (`Pn={}` elsewhere in the bundle) are skipped — the reference extractor picked one and lost Gravitas.
 */
export function extractPlannerAshes(bundle: string): Record<string, PlannerAsh> {
  const needle = '"Lightning Slash":{full_hex_id:';
  const at = bundle.indexOf(needle);
  if (at < 0) throw new Error("ash table not found in planner bundle");
  let open = -1;
  for (let i = at - 1; i >= 0; i--) {
    if (bundle[i] !== "{") continue;
    let end: number;
    try {
      end = matchLiteralEnd(bundle, i);
    } catch {
      continue;
    }
    if (end > at + needle.length + 5000) {
      open = i;
      break;
    }
  }
  if (open < 0) throw new Error("enclosing ash table literal not found");
  const literal = bundle.slice(open, matchLiteralEnd(bundle, open));
  const context: Record<string, unknown> = {};
  const table = evalWithRefs(bundle, literal, context) as Record<string, PlannerAsh>;
  for (const [key, ash] of Object.entries(table)) {
    if (!ash || ash.name !== key) throw new Error(`ash table entry ${key} did not resolve to an ash (got ${JSON.stringify(ash)?.slice(0, 80)})`);
  }
  return table;
}

function evalWithRefs(bundle: string, literal: string, context: Record<string, unknown>): unknown {
  for (let attempt = 0; attempt < 200; attempt++) {
    // References become parameters of an arrow function, so nothing is written to the sandbox's globals.
    const names = Object.keys(context);
    const source = `((${names.join(",")})=>(${literal}))(${names.map((n) => JSON.stringify(context[n])).join(",")})`;
    try {
      return evalLiteral(source);
    } catch (error) {
      const missing = String(error).match(/ReferenceError: (\S+) is not defined/)?.[1];
      if (!missing) throw error;
      context[missing] = assignedNonEmpty(bundle, missing);
    }
  }
  throw new Error("too many unresolved references in ash table");
}

function assignedNonEmpty(bundle: string, ident: string): unknown {
  const re = new RegExp(`(?:^|[,;{}\\s])${ident.replace(/\$/g, "\\$")}=([{\\[])`, "g");
  for (const m of bundle.matchAll(re)) {
    const open = m.index! + m[0].length - 1;
    let text: string;
    try {
      text = bundle.slice(open, matchLiteralEnd(bundle, open));
    } catch {
      continue;
    }
    if (text === "{}" || text === "[]") continue;
    try {
      return evalLiteral(text);
    } catch {
      // not a pure literal at this site
    }
  }
  throw new Error(`cannot resolve ${ident} in planner bundle`);
}

const canMount = (weapon: Armament, ash: PlannerAsh) =>
  !!weapon.allow_ash_of_war && !(ash.apply_aow_exclusions && weapon.apply_aow_exclusions) && ash.armament_categories.includes(weapon.category);
const allowed = (weapon: Armament, ash: PlannerAsh, affinity: string) =>
  canMount(weapon, ash) && (affinity === "Standard" || affinity in weapon.affinity) && ash.possible_affinities.includes(affinity);

const sortedEntries = <T>(o: Record<string, T>) => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const orNull = <T>(v: T | undefined) => (v === undefined ? null : v);

export function buildAshCompat(
  armaments: Record<string, Armament>,
  ashes: Record<string, PlannerAsh>,
  swordArts: { "Row ID": number; isGrayoutLeftHand?: number }[],
  weaponArts: { id: number; fpCost?: { L2?: number } }[],
  patch: string,
): string {
  const swordArtById = new Map(swordArts.map((r) => [r["Row ID"], r]));
  const weaponArtById = new Map(weaponArts.map((w) => [w.id, w]));
  const sortedAshes = sortedEntries(ashes);
  const weapons: Record<string, unknown> = {};
  for (const [name, weapon] of sortedEntries(armaments)) {
    if (SKIP_CATEGORIES.has(weapon.category)) continue;
    const entry: Record<string, unknown> = {
      category: weapon.category,
      somber: !weapon.allow_ash_of_war,
      buffable: orNull(weapon.is_buffable),
      requirements: weapon.requirements ?? {},
      weight: orNull(weapon.weight),
      dlc: orNull(weapon.dlc),
      default_skill_id: orNull(weapon.default_skill_id),
    };
    if (weapon.allow_ash_of_war) {
      const fits: Record<string, string[]> = {};
      for (const [ashName, ash] of sortedAshes) {
        if (!canMount(weapon, ash)) continue;
        const infusions = AFFINITIES.filter((a) => allowed(weapon, ash, a));
        if (infusions.length) fits[ashName] = infusions;
      }
      entry.ashes = fits;
    } else {
      entry.ashes = {};
      entry.note = "unique skill; Standard only; no ash of war, no infusion";
    }
    weapons[name] = entry;
  }
  const ashMeta: Record<string, unknown> = {};
  for (const [ashName, ash] of sortedAshes) {
    const swordArt = swordArtById.get(ash.skill_id);
    ashMeta[ashName] = {
      default_affinity: ash.default_affinity,
      affinities: ash.possible_affinities,
      weapon_classes: ash.armament_categories,
      usable_from_off_hand: swordArt?.isGrayoutLeftHand === 0,
      fp_L2: orNull(weaponArtById.get(ash.skill_id)?.fpCost?.L2),
      dlc: orNull(ash.dlc),
    };
  }
  const doc = {
    patch,
    source: "Emilia's ER Build Planner ash-of-war table, cross-checked row by row against the game's EquipParamGem (116/116 ashes match: weapon classes, infusions, default infusion).",
    rule: "An ash fits a weapon if the weapon accepts ashes, its class is in the ash's weapon classes, and it is not a DLC-exclusion pair. An infusion is possible only through an ash that allows it. Somber/unique weapons take no ash and stay Standard.",
    weapons,
    ashes: ashMeta,
  };
  return JSON.stringify(doc, null, 1);
}
