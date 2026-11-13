// Kick from its game rows (behaviors 300000085/86 → AtkParam 301100800/801) and ashes the game allows but our copy has no attack data for.
import { describe, expect, it } from "vitest";
import { computeAttack, computeTrade, listAttacks, NOT_SUPPORTED, poiseAtFrame, prepareFighter, resolveAttack, type Build, type WeaponSlot } from "@ertc/engine";
import { data } from "./data.ts";

const armour = { head: "Divine Bird Helm", body: "Verdigris Armor", arms: "Steel Gauntlets", legs: "Verdigris Greaves" };
const strBody = { vig: 60, mnd: 8, end: 42, str: 55, dex: 15, int: 7, fth: 8, arc: 9 };
const dexBody = { vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 };
const mk = (stats: Build["stats"], slot: WeaponSlot): Build => ({ class: "Heavy Knight", stats, rightHand: [slot], armour, talismans: [], buffs: [] });
const dextra = mk(dexBody, { weapon: "Shamshir", infusion: "Keen", upgrade: 25, ashOfWar: "Spinning Slash" });
const fighter = (b: Build) => prepareFighter(data, b, { scenario: "base" });

describe("Kick: computed from its AtkParam rows; timing not supported", () => {
  const kicker = mk(strBody, { weapon: "Estoc", infusion: "Heavy", upgrade: 25, ashOfWar: "Kick" });
  const attack = resolveAttack(data, kicker, { attack: "Kick" });
  it("two hits: behaviors 300000085/86 → AtkParam 301100800/801, 30 physical flat each, table 50000 (no stat scaling)", () => {
    expect(attack.allHits.map((h) => h.row.atkParam?.id)).toEqual([301100800, 301100801]);
    for (const h of attack.allHits) {
      expect(h.flat.physical).toBe(30);
      expect(h.skillTable).toBe(50000);
      expect(h.physAttribute).toBe("strike");
    }
  });
  it("hit 1: flat poise 6 × 2.7 × 10 = 162 (A11), push + long stagger, 999 stamina damage; hit 2: 50% of weapon poise, short, 700", () => {
    const [h1, h2] = attack.allHits;
    expect(h1!.poiseDamage).toBeCloseTo(162, 9);
    expect(h1!.hitstun).toEqual({ level: 5, name: "push + long stagger" });
    expect(h1!.staminaDamage).toBe(999);
    // Estoc saWeaponDamage 4 → 4 × 50/100 × 2.7 × 10
    expect(h2!.poiseDamage).toBeCloseTo(54, 9);
    expect(h2!.hitstun).toEqual({ level: 1, name: "short" });
    expect(h2!.staminaDamage).toBe(700);
  });
  for (const weapon of ["Estoc", "Star Fist", "Raptor Talons", "Urumi", "Reverse-Bladed Sword"]) {
    it(`${weapon}: Kick damage is computed (A3 flat path), poise is known, timing is not supported`, () => {
      const k = mk(strBody, { weapon, infusion: "Heavy", upgrade: 25, ashOfWar: "Kick" });
      const r = computeAttack(data, fighter(k), resolveAttack(data, k, { attack: "Kick" }), fighter(dextra));
      expect(r.total).toBeGreaterThan(0);
      expect(r.poiseDamage).toBeGreaterThan(162);
      expect(r.assumptionsUsed).toContain("A3");
      expect(r.hitEffects[0]!.note).toBe("999 stamina damage, guard break if blocked (blocking not supported)");
      expect(r.notSupported[0]).toMatch(new RegExp(`^${NOT_SUPPORTED}: Kick trade / timing — .* — animation data$`));
    });
  }
  it("a trade with Kick is not supported (never a guessed verdict)", () => {
    expect(() => computeTrade(data, fighter(kicker), fighter(dextra), { attack: "Kick" }, { attack: "2h R1 1" })).toThrow(/Not supported right now: Kick trade/);
  });
  it("Kick's hyper armour (ToughnessParam 165) raises current poise to the 150 floor at window start", () => {
    const f = fighter(kicker);
    const st = poiseAtFrame(data, f, attack, 10, 10_000);
    expect(st.kind).toBe("hyper-armour");
    if (st.kind === "hyper-armour") expect(st.poise).toBeCloseTo(150 / 0.5, 9);
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
