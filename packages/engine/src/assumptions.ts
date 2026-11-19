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
  // flat × skillRate(upgrade) × (1 + Σ coefficient × curve(stat)); coefficient = table override × correctRate(upgrade), else the weapon's own scaling
  | "flat-x-skill-rate-x-override-or-weapon-scaling"
  // pre-2026-11-14 model: flat × damage rate(upgrade) × (1 + Σ override × correctRate × curve) — under-predicted 1.1–7× in-game
  | "flat-x-upgrade-x-override-table";

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
      formula: "flat-x-skill-rate-x-override-or-weapon-scaling" as SkillScalingFormula,
      twoHandBonus: false,
    },
    alternative: { formula: "flat-x-upgrade-x-override-table" as SkillScalingFormula, twoHandBonus: false },
    status: "confirmed",
    reason:
      "In-game (Zer0 and a test partner, PS5, 2026-11-14): flat × ReinforceParamWeapon skill rate (+0x7C, 4.0 at +25 and somber +10, every infusion) × (1 + Σ coefficient × curve). Coefficient = the hit's overwrite-table override × reinforcement scaling rate; with no table (-1) the weapon's own scaling. Reproduces 20 of 24 recorded flat-damage numbers exactly (Storm Blade, Ice Spear, Sacred Blade, Glintblade Phalanx, Beast's Roar, Lightning Slash stomp, Loretta's Slash, Ground Slam, Eruption, Kick). Open: Beast's Roar dex hit 1 is 1 high; Glintblade on a dex build is 1–2 high per blade; the Lightning Slash bolt uses the planner's child row 301600849 (60) where the game hits with AtkParam 300000371 (120, via Bullet 2090 → 2092), which with this formula gives the in-game 381 (docs/09 Q16). A table stat flagged without an override uses the weapon's scaling by the AR rule; not checked in-game.",
    source: "fixtures/golden/in-game.json; reports of the 2026-11-14 test (regulation.bin 1.17.3 for the rate)",
    tests: ["packages/engine/test/in-game.test.ts", "packages/engine/test/attacks.test.ts"],
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
    status: "confirmed",
    reason:
      "The HA minimum is a floor, not added on top (in-game, Zer0 2026-11-14: Kick staggers a 133-poise target; Beast's Roar staggers the test partner mid-Kick). Kick's row has the flag set, so that test checks floor vs additive; the scaling read for flag-0 rows (minToughness × toughnessCorrectRate × correctionRate) comes from the paramdef description and Zer0 marked A13 confirmed on this evidence.",
    source: "in-game, Zer0 2026-11-14; paramdef description (Smithbox ToughnessParam), 2026-11-13",
    tests: ["packages/engine/test/poise.test.ts"],
  },
} as const satisfies Record<AssumptionId, Assumption<unknown>>;

/** IDs from `used` that are still unconfirmed — what a result must list as `assumptionsUsed`. */
export function unconfirmedAssumptions(used: Iterable<AssumptionId>): AssumptionId[] {
  const unique = [...new Set(used)];
  return unique.filter((id) => ASSUMPTIONS[id].status === "assumed").sort();
}
