import { describe, expect, it } from "vitest";
import { computeHit, defenceCurve, defences, prepareFighter, resolveAttack, runeLevel, type Build } from "@ertc/engine";
import { data } from "./data.ts";
import { goldenDamage, goldenDefences, goldenMisc, type NeutralBuild } from "./fixtures.ts";

// The fixture's neutral build shape is the engine's Build shape (fixtures/builds/README.md).
const asBuild = (b: NeutralBuild): Build => ({ ...b, rightHand: b.rightHand, leftHand: [] });
const damage = goldenDamage();

describe("golden damage — planner-verified, exact (fixtures/golden/damage.json)", () => {
  for (const c of damage.cases) {
    it(`${c.id}: ${c.attacker} → ${c.defender} ${c.attack} = ${c.expected.damage}`, () => {
      const attackerBuild = asBuild(damage.builds[c.attacker]!);
      const defenderBuild = asBuild(damage.builds[c.defender]!);
      const attacker = prepareFighter(data, attackerBuild, { scenario: "base" });
      const defender = prepareFighter(data, defenderBuild, { scenario: "base" });
      expect(attacker.rl).toBe(damage.builds[c.attacker]!.rl);
      const attack = resolveAttack(data, attackerBuild, { attack: c.attack, ...(c.grip && { grip: c.grip }) });
      if (c.plannerTotal === "floor-of-sum") {
        // The planner's total for a multi-hit attack (router bundle: Math.floor(n.total.damage.total)).
        const unrounded = attack.hits.map((h) => computeHit(data, attacker, attack, h, defender).types.reduce((sum, t) => sum + t.damage, 0));
        expect(attack.hits.length).toBeGreaterThan(1);
        expect(Math.floor(unrounded.reduce((a, b) => a + b, 0))).toBe(c.expected.damage);
        return;
      }
      expect(attack.hits).toHaveLength(1);
      const r = computeHit(data, attacker, attack, attack.hits[0]!, defender);
      expect(r.damage).toBe(c.expected.damage);
      const phys = r.types.find((t) => t.type === "physical")!;
      if (c.expected.mv !== undefined) expect(phys.mv).toBe(c.expected.mv);
      if (c.expected.ar !== undefined) expect(Math.floor(phys.ar)).toBe(c.expected.ar);
      if (c.expected.plannerPhysicalColumn !== undefined) expect(Math.floor(phys.weaponPart)).toBe(c.expected.plannerPhysicalColumn);
      if (c.expected.defenderPhysicalDefence !== undefined) expect(phys.defence).toBe(c.expected.defenderPhysicalDefence);
    });
  }
});

describe("golden defences (fixtures/golden/defences.json)", () => {
  const fx = goldenDefences();
  for (const c of fx.cases) {
    it(`${c.id} (RL ${c.rl})`, () => {
      // Probes vary one stat freely (def-end10 goes below the Heavy Knight base), so RL is checked with the fixture's
      // own definition (Σ stats − 79); real builds go through runeLevel(), which rejects stats below the class base.
      const sum = Object.values(c.stats).reduce((a, b) => a + b, 0);
      expect(sum - 79).toBe(c.rl);
      if (Object.entries(c.stats).every(([k, v]) => v >= data.classes.get(c.class)!.base[k as keyof typeof c.stats])) expect(runeLevel(data, { class: c.class, stats: c.stats })).toBe(c.rl);
      const d = defences(data, c.stats).total;
      for (const [t, v] of Object.entries(c.expected)) if (v !== undefined) expect(d[t as keyof typeof d], t).toBe(v);
    });
  }
  it("full Verdigris absorption % matches the planner", () => {
    const b: Build = { class: "Heavy Knight", stats: fx.cases[0]!.stats, rightHand: [], armour: fx.absorption.armour, talismans: [], buffs: [] };
    const f = prepareFighter(data, b, { scenario: "base" });
    const pct = (t: keyof typeof f.cutRates) => +(100 * (1 - f.cutRates[t])).toFixed(3);
    const e = fx.absorption.expectedPercent;
    expect({ physical: pct("standard"), strike: pct("strike"), slash: pct("slash"), pierce: pct("pierce"), magic: pct("magic"), fire: pct("fire"), lightning: pct("lightning"), holy: pct("holy") }).toEqual(e);
  });
});

describe("misc planner facts (fixtures/golden/misc.json)", () => {
  const cases = Object.fromEntries(goldenMisc().cases.map((c) => [c.id, c]));
  const hk = { vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 };
  const verdigris = { head: "Verdigris Helm", body: "Verdigris Armor", arms: "Verdigris Gauntlets", legs: "Verdigris Greaves" };
  const f = prepareFighter(data, { class: "Heavy Knight", stats: hk, rightHand: [{ weapon: "Shamshir", infusion: "Keen", upgrade: 25 }], armour: verdigris, talismans: [], buffs: [] }, { scenario: "base" });
  it("rl-heavy-knight", () => expect(f.rl).toBe(cases["rl-heavy-knight"]!.expected.rl));
  it("hp-vig60", () => expect(f.maxHp).toBe(cases["hp-vig60"]!.expected.hp));
  it("weight-verdigris-full", () => expect(+(f.equipLoad.weight - 3.5).toFixed(1)).toBe(cases["weight-verdigris-full"]!.expected.weight));
  it("load-end40 (Verdigris + Shamshir = 71.6% Heavy)", () => {
    expect(Math.abs(f.equipLoad.max - cases["load-end40"]!.expected.maxLoad!)).toBeLessThanOrEqual(cases["load-end40"]!.expected.tolerance!);
    expect(+f.equipLoad.percent.toFixed(1)).toBe(71.6);
    expect(f.equipLoad.roll).toBe("Heavy");
  });
});

describe("defence curve (docs/03 rule 2)", () => {
  it("worked example: f(564.96/132) = 0.8085…", () => expect(defenceCurve(564.955 / 132)).toBeCloseTo(0.8085, 4));
  it("bounds", () => {
    expect(defenceCurve(100)).toBe(0.9);
    expect(defenceCurve(0.05)).toBe(0.1);
    expect(defenceCurve(1)).toBeCloseTo(0.4, 10);
    expect(defenceCurve(2.5)).toBeCloseTo(0.7, 10);
  });
});
