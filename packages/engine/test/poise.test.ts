// Poise model from game data (docs/public/formulas.md, poise section) and the 2H flag from the resolved AtkParam row (A8).
import { describe, expect, it } from "vitest";
import { computeAttack, computeTrade, poiseAtFrame, poiseRecoverySeconds, prepareFighter, resolveAttack, simulatePoise, type Build, type WeaponSlot } from "@ertc/engine";
import { data } from "./data.ts";

const armour = { head: "Divine Bird Helm", body: "Verdigris Armor", arms: "Steel Gauntlets", legs: "Verdigris Greaves" };
const strBody = { vig: 60, mnd: 8, end: 42, str: 55, dex: 15, int: 7, fth: 8, arc: 9 };
const dexBody = { vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 };
const mk = (stats: Build["stats"], slot: WeaponSlot): Build => ({ class: "Heavy Knight", stats, rightHand: [slot], armour, talismans: [], buffs: [] });
const fighter = (b: Build) => prepareFighter(data, b, { scenario: "base" });
const dexShamshir = mk(dexBody, { weapon: "Shamshir", infusion: "Keen", upgrade: 25 });

describe("PvP poise damage = (atkSuperArmor + saWeaponDamage × atkSuperArmorCorrection/100) × saRate × 10", () => {
  const poise = (slot: WeaponSlot, attack: string, stats = strBody) => resolveAttack(data, mk(stats, slot), { attack, grip: "1h" }).allHits.map((h) => h.poiseDamage);
  it("Shamshir 1H R1: 5 raw → 110; 2H R1 → 143 (planner-verified)", () => {
    expect(poise({ weapon: "Shamshir", infusion: "Heavy", upgrade: 25 }, "1h R1 1")[0]).toBeCloseTo(110, 9);
    expect(poise({ weapon: "Shamshir", infusion: "Heavy", upgrade: 25 }, "2h R1 1")[0]).toBeCloseTo(143, 9);
  });
  it("Lion's Claw on Knight's Greatsword: 5.5 × 600/100 = 33 raw → 891", () => {
    expect(poise({ weapon: "Knight's Greatsword", infusion: "Heavy", upgrade: 25, ashOfWar: "Lion's Claw" }, "Lion's Claw")[0]).toBeCloseTo(891, 9);
  });
  it("flat-poise ash hits include the flat part the planner leaves out (Beast's Roar 6 × 2.7 × 10 = 162 per hit; planner 0)", () => {
    const hits = resolveAttack(data, mk(dexBody, { weapon: "Wakizashi", infusion: "Keen", upgrade: 25, ashOfWar: "Beast's Roar" }), { attack: "Beast's Roar - Roar" }).allHits;
    for (const h of hits) {
      expect(h.poiseDamage).toBeCloseTo(162, 9);
      expect(h.poise.plannerValue).toBe(0);
    }
  });
});

describe("poise over time: chip, break at ≤ 0, 30 s refill, reset after a break (A12)", () => {
  it("recovery time = baseToughnessRecoverTime 30 × toughnessRecoverCorrection 1", () => {
    expect(poiseRecoverySeconds(data)).toBe(30);
  });
  it("chip accumulates; the hit that takes poise to ≤ 0 breaks it; poise is full again after a break (A12)", () => {
    const { steps, assumptions } = simulatePoise(133, [{ poiseDamage: 110, atSecond: 0 }, { poiseDamage: 23, atSecond: 1 }, { poiseDamage: 110, atSecond: 2 }], 30);
    expect(steps.map((s) => [s.poiseBefore, s.broke, s.poiseAfter])).toEqual([[133, false, 23], [23, true, 133], [133, false, 23]]);
    expect(assumptions).toEqual(["A12"]);
  });
  it("30 s after the last hit poise is full again", () => {
    const { steps } = simulatePoise(133, [{ poiseDamage: 110, atSecond: 0 }, { poiseDamage: 110, atSecond: 30 }], 30);
    expect(steps.map((s) => s.broke)).toEqual([false, false]);
    expect(simulatePoise(133, [{ poiseDamage: 110, atSecond: 0 }, { poiseDamage: 110, atSecond: 29.9 }], 30).steps[1]!.broke).toBe(true);
  });
  it("trade: poise taken 30 s or more ago is ignored", () => {
    const a = fighter(mk(strBody, { weapon: "Shamshir", infusion: "Heavy", upgrade: 25 }));
    // 93 armour poise × Bull-Goat 1.333 = 124 > 110: survives fresh, breaks with 100 taken
    const b = prepareFighter(data, { ...dexShamshir, talismans: ["Bull-Goat's Talisman"] }, { scenario: "duel-start" });
    const r = (secondsSinceHitB: number) => computeTrade(data, a, b, { attack: "1h R1 1" }, { attack: "1h R1 1" }, { offset: 5, poiseTakenB: 100, secondsSinceHitB });
    expect(r(0).b.landed).toBe(false);
    expect(r(30).b.landed).toBe(true);
  });
});

describe("hyper armour from ToughnessParam", () => {
  it("Storm Stomp (row 180: minToughness 30, unscaled): current poise is raised to 300 at window start, poise damage taken × 0.5", () => {
    const b = mk(strBody, { weapon: "Shamshir", infusion: "Heavy", upgrade: 25, ashOfWar: "Storm Stomp" });
    const atk = resolveAttack(data, b, { attack: "Storm Stomp - Stomp, Hoarfrost Stomp - Stomp (Storm Stomp)" });
    const st = poiseAtFrame(data, fighter(b), atk, 12, 120);
    expect(st.kind === "hyper-armour" && st.toughnessRow).toBe(180);
    if (st.kind === "hyper-armour") expect(st.poise).toBeCloseTo(300 / 0.5, 9);
  });
  it("Greatsword 2H R1 (row with weapon toughness): (armour × 1 + 90) / 0.45, same as the planner", () => {
    const b = mk({ ...strBody, str: 59, dex: 13 }, { weapon: "Greatsword", infusion: "Heavy", upgrade: 25 });
    const f = fighter(b);
    const atk = resolveAttack(data, b, { attack: "2h R1 1" });
    const w = data.animations.get(atk.entry.filename)!.hyperArmour[0]!;
    const st = poiseAtFrame(data, f, atk, w.range[0], 0);
    if (st.kind !== "hyper-armour") throw new Error(st.kind);
    expect(st.poise).toBeCloseTo((f.poise.armour + 90) / 0.45, 6);
  });
});

describe("hitstun level and stamina damage", () => {
  it("Ice Spear projectile: long hitstun (dmgLevel 3); Lance 2H R1: moderate", () => {
    const ice = resolveAttack(data, mk(strBody, { weapon: "Banished Knight's Halberd", infusion: "Heavy", upgrade: 25, ashOfWar: "Ice Spear" }), { attack: "Ice Throw" });
    expect(ice.allHits[1]!.hitstun).toEqual({ level: 3, name: "long" });
    const lance = resolveAttack(data, mk(strBody, { weapon: "Lance", infusion: "Heavy", upgrade: 25 }), { attack: "2h R1 1" });
    expect(lance.allHits.at(-1)!.hitstun).toEqual({ level: 2, name: "moderate" });
  });
  it("dmgLevel_vsPlayer wins when set", () => {
    const row = [...data.hits.values()].find((r) => r.atkParam && r.atkParam.dmgLevel_vsPlayer > 0)!;
    expect(row.atkParam!.dmgLevel_vsPlayer).not.toBe(row.atkParam!.dmgLevel);
  });
});

describe("2H bonus from the resolved AtkParam row (A8, game data)", () => {
  const def = fighter(dexShamshir);
  it("Bloodfiend's Arm 2H Charged R2 1: hit 1 gets 2H, hit 2's row turns it off — labelled as differing from the planner", () => {
    const b = mk({ ...strBody, arc: 16 }, { weapon: "Bloodfiend's Arm", infusion: "Heavy", upgrade: 25 });
    const r = computeAttack(data, fighter(b), resolveAttack(data, b, { attack: "2h Charged R2 1" }), def);
    expect(r.hits.map((h) => h.twoHandBonusApplied)).toEqual([true, false]);
    expect(r.hits[1]!.warnings).toContain("2H str bonus off for this hit: game data, differs from planner (the planner applies it)");
    expect(r.hits[0]!.warnings).toEqual([]);
  });
  it("Star Fist 2H Charged R2 1: flag off, but paired weapons never get 2H, so nothing changes and no label", () => {
    const b = mk(strBody, { weapon: "Star Fist", infusion: "Heavy", upgrade: 25 });
    const r = computeAttack(data, fighter(b), resolveAttack(data, b, { attack: "2h Charged R2 1" }), def);
    expect(r.hits.every((h) => !h.twoHandBonusApplied && h.warnings.length === 0)).toBe(true);
  });
  it("the one hit without a row (Taker's Flames 300314902) is not supported when two-handed, computed one-handed", () => {
    const b = mk(strBody, { weapon: "Blasphemous Blade", infusion: "Standard", upgrade: 10 });
    const twoH = computeAttack(data, fighter(b), resolveAttack(data, b, { attack: "Startup", grip: "2h" }), def);
    expect(twoH.hits[2]!.damage).toBeNull();
    expect(twoH.hits[2]!.unknownReason).toMatch(/^Not supported right now: 2H bonus for hit 300314902/);
    const oneH = computeAttack(data, fighter(b), resolveAttack(data, b, { attack: "Startup", grip: "1h" }), def);
    expect(oneH.hits[2]!.damage).not.toBeNull();
  });
});
