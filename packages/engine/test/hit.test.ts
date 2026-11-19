import { describe, expect, it } from "vitest";
import { A3_WARNING, ASSUMPTIONS, apiHit, computeHit, explainHit, prepareFighter, renderHit, resolveAttack, type Build, type ScenarioName, type Stats } from "@ertc/engine";
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

describe("A3 warning: shown only while A3 is unconfirmed (confirmed in-game 2026-11-14)", () => {
  const ctx = { data, ruleset: loadLadderRuleset() };
  const sb = build(hk({ str: 30, dex: 42 }), "Keen", { rightHand: [{ weapon: "Shamshir", infusion: "Keen", upgrade: 25, ashOfWar: "Storm Blade" }] });
  it("a projectile hit no longer carries the warning or lists A3, now that A3 is confirmed", () => {
    expect(ASSUMPTIONS.A3.status).toBe("confirmed");
    const r = apiHit(ctx, sb, dex, { choiceA: { attack: "Storm Blade - Wind Slash 1", hits: "wind" }, choiceB: { attack: "1h R1 1" } });
    expect(r.meta.warnings).toEqual([]);
    expect(r.meta.assumptionsUsed).not.toContain("A3");
    expect(renderHit(r)).not.toContain(A3_WARNING);
  });
  it("normal attacks and weapon swings carry no warning", () => {
    for (const choiceA of [{ attack: "2h R1 1" }, { attack: "Storm Blade - Wind Slash 1", hits: "blade" }]) {
      const r = apiHit(ctx, sb, dex, { choiceA, choiceB: { attack: "1h R1 1" } });
      expect(r.meta.warnings).toEqual([]);
      expect(renderHit(r)).not.toContain("⚠");
    }
  });
});

describe("greases follow the weapon row's isEnhance flag (game data; supersedes docs/09 Q12's Standard/Heavy/Keen)", () => {
  const withBuff = (infusion: string, buff: string) => build(hk({ dex: 57 }), infusion, { buffs: [buff] });
  it("Drawstring Dragonbolt Grease applies on Standard, Heavy, Keen and Quality Shamshir (isEnhance 1)", () => {
    for (const infusion of ["Standard", "Heavy", "Keen", "Quality"]) {
      expect(hit(withBuff(infusion, "Drawstring Dragonbolt Grease"), str).types.find((t) => t.type === "lightning")!.flatBuff, infusion).toBeGreaterThan(0);
    }
  });
  it("a grease on Lightning, Fire or Cold Shamshir is refused (isEnhance 0)", () => {
    for (const infusion of ["Lightning", "Fire", "Cold"]) {
      expect(() => hit(withBuff(infusion, "Drawstring Dragonbolt Grease"), str), infusion).toThrow(/can't take greases \(game data/);
    }
  });
  it("weapon-art buffs are not greases: Sacred Blade still applies on Lightning", () => {
    expect(hit(withBuff("Lightning", "Sacred Blade"), str).types.find((t) => t.type === "holy")!.flatBuff).toBe(90);
  });
});

describe("attack-category conditions come from game data, never attack names", () => {
  // Item SpEffect magicSubCategoryChange (talisman side) vs AtkParam_Pc subCategory1–4 (hit side).
  const TALISMAN_CATEGORIES: [string, number[]][] = [
    ["Axe Talisman", [100]], ["Claw Talisman", [102]], ["Curved Sword Talisman", [103]], ["Twinblade Talisman", [104]],
    ["Roar Medallion", [106, 116]], ["Two-Handed Sword Talisman", [120]], ["Retaliatory Crossed-Tree", [121]], ["Lacerating Crossed-Tree", [122]],
  ];
  const shamshir = (talisman: string, ashOfWar?: string): Build => ({ ...str, talismans: [talisman], rightHand: [{ weapon: "Shamshir", infusion: "Heavy", upgrade: 25, ...(ashOfWar && { ashOfWar }) }] });
  const attacks = data.movesets.get("Shamshir")!.filter((a) => a.type === "Attack" && !/^(Paired|Offhand)/.test(a.name));
  it("data: each talisman's effect carries its game categories", () => {
    for (const [name, cats] of TALISMAN_CATEGORIES) {
      expect(data.talismans.get(name)!.effects.find((e) => e.categories !== undefined)!.categories, name).toEqual(cats);
    }
  });
  it("on every Shamshir attack, each talisman applies exactly when the hit shares a category", () => {
    let applied = 0, notApplied = 0;
    for (const [talisman, cats] of TALISMAN_CATEGORIES) {
      for (const a of attacks) {
        const ash = /Barbaric Roar/.test(a.name) ? "Barbaric Roar" : /War Cry/.test(a.name) ? "War Cry" : undefined;
        const b = shamshir(talisman, ash);
        const atk = resolveAttack(data, b, { attack: a.name });
        const tags = data.hits.get(atk.hits[0]!.id)?.atkParam?.subCategories ?? [];
        const A = prepareFighter(data, b, { scenario: "duel-start" });
        const D = prepareFighter(data, dex, { scenario: "duel-start" });
        const r = computeHit(data, A, atk, atk.hits[0]!, D, { attackerHpFraction: 1, defenderHpFraction: 1, counterHit: false, defenderDamageMultiplier: 1 });
        const on = r.attackerEffects.some((e) => e.source === talisman);
        expect(on, `${talisman} on ${a.name} (tags ${tags})`).toBe(cats.some((c) => tags.includes(c)));
        on ? applied++ : notApplied++;
      }
    }
    expect(applied).toBeGreaterThan(50);
    expect(notApplied).toBeGreaterThan(50);
  });
  it("name and game disagree → game wins: Retaliatory Crossed-Tree boosts a crouch attack; Axe Talisman skips a charged feint", () => {
    const fx = (talisman: string, attack: string) => {
      const b = shamshir(talisman);
      const atk = resolveAttack(data, b, { attack });
      const r = computeHit(data, prepareFighter(data, b, { scenario: "duel-start" }), atk, atk.hits[0]!, prepareFighter(data, dex, { scenario: "duel-start" }), { attackerHpFraction: 1, defenderHpFraction: 1, counterHit: false, defenderDamageMultiplier: 1 });
      return r.attackerEffects.some((e) => e.source === talisman);
    };
    expect(fx("Retaliatory Crossed-Tree", "1h Crouch R1")).toBe(true);
    expect(fx("Axe Talisman", "2h Charged R2 1 Feint")).toBe(false);
    expect(fx("Axe Talisman", "2h Charged R2 1")).toBe(true);
  });
});

describe("one weapon buff at a time (game: greases and weapon enchants share SpEffect category 162)", () => {
  it("a grease plus Sacred Blade is refused; Sacred Blade alone and a grease alone are fine", () => {
    expect(() => hit(build(hk({ str: 59 }), "Heavy", { buffs: ["Sacred Blade", "Drawstring Dragonbolt Grease"] }), dex)).toThrow(/one weapon buff at a time/);
    expect(hit(build(hk({ str: 59 }), "Heavy", { buffs: ["Sacred Blade"] }), dex).damage).toBeGreaterThan(0);
    expect(hit(build(hk({ str: 59 }), "Heavy", { buffs: ["Drawstring Dragonbolt Grease"] }), dex).damage).toBeGreaterThan(0);
  });
});
