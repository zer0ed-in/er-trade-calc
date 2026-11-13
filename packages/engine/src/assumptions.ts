// The single assumptions file (docs/09). Engine code reads choices ONLY from here.
// Correcting an assumption = flip `choice`/`status` here, run `pnpm test`.

export type AssumptionStatus = "assumed" | "confirmed";

export interface Assumption<TChoice> {
  id: AssumptionId;
  question: string;
  choice: TChoice;
  alternative: TChoice;
  status: AssumptionStatus;
  reason: string;
  source?: string;
  tests: string[];
}

// A10 (Kick fixed at 1 damage) was removed on 2026-11-13: Kick now comes from its AtkParam rows.
export type AssumptionId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9" | "A11" | "A12" | "A13";

export type CounterHitModel = "pierce-negation-minus-points" | "pierce-damage-multiplier";

export type SkillScalingFormula =
  // flat × baseAtkRate(upgrade) × (1 + Σ overrideRate × correctRate(upgrade) × curve(stat))
  | "flat-x-upgrade-x-override-table"
  | "unknown";

export const ASSUMPTIONS = {
  A1: {
    id: "A1",
    question: "Are listed frame ranges already adjusted for speed gradients?",
    choice: { framesAlreadySpeedAdjusted: true },
    alternative: { framesAlreadySpeedAdjusted: false },
    status: "confirmed",
    reason: "Use frames as listed; never apply `gradients` again.",
    source: "Emilia, 2026-11-12",
    tests: ["packages/engine/test/interaction.test.ts"],
  },
  A2: {
    id: "A2",
    question: "What is the +1 between data `startup` and planner display?",
    choice: { displayOffset: 1 },
    alternative: { displayOffset: 0 },
    status: "confirmed",
    reason: "Counting convention: store the 0-based index, display index + 1.",
    source: "Emilia + planner code",
    tests: ["packages/engine/test/attacks.test.ts"],
  },
  A3: {
    id: "A3",
    question: "How does skill/projectile flat damage scale?",
    choice: {
      formula: "flat-x-upgrade-x-override-table" as SkillScalingFormula,
      twoHandBonus: false,
    },
    alternative: { formula: "unknown" as SkillScalingFormula, twoHandBonus: false },
    status: "assumed",
    reason:
      "Param-based Steam guide + data. Which stat drives each projectile matches the override tables (PvE evidence); exact numbers unverified. `isAddBaseAtk` meaning not pinned down (Q8).",
    source: "fixtures/golden/evidence-pve.json",
    tests: ["packages/engine/test/attacks.test.ts"],
  },
  A4: {
    id: "A4",
    question: "Counter hits: how is the bonus applied in PvP, and how does Spear Talisman stack?",
    choice: {
      model: "pierce-negation-minus-points" as CounterHitModel,
      // planner Nr.counterhit: Pierce Absorption −30 additive, value_pvp −15
      pierceNegationPointsPvp: 15,
      pierceDamageMultiplier: 1.15, // only used by the alternative model (SpEffect #45 thrustDamageCutRate)
      spearTalisman: "attacker-physical-multiplier" as const,
    },
    alternative: {
      model: "pierce-damage-multiplier" as CounterHitModel,
      pierceNegationPointsPvp: 15,
      pierceDamageMultiplier: 1.15,
      spearTalisman: "attacker-physical-multiplier" as const,
    },
    status: "assumed",
    reason:
      "Changed 2026-11-12 (Zer0): default to the planner's PvP model (−15 points pierce negation, scales with negation per wiki.gg). SpEffect #45 thrustDamageCutRate 1.15 is the alternative. Spear Talisman: attacker physical ×1.15 (planner).",
    source: "planner Nr.counterhit; SpEffectParam #45",
    tests: ["packages/engine/test/interaction.test.ts"],
  },
  A5: {
    id: "A5",
    question: "Data source",
    choice: { source: "one-time-copy" as const },
    alternative: { source: "one-time-copy" as const },
    status: "confirmed",
    reason: "One-time copy of Emilia's files (docs/05), committed; never fetched again.",
    source: "Emilia's permission",
    tests: [],
  },
  A6: {
    id: "A6",
    question: "Build export format",
    choice: { acceptedVersions: ["3.14"], warnOnOtherVersions: true },
    alternative: { acceptedVersions: ["3.14"], warnOnOtherVersions: false },
    status: "confirmed",
    reason: "Versioned, mostly stable; accept 3.14, warn on others, zod-validate.",
    source: "Emilia",
    tests: ["packages/builds/test/importer.test.ts"],
  },
  A7: {
    id: "A7",
    question: "Input delay",
    choice: { defaultFrames: 0, additiveOnly: true },
    alternative: { defaultFrames: 0, additiveOnly: true },
    status: "confirmed",
    reason: "Design rule: per-player frames, default 0, added only, never multiplied.",
    source: "Zer0",
    tests: ["packages/engine/test/interaction.test.ts"],
  },
  A8: {
    id: "A8",
    question: "2H str bonus per hit",
    choice: { source: "resolved AtkParam_Pc isDisableBothHandsAtkBonus", noRow: "not-supported" },
    alternative: { source: "resolved AtkParam_Pc isDisableBothHandsAtkBonus", noRow: "not-supported" },
    status: "confirmed",
    reason:
      "Game data: every hit resolves through BehaviorParam_PC/Bullet to its AtkParam_Pc row, and the row's isDisableBothHandsAtkBonus decides. It is off on every ash, on backstabs/ripostes, and on some 2H normal attacks (e.g. Barbaric Roar R2s, Lizard Greatsword and Bloodfiend's Arm charged R2s, Serpent Flail R2s); the planner applies 2H to those. The one hit with no row (Taker's Flames 300314902) is not supported when two-handed.",
    source: "regulation data (AtkParam_Pc, equal to 1.17.3), 2026-11-13",
    tests: ["packages/engine/test/damage.test.ts", "packages/engine/test/attacks.test.ts", "packages/engine/test/poise.test.ts"],
  },
  A9: {
    id: "A9",
    question: "Lightning Slash weapon buff value",
    choice: { lightningFlat: 85, durationSeconds: 40, appliesToLightningInfusion: true },
    alternative: { lightningFlat: 0, durationSeconds: 0, appliesToLightningInfusion: false },
    status: "confirmed",
    reason:
      "Game data: SpEffect 1675/1677 \"[Weapon] Lightning Slash\" cycle into 1676/1678, which set thunderAttackPower 85 and effectEndurance 40 s (full SpEffectParam from regulation.bin 1.17.3). That it also applies on a Lightning-infused weapon is from the wiki (not checked in-game).",
    source: "regulation.bin 1.17.3 (value, duration); wiki.gg (Lightning infusion), 2026-11-13",
    tests: ["packages/engine/test/hit.test.ts", "packages/data/test/regulation-effects.test.ts"],
  },
  A11: {
    id: "A11",
    question: "PvP poise rate for a hit with no planner rate (Kick)",
    choice: { fromFinalDamageRateParam: true, kickSaRate: 2.7 },
    alternative: { fromFinalDamageRateParam: false, kickSaRate: 2.7 },
    status: "confirmed",
    reason:
      "Game data: the planner's per-hit saDamageRateFinal equals FinalDamageRateParam[finalDamageRateId].saRate on 12,868 of 12,869 hits. Kick's rows (AtkParam 301100800/801) name FinalDamageRateParam 10000: saRate 2.7, the same rate as other skills. Kick hit 1 = 6 × 2.7 × 10 = 162 poise.",
    source: "regulation data (FinalDamageRateParam), 2026-11-13",
    tests: ["packages/engine/test/kick.test.ts"],
  },
  A12: {
    id: "A12",
    question: "Current poise after a poise break",
    choice: { resetToFullAfterBreak: true },
    alternative: { resetToFullAfterBreak: false },
    status: "assumed",
    reason: "Community knowledge, not in the game tables: once poise breaks, current poise goes back to full. Refill without a break is in the data (30 s after the last hit).",
    source: "Zer0 / planning session, 2026-11-13",
    tests: ["packages/engine/test/poise.test.ts"],
  },
  A13: {
    id: "A13",
    question: "Hyper-armour minimum poise when ToughnessParam.isNonEffectiveCorrectionForMin is 0",
    choice: { minScaledByWeaponToughness: true },
    alternative: { minScaledByWeaponToughness: false },
    status: "assumed",
    reason:
      "The paramdef says the flag stops the toughness correction multiplier from applying to minToughness; it doesn't say which multiplier. We read it as the weapon-toughness factor (toughnessCorrectRate × correctionRate), the same one the window's weapon part uses. Rows with the flag set (e.g. Storm Stomp, Kick) use minToughness × 10 unscaled and don't depend on this.",
    source: "paramdef description (Smithbox ToughnessParam), 2026-11-13",
    tests: ["packages/engine/test/poise.test.ts"],
  },
} as const satisfies Record<AssumptionId, Assumption<unknown>>;

/** IDs from `used` that are still unconfirmed — what a result must list as `assumptionsUsed`. */
export function unconfirmedAssumptions(used: Iterable<AssumptionId>): AssumptionId[] {
  const unique = [...new Set(used)];
  return unique.filter((id) => ASSUMPTIONS[id].status === "assumed").sort();
}
