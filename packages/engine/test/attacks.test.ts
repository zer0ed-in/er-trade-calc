import { describe, expect, it } from "vitest";
import { computeAttack, listAttacks, prepareFighter, resolveAttack, type Build, type Stats, type WeaponSlot } from "@ertc/engine";
import { data } from "./data.ts";
import { goldenAttacks, goldenFrames, goldenPoise } from "./fixtures.ts";

const armour = { head: "Verdigris Helm", body: "Verdigris Armor", arms: "Verdigris Gauntlets", legs: "Verdigris Greaves" };
const hk = (s: Partial<Stats>): Stats => ({ vig: 60, mnd: 8, end: 40, str: 15, dex: 13, int: 7, fth: 8, arc: 9, ...s });
const mk = (stats: Stats, slot: WeaponSlot): Build => ({ class: "Heavy Knight", stats, rightHand: [slot], armour, talismans: [], buffs: [] });
const dexDefender = mk(hk({ dex: 57 }), { weapon: "Shamshir", infusion: "Keen", upgrade: 25 });

const attackInto = (attacker: Build, choice: Parameters<typeof resolveAttack>[2], defender = dexDefender) => {
  const A = prepareFighter(data, attacker, { scenario: "base" });
  const D = prepareFighter(data, defender, { scenario: "base" });
  return computeAttack(data, A, resolveAttack(data, attacker, choice), D);
};

describe("attack lists use the planner's names", () => {
  const b = mk(hk({ str: 59 }), { weapon: "Shamshir", infusion: "Heavy", upgrade: 25, ashOfWar: "Storm Blade" });
  const names = listAttacks(data, b).flatMap((l) => l.attacks.map((a) => a.name));
  it("includes normal moves and the mounted ash's stages only", () => {
    for (const n of ["1h R1 1", "2h R1 1", "1h R2 1 Release", "2h Running R1", "Storm Blade - Wind Slash 1"]) expect(names).toContain(n);
    expect(names.some((n) => n.startsWith("Spinning Slash"))).toBe(false);
  });
  it("defaults to the weapon's own skill when no ash is mounted", () => {
    const plain = listAttacks(data, mk(hk({ str: 59 }), { weapon: "Shamshir", infusion: "Heavy", upgrade: 25 }));
    expect(plain[0]!.skill).toBe("Spinning Slash");
  });
  it("rejects an ash the weapon can't take", () => {
    expect(() => listAttacks(data, mk(hk({}), { weapon: "Shamshir", infusion: "Heavy", upgrade: 25, ashOfWar: "Ice Spear" }))).toThrow(/can't be used/);
  });
});

describe("Storm Blade: blade + wind as separate hits (A3)", () => {
  const sb = mk(hk({ str: 59 }), { weapon: "Shamshir", infusion: "Heavy", upgrade: 25, ashOfWar: "Storm Blade" });
  const fx = goldenAttacks().cases.find((c) => c.id === "atk-stormblade-1")! as { hits: { physicalMV?: number; physicalFlat?: number; physAttribute?: string; pvpFinalRate?: number; startup: number; atkParam?: Record<string, number> }[] };
  it("matches the attack data (blade MV 65 Slash, wind flat 150 Standard, PvP rate 0.8)", () => {
    const r = resolveAttack(data, sb, { attack: "Storm Blade - Wind Slash 1" });
    expect(r.allHits.map((h) => h.kind)).toEqual(["weapon", "flat"]);
    const [blade, wind] = r.allHits;
    expect(blade!.mv.physical).toBe(fx.hits[0]!.physicalMV);
    expect(blade!.physAttribute).toBe("slash");
    expect(blade!.startup).toBe(fx.hits[0]!.startup);
    expect(wind!.flat.physical).toBe(fx.hits[1]!.physicalFlat);
    expect(wind!.physAttribute).toBe("standard");
    expect(wind!.finalRate.physical).toBe(fx.hits[1]!.pvpFinalRate);
    expect(wind!.skillTable).toBe(fx.hits[1]!.atkParam!.overwriteAttackElementCorrectId);
    expect(wind!.disable2H).toEqual({ value: true, source: "AtkParam" });
  });
  it("returns each hit's own number and tags the wind with A3", () => {
    const all = attackInto(sb, { attack: "Storm Blade - Wind Slash 1" });
    const wind = attackInto(sb, { attack: "Storm Blade - Wind Slash 1", hits: "wind" });
    const blade = attackInto(sb, { attack: "Storm Blade - Wind Slash 1", hits: "blade" });
    expect(all.hits).toHaveLength(2);
    expect(all.total).toBe(blade.total! + wind.total!);
    expect(wind.assumptionsUsed).toContain("A3");
    expect(blade.assumptionsUsed).not.toContain("A3");
    expect(wind.hits[0]!.skill!.scaling.map((s) => s.stat).sort()).toEqual(["dex", "str"]);
  });
});

describe("evidence-pve: every ash does identical damage 1H and 2H", () => {
  const strB = hk({ str: 61, dex: 11 });
  const dexB = hk({ str: 15, dex: 57 });
  const cases: [string, string, string, string[]][] = [
    ["Wakizashi", "Beast's Roar", "Beast's Roar - Roar", ["Heavy", "Lightning", "Fire", "Keen", "Cold"]],
    ["Wakizashi", "Storm Blade", "Storm Blade - Wind Slash 1", ["Heavy", "Lightning", "Fire", "Keen", "Cold"]],
    ["Banished Knight's Halberd", "Ice Spear", "Ice Throw", ["Heavy", "Cold", "Keen"]], // the planner names Ice Spear's attack "Ice Throw"
  ];
  for (const [weapon, ash, attackPrefix, infusions] of cases) {
    for (const infusion of infusions) for (const stats of [strB, dexB]) {
      it(`${weapon} ${infusion} ${ash} (${stats.str} str / ${stats.dex} dex)`, () => {
        const b = mk(stats, { weapon, infusion, upgrade: 25, ashOfWar: ash });
        const name = listAttacks(data, b)[0]!.attacks.find((a) => a.type === "WeaponSkill" && a.name.startsWith(attackPrefix) && !/No FP/.test(a.name))!.name;
        const oneH = attackInto(b, { attack: name, grip: "1h" });
        const twoH = attackInto(b, { attack: name, grip: "2h" });
        expect(twoH.hits.map((h) => h.damage)).toEqual(oneH.hits.map((h) => h.damage));
      });
    }
  }
  it("Ice Spear: swing is computed; projectile is unknown (no AtkParam row in the copy), so the total is unknown — never guessed", () => {
    const b = mk(hk({ str: 61, dex: 12 }), { weapon: "Banished Knight's Halberd", infusion: "Heavy", upgrade: 25, ashOfWar: "Ice Spear" });
    const r = attackInto(b, { attack: "Ice Throw" });
    expect(r.hits[0]!.damage).toBeGreaterThan(0);
    expect(r.hits[1]!.damage).toBeNull();
    expect(r.hits[1]!.unknownReason).toMatch(/no AtkParam row/);
    expect(r.total).toBeNull();
  });
  it("attack totals are the plain sum of the landed hits (Storm Blade)", () => {
    const b = mk(strB, { weapon: "Wakizashi", infusion: "Heavy", upgrade: 25, ashOfWar: "Storm Blade" });
    const r = attackInto(b, { attack: "Storm Blade - Wind Slash 1" });
    expect(r.total).toBe(r.hits.reduce((a, h) => a + h.damage!, 0));
  });
  it("unmet weapon requirements are warned about, not hidden", () => {
    const b = mk(strB, { weapon: "Banished Knight's Halberd", infusion: "Heavy", upgrade: 25 });
    expect(attackInto(b, { attack: "1h R1 1" }).hits[0]!.warnings[0]).toMatch(/requirements not met \(dex\)/);
  });
});

describe("Q13: Beast's Roar first hit id has no AtkParam row", () => {
  it("is reported unknown rather than joined to the similar-looking row 30000841", () => {
    const b = mk(hk({ dex: 57 }), { weapon: "Wakizashi", infusion: "Keen", upgrade: 25, ashOfWar: "Beast's Roar" });
    const r = attackInto(b, { attack: "Beast's Roar - Roar" });
    expect(r.hits[0]!.hit.id).toBe("300000841:5373");
    expect(r.hits[0]!.damage).toBeNull();
    expect(r.hits[1]!.damage).toBeGreaterThan(0);
  });
});

describe("frame + poise data", () => {
  it("Shamshir R1 startup and poise match frames/poise fixtures (A2: data index, display +1)", () => {
    const b = mk(hk({ str: 59 }), { weapon: "Shamshir", infusion: "Heavy", upgrade: 25 });
    const f1 = goldenFrames().cases.find((c) => c.id === "fr-sham-1h-r1")!.expected;
    const r1 = resolveAttack(data, b, { attack: "1h R1 1" }).hits[0]!;
    expect(r1.startup).toBe(f1.dataStartup);
    expect(`${r1.startup + 1}f`).toBe(f1.plannerDisplay);
    expect(r1.damageLevel).toBe(f1.damageLevel);
    const poise = Object.fromEntries(goldenPoise().cases.map((c) => [c.attack, c.expected.poiseDamage]));
    expect(r1.poiseDamage).toBe(poise["1h R1 1"]);
    expect(resolveAttack(data, b, { attack: "2h R1 1" }).hits[0]!.poiseDamage).toBe(poise["2h R1 1"]);
  });
});

describe("status buildup", () => {
  it("Blood Shamshir builds bleed per hit and reports attacks-to-proc against the defender's robustness", () => {
    const b = mk(hk({ str: 15, dex: 40, arc: 40 }), { weapon: "Shamshir", infusion: "Blood", upgrade: 25 });
    const r = attackInto(b, { attack: "1h R1 1" });
    const bleed = r.status.find((s) => s.status === "bleed")!;
    expect(bleed.buildupPerAttack).toBeGreaterThan(0);
    expect(bleed.attacksToProc).toBe(Math.ceil(bleed.resistance / bleed.buildupPerAttack));
    expect(bleed.procDamage).toBe(Math.trunc(1900 * 0.15) + 100);
  });
});
