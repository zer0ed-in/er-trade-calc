import { describe, expect, it } from "vitest";
import { parseRlRange, sweepRuneLevel, type Build } from "@ertc/engine";
import { data } from "./data.ts";
import { goldenDamage } from "./fixtures.ts";

const fx = goldenDamage();
const asBuild = (id: string): Build => ({ ...fx.builds[id]!, leftHand: [] });
const r1 = { attack: "2h R1 1" };

describe("RL sweep reproduces the planner-verified 32-point sweep", () => {
  const res = sweepRuneLevel(data, asBuild("str-shamshir-125"), asBuild("dex-shamshir-125"), {
    a: { stat: "str", rls: parseRlRange("95..125:2") }, b: {}, scenario: { scenario: "base" }, choiceA: r1, choiceB: r1,
  });
  for (const c of fx.cases.filter((c) => c.id.startsWith("sweep-"))) {
    it(c.id, () => {
      const strRl = Number((c.attacker.startsWith("str") ? c.attacker : c.defender).split("-").pop());
      const row = res.rows.find((r) => r.rlA === strRl)!;
      expect(row.valid).toBe(true);
      expect(c.attacker.startsWith("str") ? row.aToB : row.bToA).toBe(c.expected.damage);
    });
  }
  it("HTK parity at str RL 115 and damage parity at 107 (planner-verified sweep)", () => {
    const at = (rl: number) => res.rows.find((r) => r.rlA === rl)!;
    expect(at(115).htkAtoB).toBe(at(115).htkBtoA);
    expect(at(117).htkAtoB).not.toBe(at(117).htkBtoA);
    // "Damage parity at 107" = the crossover: str still ahead at 109 (255 vs 250), dex ahead from 107 (250 vs 251).
    expect(at(109).aToB!).toBeGreaterThan(at(109).bToA!);
    expect(at(107).aToB!).toBeLessThan(at(107).bToA!);
    expect(Math.abs(at(107).aToB! - at(107).bToA!)).toBeLessThanOrEqual(1);
  });
});

describe("sweep validity", () => {
  it("points that push a stat under the class base are reported, not dropped", () => {
    const res = sweepRuneLevel(data, asBuild("str-shamshir-125"), asBuild("dex-shamshir-125"), {
      a: { stat: "str", rls: [80] }, b: {}, scenario: { scenario: "base" }, choiceA: r1, choiceB: r1,
    });
    expect(res.rows[0]).toMatchObject({ valid: false });
    expect(res.rows[0]!.invalidReason).toMatch(/below the Heavy Knight base/);
  });
  it("parses ranges", () => {
    expect(parseRlRange("95..99")).toEqual([95, 96, 97, 98, 99]);
    expect(parseRlRange("125")).toEqual([125]);
    expect(() => parseRlRange("x")).toThrow();
  });
});
