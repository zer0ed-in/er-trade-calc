// Kick (A10, Zer0 2026-11-13) and ashes the game allows but our copy has no attack data for.
import { describe, expect, it } from "vitest";
import { computeAttack, computeTrade, listAttacks, NOT_SUPPORTED, prepareFighter, resolveAttack, type Build, type WeaponSlot } from "@ertc/engine";
import { data } from "./data.ts";

const armour = { head: "Divine Bird Helm", body: "Verdigris Armor", arms: "Steel Gauntlets", legs: "Verdigris Greaves" };
const strBody = { vig: 60, mnd: 8, end: 42, str: 55, dex: 15, int: 7, fth: 8, arc: 9 };
const dexBody = { vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 };
const mk = (stats: Build["stats"], slot: WeaponSlot): Build => ({ class: "Heavy Knight", stats, rightHand: [slot], armour, talismans: [], buffs: [] });
const dextra = mk(dexBody, { weapon: "Shamshir", infusion: "Keen", upgrade: 25, ashOfWar: "Spinning Slash" });
const fighter = (b: Build) => prepareFighter(data, b, { scenario: "base" });

describe("Kick (A10): fixed 1 physical, unscaled; poise and timing not supported", () => {
  for (const weapon of ["Estoc", "Star Fist", "Raptor Talons", "Urumi", "Reverse-Bladed Sword"]) {
    it(`${weapon}: Kick deals 1 damage, poise damage not supported`, () => {
      const kicker = mk(strBody, { weapon, infusion: "Heavy", upgrade: 25, ashOfWar: "Kick" });
      const attack = resolveAttack(data, kicker, { attack: "Kick" });
      const r = computeAttack(data, fighter(kicker), attack, fighter(dextra));
      expect(r.total).toBe(1);
      expect(r.poiseDamage).toBeNull();
      expect(r.assumptionsUsed).toContain("A10");
      expect(r.assumptionsUsed).not.toContain("A3");
      expect(r.notSupported[0]).toMatch(new RegExp(`^${NOT_SUPPORTED}: Kick .*poise damage.* — regulation\\.bin$`));
    });
  }
  it("a trade with Kick is not supported (never a guessed verdict)", () => {
    const kicker = mk(strBody, { weapon: "Estoc", infusion: "Heavy", upgrade: 25, ashOfWar: "Kick" });
    expect(() => computeTrade(data, fighter(kicker), fighter(dextra), { attack: "Kick" }, { attack: "2h R1 1" })).toThrow(/Not supported right now: Kick/);
  });
});

describe("ashes with no attack data are 'not supported', not errors that hide the rest", () => {
  const gk = mk(strBody, { weapon: "Great Katana", infusion: "Heavy", upgrade: 25, ashOfWar: "Sword Dance" });
  it("Great Katana + Sword Dance: the listing keeps the normal moveset and names what's missing", () => {
    const [listing] = listAttacks(data, gk);
    expect(listing!.attacks.some((a) => a.name === "2h R1 1")).toBe(true);
    expect(listing!.notSupported).toMatch(/^Not supported right now: Sword Dance on Great Katana — /);
  });
  it("normal attacks still compute; the skill itself throws not-supported", () => {
    expect(computeAttack(data, fighter(gk), resolveAttack(data, gk, { attack: "2h R1 1" }), fighter(dextra)).total).toBeGreaterThan(0);
    expect(() => resolveAttack(data, gk, { attack: "Sword Dance" })).toThrow(expect.objectContaining({ code: "not-supported" }));
  });
  it("Urumi + Hoarfrost Stomp now comes from FDE's animation users (a710_040000)", () => {
    const urumi = mk(strBody, { weapon: "Urumi", infusion: "Heavy", upgrade: 25, ashOfWar: "Hoarfrost Stomp" });
    const skill = listAttacks(data, urumi)[0]!.attacks.filter((a) => a.type === "WeaponSkill");
    expect(skill.map((a) => a.name)).toContain("Startup");
    expect(resolveAttack(data, urumi, { attack: "Startup" }).entry).toMatchObject({ filename: "a710_040000", source: "fde-animation-users" });
  });
  it("an ash the game doesn't allow on the weapon is still an illegal-ash error", () => {
    expect(() => listAttacks(data, mk(strBody, { weapon: "Shamshir", infusion: "Heavy", upgrade: 25, ashOfWar: "Ice Spear" }))).toThrow(/doesn't allow/);
  });
});
