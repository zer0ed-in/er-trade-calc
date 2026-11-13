import { describe, expect, it } from "vitest";
import * as fx from "./fixtures.ts";
import { ASSUMPTIONS } from "../src/assumptions.ts";

describe("fixtures load and validate", () => {
  it.each([
    ["ar", fx.goldenAr],
    ["damage", fx.goldenDamage],
    ["defences", fx.goldenDefences],
    ["poise", fx.goldenPoise],
    ["misc", fx.goldenMisc],
    ["frames", fx.goldenFrames],
    ["attacks", fx.goldenAttacks],
    ["evidence-pve", fx.goldenEvidencePve],
    ["ruleset", fx.ladderRuleset],
  ] as const)("%s", (_name, load) => {
    expect(() => load()).not.toThrow();
  });

  it("damage cases reference builds that exist", () => {
    const damage = fx.goldenDamage();
    for (const c of damage.cases) {
      expect(damage.builds[c.attacker], c.id).toBeDefined();
      expect(damage.builds[c.defender], c.id).toBeDefined();
    }
  });

  it("the RL sweep has 32 planner points (16 each direction)", () => {
    const sweep = fx.goldenDamage().cases.filter((c) => c.id.startsWith("sweep-"));
    expect(sweep).toHaveLength(32);
  });
});

describe("assumptions file", () => {
  it("has A1–A10 with ids matching keys", () => {
    expect(Object.keys(ASSUMPTIONS)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);
    for (const [key, a] of Object.entries(ASSUMPTIONS)) expect(a.id).toBe(key);
  });
});
