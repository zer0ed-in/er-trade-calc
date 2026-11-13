import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { weaponAr, EngineError, type Stats } from "@ertc/engine";
import { data } from "./data.ts";
import { goldenAr, REPO_ROOT } from "./fixtures.ts";

const fullStats = (s: { str: number; dex: number; int: number; fth: number; arc: number }): Stats => ({ vig: 60, mnd: 8, end: 40, ...s });

describe("golden AR (fixtures/golden/ar.json)", () => {
  for (const c of goldenAr().cases) {
    it(`${c.id} [${c.status}]`, () => {
      const r = weaponAr(data, { weapon: c.weapon, infusion: c.infusion, upgrade: c.upgrade }, fullStats(c.stats), {
        twoHanded: c.twoHanded,
        disableTwoHandBonus: false,
      });
      if (c.expected.physical !== undefined) {
        // The planner displays AR rounded down; prototype cases carry a tolerance against the unrounded value.
        if (c.expected.tolerance !== undefined) expect(Math.abs(r.ar.physical - c.expected.physical)).toBeLessThanOrEqual(c.expected.tolerance);
        else expect(Math.floor(r.ar.physical)).toBe(c.expected.physical);
      }
      if (c.expected.total !== undefined) {
        const total = Object.values(r.ar).reduce((a, b) => a + b, 0);
        expect(Math.floor(total)).toBe(c.expected.total);
      }
    });
  }
});

describe("2H rule", () => {
  it("two-handing counts str ×1.5 rounded down (59 → 88)", () => {
    const r = weaponAr(data, { weapon: "Shamshir", infusion: "Heavy", upgrade: 25 }, fullStats({ str: 59, dex: 13, int: 7, fth: 8, arc: 9 }), { twoHanded: true, disableTwoHandBonus: false });
    expect(r.effectiveStr).toBe(88);
    expect(r.twoHandBonusApplied).toBe(true);
  });
  it("a hit that disables the 2H bonus gets 1H AR even when two-handed", () => {
    const stats = fullStats({ str: 59, dex: 13, int: 7, fth: 8, arc: 9 });
    const slot = { weapon: "Shamshir", infusion: "Heavy", upgrade: 25 };
    const oneH = weaponAr(data, slot, stats, { twoHanded: false, disableTwoHandBonus: false });
    const twoHDisabled = weaponAr(data, slot, stats, { twoHanded: true, disableTwoHandBonus: true });
    expect(twoHDisabled.ar).toEqual(oneH.ar);
  });
  it("Q5: 70 str two-handed (105) is capped by the scaling curve, not an error", () => {
    const at = (str: number) =>
      weaponAr(data, { weapon: "Shamshir", infusion: "Heavy", upgrade: 25 }, fullStats({ str, dex: 13, int: 7, fth: 8, arc: 9 }), { twoHanded: true, disableTwoHandBonus: false }).ar.physical;
    expect(at(70)).toBeGreaterThan(at(66)); // 99 vs 105 effective: still grows past 99 on curve 0 (maxVal 150)
    expect(Number.isFinite(at(99))).toBe(true); // 148 effective: inside the precomputed curve
  });
});

describe("scope: +25 / +10 only", () => {
  it("rejects +24 regular", () => {
    expect(() => weaponAr(data, { weapon: "Shamshir", infusion: "Keen", upgrade: 24 }, fullStats({ str: 15, dex: 57, int: 7, fth: 8, arc: 9 }), { twoHanded: false, disableTwoHandBonus: false })).toThrow(EngineError);
  });
  it("accepts +10 somber and rejects infusing it", () => {
    const stats = fullStats({ str: 40, dex: 40, int: 7, fth: 8, arc: 9 });
    expect(weaponAr(data, { weapon: "Dragon King's Cragblade", infusion: "Standard", upgrade: 10 }, stats, { twoHanded: false, disableTwoHandBonus: false }).maxUpgrade).toBe(10);
    expect(() => weaponAr(data, { weapon: "Dragon King's Cragblade", infusion: "Heavy", upgrade: 10 }, stats, { twoHanded: false, disableTwoHandBonus: false })).toThrow(/cannot be infused/);
  });
});

describe("data rule: only the snapshot script may contact Emilia's sites", () => {
  it("no other source file mentions her hosts", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", "raw", "gen", ".git"].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs|json|yml|yaml)$/.test(name) && /nyasu\.business/.test(readFileSync(p, "utf8"))) offenders.push(p.slice(REPO_ROOT.length));
      }
    };
    walk(join(REPO_ROOT, "packages"));
    walk(join(REPO_ROOT, ".github"));
    // credit.ts carries the credit-line URLs (display only, never fetched).
    expect(offenders.sort()).toEqual(["packages/data/scripts/snapshot-emilia.ts", "packages/engine/src/credit.ts"]);
  });
});
