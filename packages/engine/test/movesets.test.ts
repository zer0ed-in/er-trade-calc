// Move-list cleanup (Zer0, 2026-11-13): shared extra hit rows excluded, mounted attacks removed.
import { describe, expect, it } from "vitest";
import { computeAttack, listAttacks, prepareFighter, resolveAttack, type Build, type WeaponSlot } from "@ertc/engine";
import { data } from "./data.ts";

const armour = { head: "Divine Bird Helm", body: "Verdigris Armor", arms: "Steel Gauntlets", legs: "Verdigris Greaves" };
// The reference bodies: strenuous (str) and dextra_erpvp_test (dex).
const strBody = { vig: 60, mnd: 8, end: 42, str: 55, dex: 15, int: 7, fth: 8, arc: 9 };
const dexBody = { vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 };
const mk = (stats: Build["stats"], slot: WeaponSlot): Build => ({ class: "Heavy Knight", stats, rightHand: [slot], armour, talismans: [], buffs: [] });
const dextra = mk(dexBody, { weapon: "Shamshir", infusion: "Keen", upgrade: 25, ashOfWar: "Spinning Slash" });
const lance = mk(strBody, { weapon: "Lance", infusion: "Heavy", upgrade: 25 });

describe("shared extra hit rows (AtkParam 500, 500000000–500000008) are excluded", () => {
  it("Lance Heavy 2H R1 1, str body into dex body = 369 (one hit, not 1288)", () => {
    const attack = resolveAttack(data, lance, { attack: "2h R1 1" });
    expect(attack.allHits).toHaveLength(1);
    const r = computeAttack(data, prepareFighter(data, lance, { scenario: "base" }), attack, prepareFighter(data, dextra, { scenario: "base" }));
    expect(r.total).toBe(369);
    expect(r.attack.hitsTotal).toBe(1);
  });
  it("hit selectors count only real hits", () => {
    expect(() => resolveAttack(data, lance, { attack: "2h R1 1", hits: "2" })).toThrow(/has 1 hits/);
  });
  it("no move list anywhere still carries one of those rows", () => {
    for (const attacks of data.movesets.values())
      for (const a of attacks) for (const id of a.hitIds) expect(id.startsWith("500:") || /^50000000[0-8]:/.test(id), `${a.name} ${id}`).toBe(false);
  });
  it("two-row attacks with real rows keep both hits (Messmer Soldier's Spear, Treespear 2H Charged R2 1)", () => {
    for (const weapon of ["Messmer Soldier's Spear", "Treespear"]) {
      const b = mk(strBody, { weapon, infusion: "Standard", upgrade: weapon === "Treespear" ? 10 : 25 });
      expect(resolveAttack(data, b, { attack: "2h Charged R2 1" }).allHits, weapon).toHaveLength(2);
    }
  });
  it("zero-stamina rows in general are not dropped (an ash with zero-stamina hit rows keeps them)", () => {
    const sb = mk(strBody, { weapon: "Shamshir", infusion: "Heavy", upgrade: 25, ashOfWar: "Storm Blade" });
    expect(resolveAttack(data, sb, { attack: "Storm Blade - Wind Slash 1" }).allHits).toHaveLength(2);
  });
});

describe("mounted attacks are removed", () => {
  it("never listed and never resolvable", () => {
    for (const attacks of data.movesets.values()) for (const a of attacks) expect(a.name.startsWith("Mounted")).toBe(false);
    expect(listAttacks(data, lance).flatMap((l) => l.attacks.map((a) => a.name)).some((n) => /Mounted/.test(n))).toBe(false);
    expect(() => resolveAttack(data, lance, { attack: "Mounted R1 1" })).toThrow(/can't do/);
  });
});
