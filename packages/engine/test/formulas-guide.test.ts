// Every worked example in docs/public/formulas.md must match the engine (1G).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeHit, defences, hitsToKill, prepareFighter, resolveAttack, weaponAr, type Build, type Stats } from "@ertc/engine";
import { data } from "./data.ts";
import { REPO_ROOT } from "./fixtures.ts";

const guide = readFileSync(REPO_ROOT + "docs/public/formulas.md", "utf8");
const verdigris = { head: "Verdigris Helm", body: "Verdigris Armor", arms: "Verdigris Gauntlets", legs: "Verdigris Greaves" };
const steel = { ...verdigris, arms: "Steel Gauntlets" };
const hk = (s: Partial<Stats>, end = 40): Stats => ({ vig: 60, mnd: 8, end, str: 15, dex: 13, int: 7, fth: 8, arc: 9, ...s });
const b = (stats: Stats, infusion: string, armour = verdigris, extra: Partial<Build> = {}): Build => ({ class: "Heavy Knight", stats, rightHand: [{ weapon: "Shamshir", infusion, upgrade: 25 }], armour, talismans: [], buffs: [], ...extra });
const hit = (a: Build, d: Build, scenario: "base" | "duel-start" = "base") => {
  const A = prepareFighter(data, a, { scenario });
  const atk = resolveAttack(data, a, { attack: "2h R1 1" });
  return computeHit(data, A, atk, atk.hits[0]!, prepareFighter(data, d, { scenario }));
};
const str59 = b(hk({ str: 59 }), "Heavy");
const dex57 = b(hk({ dex: 57 }), "Keen");

describe("formulas guide worked examples", () => {
  it("§2: 54 str two-handed counts as 81", () => {
    expect(guide).toContain("54 str two-handed counts as 81");
    expect(weaponAr(data, { weapon: "Shamshir", infusion: "Heavy", upgrade: 25 }, hk({ str: 54 }), { twoHanded: true, disableTwoHandBonus: false }).effectiveStr).toBe(81);
  });
  it("§5: RL 125 defences 132 (15 str) and 156 (59 str)", () => {
    expect(guide).toMatch(/127 \+ 5 = \*\*132\*\*/);
    expect(guide).toMatch(/127 \+ 29 = \*\*156\*\*/);
    expect(defences(data, hk({ str: 15, dex: 57 })).total.physical).toBe(132);
    expect(defences(data, hk({ str: 59, dex: 13 })).total.physical).toBe(156);
  });
  it("§9: Heavy 2H R1 into the 15-str build = 286 (A = 564.96, D = 132, negation 37.278%)", () => {
    const r = hit(str59, dex57);
    expect(guide).toContain("**286** ✅");
    expect(r.damage).toBe(286);
    expect(r.types[0]!.attackValue).toBeCloseTo(564.96, 1);
    expect((100 * r.types[0]!.negation).toFixed(3)).toBe("37.278");
  });
  it("§9 buff table: Heavy 285 → 299 (+14), Sacred 300 → 365 (+65)", () => {
    const def = b(hk({ fth: 53 }, 39), "Sacred", steel);
    const heavy = b(hk({ str: 60 }, 39), "Heavy", steel);
    const sacred = b(hk({ fth: 53 }, 39), "Sacred", steel);
    const sb = (x: Build) => ({ ...x, buffs: ["Sacred Blade"] });
    expect(guide).toContain("**299 (+14)**");
    expect(guide).toContain("**365 (+65)**");
    expect([hit(heavy, def, "duel-start").damage, hit(sb(heavy), def, "duel-start").damage, hit(sacred, def, "duel-start").damage, hit(sb(sacred), def, "duel-start").damage]).toEqual([285, 299, 300, 365]);
  });
  it("§10: 286 per hit into 1900 HP = 7 hits; with Crimson Bubbletear = 9", () => {
    expect(guide).toContain("⌈(1900 + 570) / 286⌉ = 9");
    const A = prepareFighter(data, str59, { scenario: "duel-start" });
    const atk = resolveAttack(data, str59, { attack: "2h R1 1" });
    expect(hitsToKill(data, A, atk, prepareFighter(data, dex57, { scenario: "duel-start" })).attacks).toBe(7);
    expect(hitsToKill(data, A, atk, prepareFighter(data, { ...dex57, tears: ["Crimson Bubbletear"] }, { scenario: "duel-start" })).attacks).toBe(9);
  });
  it("§11: Verdigris + Steel Gauntlets = 100 poise; × Bull-Goat = 133", () => {
    const f = prepareFighter(data, b(hk({ str: 59 }), "Heavy", steel, { talismans: ["Bull-Goat's Talisman"] }), { scenario: "duel-start" });
    expect(f.poise.armour).toBe(100);
    expect(Math.floor(f.poise.total)).toBe(133);
  });
  it("§15: 60 vigor = 1900 HP; 40 endurance = 90.9 max load", () => {
    const f = prepareFighter(data, dex57, { scenario: "base" });
    expect(f.maxHp).toBe(1900);
    expect(f.equipLoad.max.toFixed(1)).toBe("90.9");
  });
});
