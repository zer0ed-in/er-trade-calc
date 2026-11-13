// Vendored from Tom Clark's elden-ring-weapon-calculator (MIT), commit 3539d87e446f3b9d5b94157f8a2023e28ffea7d2:
//   src/calculator/{attackPowerTypes,attributes,weapon,calculator}.ts and src/regulationData.ts
// Copyright (c) 2022 Tom Clark <tom@tclark.io> — full licence text in ./COPYING.
//
// Changes from upstream (logic otherwise unchanged):
//  - merged into one file; types tightened for `strict` + `noUncheckedIndexedAccess`
//  - Reforged/mod paths (`reforgedQuirks`), wiki urls, scaling tiers and sorcery/incantation spell scaling removed (vanilla PvP only)
//  - `twoHandingBonus` can be forced off per hit (`disableTwoHandingBonus`) for AtkParam isDisableBothHandsAtkBonus (docs/03 rule 11a)

export const AttackPowerType = {
  PHYSICAL: 0, MAGIC: 1, FIRE: 2, LIGHTNING: 3, HOLY: 4,
  POISON: 5, SCARLET_ROT: 6, BLEED: 7, FROST: 8, SLEEP: 9, MADNESS: 10, DEATH_BLIGHT: 11,
} as const;
export type AttackPowerType = (typeof AttackPowerType)[keyof typeof AttackPowerType];

export const allDamageTypes: AttackPowerType[] = [0, 1, 2, 3, 4];
export const allStatusTypes: AttackPowerType[] = [5, 6, 7, 8, 9, 10, 11];

export const allAttributes = ["str", "dex", "int", "fai", "arc"] as const;
export type Attribute = (typeof allAttributes)[number];
export type Attributes = Record<Attribute, number>;

export type AttackElementCorrect = Partial<Record<AttackPowerType, Partial<Record<Attribute, number | true | undefined>>>>;

// Weapon types that are always two-handed (bows/ballistae).
const ALWAYS_TWO_HANDED_TYPES = new Set([50, 51, 53, 56]);

export interface Weapon {
  name: string;
  weaponName: string;
  affinityId: number;
  weaponType: number;
  requirements: Partial<Record<Attribute, number>>;
  attributeScaling: Partial<Record<Attribute, number>>[];
  attack: Partial<Record<AttackPowerType, number>>[];
  attackElementCorrect: AttackElementCorrect;
  calcCorrectGraphs: Record<AttackPowerType, number[]>;
  paired?: boolean;
  sorceryTool?: boolean;
  incantationTool?: boolean;
  dlc: boolean;
}

export interface WeaponAttackResult {
  upgradeLevel: number;
  attackPower: Partial<Record<AttackPowerType, number>>;
  ineffectiveAttributes: Attribute[];
  ineffectiveAttackPowerTypes: AttackPowerType[];
  /** Attributes after the 2H adjustment actually used for scaling. */
  effectiveAttributes: Attributes;
}

export function adjustAttributesForTwoHanding(opts: { twoHanding: boolean; weapon: Weapon; attributes: Attributes; disableTwoHandingBonus?: boolean }): Attributes {
  let twoHandingBonus = opts.twoHanding;
  if (opts.weapon.paired) twoHandingBonus = false; // paired weapons do not get the 2H bonus
  if (ALWAYS_TWO_HANDED_TYPES.has(opts.weapon.weaponType)) twoHandingBonus = true;
  if (opts.disableTwoHandingBonus) twoHandingBonus = false;
  return twoHandingBonus ? { ...opts.attributes, str: Math.floor(opts.attributes.str * 1.5) } : opts.attributes;
}

export function getWeaponAttack(opts: {
  weapon: Weapon;
  attributes: Attributes;
  twoHanding: boolean;
  upgradeLevel: number;
  disableTwoHandingBonus?: boolean;
  ineffectiveAttributePenalty?: number;
}): WeaponAttackResult {
  const { weapon, attributes, upgradeLevel, ineffectiveAttributePenalty = 0.4 } = opts;
  const adjustedAttributes = adjustAttributesForTwoHanding(opts);

  const ineffectiveAttributes = (Object.entries(weapon.requirements) as [Attribute, number][])
    .filter(([attribute, requirement]) => adjustedAttributes[attribute] < requirement)
    .map(([attribute]) => attribute);
  const ineffectiveAttackPowerTypes: AttackPowerType[] = [];
  const attackPower: Partial<Record<AttackPowerType, number>> = {};

  const attackAtLevel = weapon.attack[upgradeLevel];
  const scalingAtLevel = weapon.attributeScaling[upgradeLevel];
  const scalingAtZero = weapon.attributeScaling[0];
  if (!attackAtLevel || !scalingAtLevel || !scalingAtZero) throw new Error(`${weapon.name} has no upgrade level ${upgradeLevel}`);

  for (const attackPowerType of [...allDamageTypes, ...allStatusTypes]) {
    const isDamageType = allDamageTypes.includes(attackPowerType);
    const baseAttackPower = attackAtLevel[attackPowerType] ?? 0;
    if (!baseAttackPower) continue;
    const scalingAttributes = weapon.attackElementCorrect[attackPowerType] ?? {};
    let totalScaling = 1;
    if (ineffectiveAttributes.some((attribute) => scalingAttributes[attribute])) {
      totalScaling = 1 - ineffectiveAttributePenalty;
      ineffectiveAttackPowerTypes.push(attackPowerType);
    } else {
      const effectiveAttributes = isDamageType ? adjustedAttributes : attributes;
      for (const attribute of allAttributes) {
        const attributeCorrect = scalingAttributes[attribute];
        if (!attributeCorrect) continue;
        const scaling =
          attributeCorrect === true
            ? (scalingAtLevel[attribute] ?? 0)
            : (attributeCorrect * (scalingAtLevel[attribute] ?? 0)) / (scalingAtZero[attribute] ?? 0);
        if (scaling) {
          const curve = weapon.calcCorrectGraphs[attackPowerType];
          const curveValue = curve[effectiveAttributes[attribute]];
          if (curveValue === undefined) throw new Error(`No curve value for ${attribute}=${effectiveAttributes[attribute]}`);
          totalScaling += curveValue * scaling;
        }
      }
    }
    attackPower[attackPowerType] = baseAttackPower * totalScaling;
  }
  return { upgradeLevel, attackPower, ineffectiveAttributes, ineffectiveAttackPowerTypes, effectiveAttributes: adjustedAttributes };
}

// ---- regulationData.ts --------------------------------------------------------------------------

export type CalcCorrectGraph = { maxVal: number; maxGrowVal: number; adjPt: number }[];

export interface ReinforceParamWeapon {
  attack: Partial<Record<AttackPowerType, number>>;
  attributeScaling: Record<Attribute, number>;
  statusSpEffectId1?: number;
  statusSpEffectId2?: number;
  statusSpEffectId3?: number;
}

export interface EncodedWeaponJson {
  name: string;
  weaponName: string;
  affinityId: number;
  weaponType: number;
  requirements: Partial<Record<Attribute, number>>;
  attributeScaling: (readonly [Attribute, number])[];
  attack: (readonly [AttackPowerType, number])[];
  statusSpEffectParamIds?: number[];
  reinforceTypeId: number;
  attackElementCorrectId: number;
  calcCorrectGraphIds?: Partial<Record<AttackPowerType, number>>;
  paired?: boolean;
  sorceryTool?: boolean;
  incantationTool?: boolean;
  dlc?: boolean;
}

export interface EncodedRegulationDataJson {
  calcCorrectGraphs: Record<string, CalcCorrectGraph>;
  attackElementCorrects: Record<string, AttackElementCorrect>;
  reinforceTypes: Record<string, ReinforceParamWeapon[]>;
  statusSpEffectParams: Record<string, Partial<Record<AttackPowerType, number>>>;
  weapons: EncodedWeaponJson[];
}

const defaultDamageCalcCorrectGraphId = 0;
const defaultStatusCalcCorrectGraphId = 6;

/** Precompute a CalcCorrectGraph into scaling amounts per stat value (index = stat). */
export function evaluateCalcCorrectGraph(calcCorrectGraph: CalcCorrectGraph): number[] {
  const arr: number[] = [];
  for (let i = 1; i < calcCorrectGraph.length; i++) {
    const prevStage = calcCorrectGraph[i - 1]!;
    const stage = calcCorrectGraph[i]!;
    const minAttributeValue = i === 1 ? 1 : prevStage.maxVal + 1;
    const maxAttributeValue = i === calcCorrectGraph.length - 1 ? 148 : stage.maxVal;
    for (let attributeValue = minAttributeValue; attributeValue <= maxAttributeValue; attributeValue++) {
      if (!arr[attributeValue]) {
        let ratio = Math.max(0, Math.min(1, (attributeValue - prevStage.maxVal) / (stage.maxVal - prevStage.maxVal)));
        if (prevStage.adjPt > 0) ratio = ratio ** prevStage.adjPt;
        else if (prevStage.adjPt < 0) ratio = 1 - (1 - ratio) ** -prevStage.adjPt;
        arr[attributeValue] = prevStage.maxGrowVal + (stage.maxGrowVal - prevStage.maxGrowVal) * ratio;
      }
    }
  }
  return arr;
}

export function decodeRegulationData(data: EncodedRegulationDataJson): Weapon[] {
  const graphsById = new Map(Object.entries(data.calcCorrectGraphs).map(([id, g]) => [+id, evaluateCalcCorrectGraph(g)]));
  const aecById = new Map<number, AttackElementCorrect>(
    Object.entries(data.attackElementCorrects).map(([id, aec]) => [
      +id,
      { ...aec, [AttackPowerType.POISON]: { arc: true }, [AttackPowerType.BLEED]: { arc: true }, [AttackPowerType.MADNESS]: { arc: true }, [AttackPowerType.SLEEP]: { arc: true }, [AttackPowerType.SCARLET_ROT]: {}, [AttackPowerType.FROST]: {}, [AttackPowerType.DEATH_BLIGHT]: {} },
    ]),
  );

  return data.weapons.map(({ attackElementCorrectId, reinforceTypeId, calcCorrectGraphIds, statusSpEffectParamIds, attack: unupgradedAttack, attributeScaling: unupgradedScaling, dlc = false, ...weapon }): Weapon => {
    const attackElementCorrect = aecById.get(attackElementCorrectId);
    if (!attackElementCorrect) throw new Error(`No AttackElementCorrectParam id=${attackElementCorrectId} weapon=${weapon.name}`);
    const reinforceParams = data.reinforceTypes[reinforceTypeId];
    if (!reinforceParams) throw new Error(`No ReinforceParamWeapon id=${reinforceTypeId} weapon=${weapon.name}`);
    const graph = (id: number) => {
      const g = graphsById.get(id);
      if (!g) throw new Error(`No CalcCorrectGraph id=${id} weapon=${weapon.name}`);
      return g;
    };
    const calcCorrectGraphs = {} as Record<AttackPowerType, number[]>;
    for (const t of allDamageTypes) calcCorrectGraphs[t] = graph(calcCorrectGraphIds?.[t] ?? defaultDamageCalcCorrectGraphId);
    for (const t of allStatusTypes) calcCorrectGraphs[t] = graph(calcCorrectGraphIds?.[t] ?? defaultStatusCalcCorrectGraphId);

    const attack = reinforceParams.map((rp) => {
      const out: Partial<Record<AttackPowerType, number>> = {};
      for (const [type, value] of unupgradedAttack) out[type] = value * (rp.attack[type] ?? 0);
      const offsets = [rp.statusSpEffectId1, rp.statusSpEffectId2, rp.statusSpEffectId3];
      statusSpEffectParamIds?.forEach((spId, i) => {
        if (spId) Object.assign(out, data.statusSpEffectParams[spId + (offsets[i] ?? 0)]);
      });
      return out;
    });
    const attributeScaling = reinforceParams.map((rp) => {
      const out: Partial<Record<Attribute, number>> = {};
      for (const [attr, value] of unupgradedScaling) out[attr] = value * rp.attributeScaling[attr];
      return out;
    });
    return { ...weapon, attack, attributeScaling, attackElementCorrect, calcCorrectGraphs, dlc };
  });
}
