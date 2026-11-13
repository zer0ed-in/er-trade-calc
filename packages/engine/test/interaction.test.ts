import { describe, expect, it } from "vitest";
import { loadLadderRuleset } from "@ertc/data";
import {
  BUFF_RESTRICTION_TABLE, checkLegality, computeTrade, hitsToKill, LADDER_RULE_TABLE, poiseAtFrame, prepareFighter, resolveAttack,
  type Build, type Stats,
} from "@ertc/engine";
import { data } from "./data.ts";
import { goldenDamage, goldenFrames, goldenPoise } from "./fixtures.ts";

const builds = goldenDamage().builds;
const asBuild = (id: string): Build => ({ ...builds[id]!, leftHand: [] });
const str = asBuild("str-shamshir-125");
const dex = asBuild("dex-shamshir-125");
const base = { scenario: "base" as const };
const A = prepareFighter(data, str, base, "str");
const B = prepareFighter(data, dex, base, "dex");
const r1 = { attack: "2h R1 1" };

describe("trade resolution", () => {
  it("Shamshir 2H R1 vs 2H R1 at offset 0 → trade, with both planner damages", () => {
    const t = computeTrade(data, A, B, r1, r1);
    expect(t.verdict.kind).toBe("trade");
    expect(t.a.damage!.total).toBe(286);
    expect(t.b.damage!.total).toBe(243);
    expect(t.a.timing.hitFrame).toBe(13);
    expect(t.b.timing.hitFrame).toBe(13);
  });
  it("A7: input delay 0 is a provable no-op (identical result to omitting it)", () => {
    expect(computeTrade(data, A, B, r1, r1, { inputDelayA: 0, inputDelayB: 0, offset: 0 })).toEqual(computeTrade(data, A, B, r1, r1));
  });
  it("input delay is additive frames only", () => {
    const t = computeTrade(data, A, B, r1, r1, { inputDelayB: 3 });
    expect(t.b.timing.hitFrame).toBe(13 + 3);
    expect(() => computeTrade(data, A, B, r1, r1, { inputDelayA: 1.5 })).toThrow(/whole number/);
  });
  it("first hit that breaks poise before the other's hit → no trade, winner named", () => {
    // B presses 5 frames later; A's 2H R1 (143 poise damage) breaks Verdigris poise before B's hit frame.
    const t = computeTrade(data, A, B, r1, r1, { offset: 5 });
    expect(t.verdict).toMatchObject({ kind: "no-trade", winner: "A" });
    expect(t.b.landed).toBe(false);
    expect(t.b.damage).toBeNull();
  });
  it("counter hit: A's hit lands inside B's #45 window (B mid-swing) and is tagged A4", () => {
    // A: Bull-Goat → 100 × 1.333 = 133 poise. B's 1h R1 (110 poise dmg, startup 14) starts 3 frames earlier: lands frame 11, A survives.
    // A's 2h R1 lands frame 13 = B's animation frame 16, inside B's counter window 14–28.
    const bullGoat = prepareFighter(data, { ...str, talismans: ["Bull-Goat's Talisman"] }, { scenario: "duel-start" }, "str");
    const t = computeTrade(data, bullGoat, B, r1, { attack: "1h R1 1" }, { offset: -3 });
    expect(t.verdict.kind).toBe("trade");
    expect(t.b.timing.hitFrame).toBe(11);
    expect(t.a.counterHitOnOther).toBe(true);
    expect(t.meta.assumptionsUsed).toContain("A4");
  });
  it("negative poise-taken is rejected", () => {
    expect(() => computeTrade(data, A, B, r1, r1, { poiseTakenA: -1 })).toThrow(/Poise taken/);
  });
});

describe("poise", () => {
  it("stagger at ≥ (110 breaks 110, survives 111; 143 breaks 143, survives 144)", () => {
    for (const c of goldenPoise().cases) {
      const atk = resolveAttack(data, str, { attack: c.attack });
      const pd = atk.hits[0]!.poiseDamage;
      expect(pd).toBe(c.expected.poiseDamage);
      expect(pd >= c.expected.breaksAtOrBelow).toBe(true);
      expect(pd >= c.expected.survivesFrom).toBe(false);
    }
  });
  it("Bull-Goat's Talisman multiplies armour poise (planner value 1.333…)", () => {
    const bg = prepareFighter(data, { ...dex, talismans: ["Bull-Goat's Talisman"] }, { scenario: "duel-start" });
    expect(bg.poise.total).toBeCloseTo(B.poise.armour * 1.33333333, 6);
  });
  it("HA effective poise uses the planner formula; SA is unbreakable", () => {
    const cs: Build = { ...str, stats: { ...str.stats, str: 59, dex: 13 }, rightHand: [{ weapon: "Greatsword", infusion: "Heavy", upgrade: 25 }] };
    const csF = prepareFighter(data, cs, base);
    const gs = resolveAttack(data, cs, { attack: "2h R1 1" });
    const ha = goldenFrames().cases.find((c) => c.id === "fr-colossal-2h-r1")!.expected.hyperArmour!;
    const inHa = poiseAtFrame(data, csF, gs, ha.range[0], 0);
    expect(inHa.kind).toBe("hyper-armour");
    if (inHa.kind === "hyper-armour") expect(inHa.poise).toBeCloseTo((csF.poise.armour * 1 + 90) * 1 / 0.45, 6);
    expect(poiseAtFrame(data, csF, gs, ha.range[1] + 1, 0).kind).toBe("normal");
    const tc: Build = { ...cs, rightHand: [{ weapon: "Dragon King's Cragblade", infusion: "Standard", upgrade: 10 }], stats: { ...str.stats, str: 40, dex: 32 } };
    const tcAtk = resolveAttack(data, tc, { attack: "Thundercloud Form - Thundercloud Strike, Thundercloud Form - Uncharged Landing Strike, Thundercloud Form - In air/fully charged landing" });
    expect(poiseAtFrame(data, prepareFighter(data, tc, base), tcAtk, 50, 0).kind).toBe("super-armour");
  });
});

describe("hits to kill (hit by hit, with duel state)", () => {
  it("str 2H R1 into the dex build: ceil(1900 / 286) = 7 with no effects", () => {
    const h = hitsToKill(data, A, resolveAttack(data, str, r1), B);
    expect(h.attacks).toBe(Math.ceil(1900 / 286));
  });
  it("Ritual Shield only cuts the first hit (full HP); later hits take full damage", () => {
    const shielded = prepareFighter(data, { ...dex, talismans: ["Ritual Shield Talisman"] }, { scenario: "duel-start" });
    const h = hitsToKill(data, A, resolveAttack(data, str, r1), shielded);
    expect(h.steps[0]!.damage).toBeLessThan(h.steps[1]!.damage);
    expect(h.steps[1]!.damage).toBe(286);
  });
  it("Crimson Bubbletear heals once (30% max HP) when HP drops below 21%", () => {
    const bubble = prepareFighter(data, { ...dex, tears: ["Crimson Bubbletear"] }, { scenario: "duel-start" });
    const h = hitsToKill(data, A, resolveAttack(data, str, r1), bubble);
    const healed = h.steps.filter((s) => s.event?.startsWith("Crimson Bubbletear"));
    expect(healed).toHaveLength(1);
    expect(healed[0]!.event).toContain(String(Math.trunc(0.3 * 1900)));
    expect(h.attacks).toBe(Math.ceil((1900 + 570) / 286));
  });
});

describe("ladder legality", () => {
  const rules = loadLadderRuleset();
  it("every ruleset line is mapped to a check or an explicit not-checkable reason", () => {
    const unmapped = [
      ...Object.values(rules.bans).flat().filter((r) => !(r in LADDER_RULE_TABLE)),
      ...rules.buffRestrictions.targets.filter((r) => !(r in BUFF_RESTRICTION_TABLE)),
    ];
    expect(unmapped).toEqual([]);
  });
  it("the golden builds are legal at RL 125", () => {
    expect(checkLegality(rules, { data, fighter: A }).legal).toBe(true);
  });
  it("illegal setups are rejected with the rule name", () => {
    const bad = prepareFighter(data, { ...str, talismans: ["Shard of Alexander"], tears: ["Thorny Cracked Tear"] }, { scenario: "duel-start" });
    const r = checkLegality(rules, { data, fighter: bad });
    expect(r.legal).toBe(false);
    expect(r.violations.map((v) => v.rule)).toEqual(expect.arrayContaining(["Ash-of-war damage talismans: Shard of Alexander, Warrior Jar Shard", "All damage-boosting tears (Flame-/Magic-/Lightning-/Holy-Shrouding, Thorny, Spiked)"]));
    const poison = prepareFighter(data, { ...str, buffs: ["Poison Grease"] }, { scenario: "duel-start" });
    expect(checkLegality(rules, { data, fighter: poison, attack: resolveAttack(data, str, r1) }).violations[0]!.rule).toBe("Poison greases on 2H Shamshir");
    expect(checkLegality(rules, { data, fighter: poison, attack: resolveAttack(data, str, { attack: "1h R1 1" }) }).legal).toBe(true);
  });
  it("extras and base-scenario equipment still count for legality (equipped ≠ effect applied)", () => {
    const extra = prepareFighter(data, str, { scenario: "base", extraTalismans: ["Shard of Alexander"] });
    expect(checkLegality(rules, { data, fighter: extra }).legal).toBe(false);
    const inBase = prepareFighter(data, { ...str, tears: ["Thorny Cracked Tear"] }, { scenario: "base" });
    expect(checkLegality(rules, { data, fighter: inBase }).legal).toBe(false);
  });
  it("RL other than 125 is reported", () => {
    const low = prepareFighter(data, asBuild("str-shamshir-115"), base);
    expect(checkLegality(rules, { data, fighter: low }).runeLevel).toEqual({ required: 125, actual: 115, ok: false });
  });
});
