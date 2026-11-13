// Ruleset fixes (Zer0, 2026-11-12): Backhand Blade weapon-only 2H ban, Reverse-Bladed Sword rules, 2H club status application.
import { describe, expect, it } from "vitest";
import { loadLadderRuleset } from "@ertc/data";
import { checkLegality, prepareFighter, resolveAttack, type Build, type WeaponSlot } from "@ertc/engine";
import { data } from "./data.ts";

const rules = loadLadderRuleset();
const armour = { head: "Divine Bird Helm", body: "Verdigris Armor", arms: "Steel Gauntlets", legs: "Verdigris Greaves" };
const dexStats = { vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 };
const strStats = { vig: 60, mnd: 8, end: 42, str: 55, dex: 15, int: 7, fth: 8, arc: 9 };
const slot = (weapon: string, infusion = "Standard"): WeaponSlot => ({ weapon, infusion, upgrade: 25 });

/** Rule names violated by `attack` (planner name) with this build. */
function violated(b: Partial<Build> & Pick<Build, "rightHand">, attack: string, stats = dexStats): string[] {
  const build: Build = { class: "Heavy Knight", stats, armour, talismans: [], buffs: [], leftHand: [], ...b };
  const fighter = prepareFighter(data, build, { scenario: "duel-start" });
  return checkLegality(rules, { data, fighter, attack: resolveAttack(data, build, { attack }) }).violations.map((v) => v.rule);
}

describe("2H Backhand Blade: the weapon only, not the class", () => {
  const rule = "2H Backhand Blade (weapon only)";
  it("two-handing the Backhand Blade is banned; one-handing it is fine", () => {
    expect(violated({ rightHand: [slot("Backhand Blade")] }, "2h R1 1")).toContain(rule);
    expect(violated({ rightHand: [slot("Backhand Blade")] }, "1h R1 1")).not.toContain(rule);
  });
  it("two-handing another Backhand Blade-class weapon (Reverse-Bladed Sword) is not caught by it", () => {
    expect(violated({ rightHand: [slot("Reverse-Bladed Sword", "Keen")] }, "2h R1 1")).toEqual([]);
  });
});

describe("Power-stanced Backhand Blades stays a class ban", () => {
  it("covers a Reverse-Bladed Sword paired with a Backhand Blade", () => {
    expect(violated({ rightHand: [slot("Reverse-Bladed Sword")], leftHand: [slot("Backhand Blade")] }, "Paired L1 1")).toContain(
      "Power-stanced Backhand Blades (class, incl. Reverse-Bladed Sword)",
    );
  });
});

describe("Reverse-Bladed Sword (\"Reverse Blades\"), matched by weapon name", () => {
  it("Lightning infusion is banned when two-handed only", () => {
    expect(violated({ rightHand: [slot("Reverse-Bladed Sword", "Lightning")] }, "2h R1 1")).toContain("Lightning-infused 2H Reverse-Bladed Sword");
    expect(violated({ rightHand: [slot("Reverse-Bladed Sword", "Lightning")] }, "1h R1 1")).toEqual([]);
  });
  it("2H on other infusions is legal", () => {
    for (const infusion of ["Standard", "Keen", "Heavy", "Cold"]) expect(violated({ rightHand: [slot("Reverse-Bladed Sword", infusion)] }, "2h R1 1"), infusion).toEqual([]);
  });
  it("any weapon buff is banned when two-handed, allowed when one-handed", () => {
    const greased = { rightHand: [slot("Reverse-Bladed Sword", "Keen")], buffs: ["Drawstring Dragonbolt Grease"] };
    expect(violated(greased, "2h R1 1")).toContain("2H Reverse-Bladed Sword");
    expect(violated(greased, "1h R1 1")).toEqual([]);
  });
});

describe("2H Stone Club/Club: any status application", () => {
  const rule = "2H Stone Club/Club with any status application (status infusion or status grease)";
  it("status from the infusion (Blood, Cold, Poison) is banned when two-handed", () => {
    for (const infusion of ["Blood", "Cold", "Poison"]) {
      expect(violated({ rightHand: [slot("Club", infusion)] }, "2h R1 1", strStats), infusion).toContain(rule);
      expect(violated({ rightHand: [slot("Stone Club", infusion)] }, "2h R1 1", strStats), infusion).toContain(rule);
    }
  });
  it("a status grease is banned when two-handed", () => {
    expect(violated({ rightHand: [slot("Club", "Heavy")], buffs: ["Drawstring Blood Grease"] }, "2h R1 1", strStats)).toContain(rule);
  });
  it("no status, or one-handed, is fine", () => {
    expect(violated({ rightHand: [slot("Club", "Heavy")] }, "2h R1 1", strStats)).toEqual([]);
    expect(violated({ rightHand: [slot("Club", "Blood")] }, "1h R1 1", strStats)).toEqual([]);
  });
});
