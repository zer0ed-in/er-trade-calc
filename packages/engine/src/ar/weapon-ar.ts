// Weapon AR per damage type via Tom Clark's calculator (vendored, MIT).
import { allDamageTypes, getWeaponAttack, type Weapon } from "./vendor/tom-clark.ts";
import { INFUSIONS, type GameData } from "../game-data.ts";
import { DAMAGE_TYPES, EngineError, type PerType, type Stats, type WeaponSlot } from "../types.ts";

export interface WeaponAr {
  weapon: Weapon;
  ar: PerType;
  /** Status buildup AR (bleed, frost, …) keyed by planner-style names. */
  status: Record<string, number>;
  twoHandBonusApplied: boolean;
  effectiveStr: number;
  ineffectiveAttributes: string[];
  maxUpgrade: number;
}

const STATUS_NAMES: Record<number, string> = { 5: "poison", 6: "scarlet_rot", 7: "bleed", 8: "frostbite", 9: "sleep", 10: "madness", 11: "deathblight" };

export function resolveArWeapon(data: GameData, slot: WeaponSlot): { weapon: Weapon; maxUpgrade: number } {
  const unique = data.arWeapons.get(`${slot.weapon}|-1`);
  let weapon: Weapon | undefined;
  if (unique) {
    if (slot.infusion !== "Standard") throw new EngineError(`${slot.weapon} cannot be infused (unique weapon); use infusion "Standard".`, "illegal-infusion");
    weapon = unique;
  } else {
    const affinityId = (INFUSIONS as readonly string[]).indexOf(slot.infusion);
    if (affinityId < 0) throw new EngineError(`Unknown infusion "${slot.infusion}". Valid: ${INFUSIONS.join(", ")}.`, "unknown-name");
    weapon = data.arWeapons.get(`${slot.weapon}|${affinityId}`);
    if (!weapon) throw new EngineError(`No ${slot.infusion} ${slot.weapon} in the patch ${data.patch} weapon data.`, "unknown-name");
  }
  const maxUpgrade = weapon.attack.length - 1;
  // Scope rule (docs/03 rule 16): fully upgraded only.
  if (slot.upgrade !== maxUpgrade) {
    throw new EngineError(
      `${slot.weapon} must be at +${maxUpgrade} (${maxUpgrade === 10 ? "somber" : "regular"}); got +${slot.upgrade}. Only +25 regular / +10 somber weapons are supported.`,
      "illegal-upgrade",
    );
  }
  return { weapon, maxUpgrade };
}

export function weaponAr(data: GameData, slot: WeaponSlot, stats: Stats, opts: { twoHanded: boolean; disableTwoHandBonus: boolean }): WeaponAr {
  const { weapon, maxUpgrade } = resolveArWeapon(data, slot);
  const attributes = { str: stats.str, dex: stats.dex, int: stats.int, fai: stats.fth, arc: stats.arc };
  const result = getWeaponAttack({ weapon, attributes, twoHanding: opts.twoHanded, upgradeLevel: slot.upgrade, disableTwoHandingBonus: opts.disableTwoHandBonus });
  const ar = Object.fromEntries(DAMAGE_TYPES.map((t, i) => [t, result.attackPower[allDamageTypes[i]!] ?? 0])) as PerType;
  const status: Record<string, number> = {};
  for (const [id, name] of Object.entries(STATUS_NAMES)) {
    const v = result.attackPower[Number(id) as keyof typeof result.attackPower];
    if (v) status[name] = v;
  }
  return {
    weapon,
    ar,
    status,
    twoHandBonusApplied: result.effectiveAttributes.str !== attributes.str,
    effectiveStr: result.effectiveAttributes.str,
    ineffectiveAttributes: result.ineffectiveAttributes,
    maxUpgrade,
  };
}
