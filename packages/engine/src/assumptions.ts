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

export type AssumptionId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9" | "A10";

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
    question: "2H str bonus for a hit that resolves to no AtkParam_Pc row",
    choice: { missingRowNormalAttack2H: true, missingRowSkillHit2H: false },
    alternative: { missingRowNormalAttack2H: false, missingRowSkillHit2H: false },
    status: "assumed",
    reason:
      "Hits resolve through BehaviorParam_PC/Bullet to AtkParam_Pc; only Taker's Flames (300314902) has no row. Row present → read isDisableBothHandsAtkBonus. No row → normal attacks get 2H, skill/ash hits never (in-game tests: ashes ignore 2H).",
    source: "Zer0, 2026-11-12",
    tests: ["packages/engine/test/damage.test.ts", "packages/engine/test/attacks.test.ts"],
  },
  A9: {
    id: "A9",
    question: "Lightning Slash weapon buff value",
    choice: { lightningFlat: 85, durationSeconds: 40, appliesToLightningInfusion: true },
    alternative: { lightningFlat: 0, durationSeconds: 0, appliesToLightningInfusion: false },
    status: "assumed",
    reason: "Wiki-sourced, curated entry: the copy has SpEffect rows 1675/1677 \"[Weapon] Lightning Slash\", but they only point to cycle effects 1676/1678, which are not in the copy; the planner has no effect for it.",
    source: "wiki.gg (Zer0, 2026-11-12)",
    tests: ["packages/engine/test/hit.test.ts"],
  },
  A10: {
    id: "A10",
    question: "Kick damage (no hit row for Kick in FDE or our AtkParam copy; animation a712_040000 exists)",
    choice: { fixedPhysicalDamage: 1, scaled: false },
    alternative: { fixedPhysicalDamage: 0, scaled: false },
    status: "assumed",
    reason:
      "In-game Kick does ~0–2 damage; its value is stagger and guard break. Fixed at 1 (not 0) so ratios and hits to kill stay finite. Its poise damage is unknown and its active frames aren't in FDE, so stagger, trade and timing verdicts with Kick are not supported; guard break needs blocking, which isn't modelled.",
    source: "Zer0, 2026-11-13",
    tests: ["packages/engine/test/kick.test.ts"],
  },
} as const satisfies Record<AssumptionId, Assumption<unknown>>;

/** IDs from `used` that are still unconfirmed — what a result must list as `assumptionsUsed`. */
export function unconfirmedAssumptions(used: Iterable<AssumptionId>): AssumptionId[] {
  const unique = [...new Set(used)];
  return unique.filter((id) => ASSUMPTIONS[id].status === "assumed").sort();
}
