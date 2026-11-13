import { describe, expect, it } from "vitest";
import { A3_WARNING, apiHit, computeHit, explainHit, prepareFighter, renderHit, resolveAttack, type Build, type ScenarioName, type Stats } from "@ertc/engine";
import { loadLadderRuleset } from "@ertc/data";
import { data } from "./data.ts";

const armour = { head: "Verdigris Helm", body: "Verdigris Armor", arms: "Verdigris Gauntlets", legs: "Verdigris Greaves" };
const hk = (s: Partial<Stats>): Stats => ({ vig: 60, mnd: 8, end: 40, str: 15, dex: 13, int: 7, fth: 8, arc: 9, ...s });
const build = (stats: Stats, infusion: string, extra: Partial<Build> = {}): Build => ({ class: "Heavy Knight", stats, rightHand: [{ weapon: "Shamshir", infusion, upgrade: 25 }], armour, talismans: [], buffs: [], ...extra });
const str = build(hk({ str: 59 }), "Heavy");
const dex = build(hk({ dex: 57 }), "Keen");
const hit = (a: Build, d: Build, scenario: ScenarioName = "duel-start", attack = "2h R1 1", hp = 1) => {
  const A = prepareFighter(data, a, { scenario });
  const D = prepareFighter(data, d, { scenario });
  const atk = resolveAttack(data, a, { attack });
  return computeHit(data, A, atk, atk.hits[0]!, D, { attackerHpFraction: hp, defenderHpFraction: hp, counterHit: false, defenderDamageMultiplier: 1 });
};

describe("flat buffs", () => {
  it("Sacred Blade adds +90 holy AR before MV (planner weapon-art table)", () => {
    const r = hit(build(hk({ str: 59 }), "Heavy", { buffs: ["Sacred Blade"] }), dex);
    const holy = r.types.find((t) => t.type === "holy")!;
    expect(holy.flatBuff).toBe(90);
    expect(holy.weaponPart).toBeCloseTo(90 * 1.03, 10);
    expect(r.damage!).toBeGreaterThan(hit(str, dex).damage!);
  });
  it("base scenario ignores the build's own buffs; an explicit extra buff still applies", () => {
    const buffed = build(hk({ str: 59 }), "Heavy", { buffs: ["Sacred Blade"] });
    expect(hit(buffed, dex, "base").damage).toBe(hit(str, dex, "base").damage);
  });
  it("Lightning Slash uses A9 (+85, wiki) and lists it", () => {
    const r = hit(build(hk({ dex: 57 }), "Lightning", { buffs: ["Lightning Slash"] }), str);
    expect(r.types.find((t) => t.type === "lightning")!.flatBuff).toBe(85);
    expect(r.assumptions).toContain("A9");
  });
  it("a grease on an unbuffable weapon is rejected", () => {
    const b: Build = { ...str, rightHand: [{ weapon: "Dragon King's Cragblade", infusion: "Standard", upgrade: 10 }], buffs: ["Lightning Grease"], stats: hk({ str: 40, dex: 40 }) };
    expect(() => hit(b, dex, "duel-start", "1h R1 1")).toThrow(/can't be buffed/);
  });
});

describe("conditional effects", () => {
  it("Ritual Sword ×1.1 at full HP only; Ritual Shield (Absorption 1.3) → damage ×0.7 at full HP", () => {
    const sword = build(hk({ str: 59 }), "Heavy", { talismans: ["Ritual Sword Talisman"] });
    const full = hit(sword, dex);
    expect(full.types[0]!.attackerMultiplier).toBeCloseTo(1.1, 10);
    expect(hit(sword, dex, "duel-start", "2h R1 1", 0.9).types[0]!.attackerMultiplier).toBe(1);
    const shield = build(hk({ dex: 57 }), "Keen", { talismans: ["Ritual Shield Talisman"] });
    const r = hit(str, shield);
    const plain = hit(str, dex);
    expect(r.types[0]!.negation).toBeCloseTo(1 - (1 - plain.types[0]!.negation) * 0.7, 10);
  });
  it("Opaline Hardtear uses its PvP value 1.1 → ×0.9, only in duel-start (tears)", () => {
    const opal = build(hk({ dex: 57 }), "Keen", { tears: ["Opaline Hardtear"] });
    const r = hit(str, opal);
    expect(r.defenderEffects.map((e) => e.value)).toEqual([1.1]);
    expect(hit(str, opal, "low-hp").defenderEffects).toEqual([]);
  });
});

describe("breakdown", () => {
  it("lists every step and ends with the floored total", () => {
    const lines = explainHit(hit(str, dex, "base"), "str → dex 2h R1 1").join("\n");
    expect(lines).toMatch(/AR 548\.\d+ × MV 103\/100 = 564\.\d+/);
    expect(lines).toMatch(/defence D = 132/);
    expect(lines).toMatch(/negation \(slash\) 37\.278%/);
    expect(lines).toMatch(/total: floor\(286\.\d+\) = 286/);
  });
});

describe("A3 warning (loud until the friend test confirms the projectile formula)", () => {
  const ctx = { data, ruleset: loadLadderRuleset() };
  const sb = build(hk({ str: 30, dex: 42 }), "Keen", { rightHand: [{ weapon: "Shamshir", infusion: "Keen", upgrade: 25, ashOfWar: "Storm Blade" }] });
  it("a projectile hit shows ⚠ A3 at the top of the text and in meta.warnings", () => {
    const r = apiHit(ctx, sb, dex, { choiceA: { attack: "Storm Blade - Wind Slash 1", hits: "wind" }, choiceB: { attack: "1h R1 1" } });
    expect(r.meta.warnings).toEqual([A3_WARNING]);
    expect(renderHit(r).split("\n")[0]).toBe(A3_WARNING);
  });
  it("normal attacks and weapon swings carry no warning", () => {
    for (const choiceA of [{ attack: "2h R1 1" }, { attack: "Storm Blade - Wind Slash 1", hits: "blade" }]) {
      const r = apiHit(ctx, sb, dex, { choiceA, choiceB: { attack: "1h R1 1" } });
      expect(r.meta.warnings).toEqual([]);
      expect(renderHit(r)).not.toContain("⚠");
    }
  });
});

describe("greases only on Standard / Heavy / Keen (Zer0, in-game; docs/09 Q12)", () => {
  const withBuff = (infusion: string, buff: string) => build(hk({ dex: 57 }), infusion, { buffs: [buff] });
  it("Drawstring Dragonbolt Grease applies on Keen", () => {
    expect(hit(withBuff("Keen", "Drawstring Dragonbolt Grease"), str).types.find((t) => t.type === "lightning")!.flatBuff).toBeGreaterThan(0);
  });
  it("a grease on Lightning, Fire, Cold or Quality is refused", () => {
    for (const infusion of ["Lightning", "Fire", "Cold", "Quality"]) {
      expect(() => hit(withBuff(infusion, "Drawstring Dragonbolt Grease"), str), infusion).toThrow(/Standard, Heavy or Keen/);
    }
  });
  it("weapon-art buffs are not greases: Sacred Blade still applies on Lightning", () => {
    expect(hit(withBuff("Lightning", "Sacred Blade"), str).types.find((t) => t.type === "holy")!.flatBuff).toBe(90);
  });
});
