import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importPlannerBuild, loadBuild } from "@ertc/builds";
import { loadGameData, loadLadderRuleset } from "@ertc/data";

const data = loadGameData("1.17");
const somber = (n: string) => data.weaponMeta.get(n)?.somber ?? false;
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const golden = JSON.parse(readFileSync(ROOT + "fixtures/golden/damage.json", "utf8")).builds;

// Synthetic export in the planner's character shape (default character from the planner code), filled with the dex test build.
const slots = (name: string) => ({ slots: [{ name: "Iron Helmet" }, { name, equipIndex: 1 }], sorting: { direction: "asc", method: "acquisition" } });
const dexExport = (over: Record<string, unknown> = {}) => ({
  version: "3.14",
  name: "dex-shamshir-125",
  characterClass: "Heavy Knight",
  stats: { vig: 60, mnd: 8, vit: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9, rl: 125 },
  weaponUpgrade: 25,
  is2h: false,
  inventory: { slots: [{ name: "Dagger" }, { name: "Shamshir", infusion: "Keen", weaponArt: null, equipIndex: 0 }], sorting: {} },
  talismans: { slots: [], sorting: {} },
  protectors: { head: slots("Verdigris Helm"), body: slots("Verdigris Armor"), arms: slots("Verdigris Gauntlets"), legs: slots("Verdigris Greaves") },
  items: { crystalTears: [null, null], flasks: { crimson: 10, cerulean: 4, total: 14, level: 12 } },
  ...over,
});

describe("planner export importer", () => {
  it("maps a 3.14 export onto the neutral golden build", () => {
    const { build, warnings } = importPlannerBuild(dexExport(), somber);
    const g = golden["dex-shamshir-125"];
    expect(warnings).toEqual([]);
    expect(build.class).toBe(g.class);
    expect(build.stats).toEqual(g.stats);
    expect(build.rightHand).toEqual(g.rightHand);
    expect(build.armour).toEqual(g.armour);
    expect(build.talismans).toEqual([]);
  });
  it("accepts the base64 serialisation and a { character } wrapper", () => {
    const b64 = Buffer.from(JSON.stringify(dexExport())).toString("base64");
    expect(importPlannerBuild(b64, somber).build.stats.dex).toBe(57);
    expect(importPlannerBuild({ character: dexExport() }, somber).build.stats.dex).toBe(57);
  });
  it("warns on other versions (A6) but imports", () => {
    expect(importPlannerBuild(dexExport({ version: "3.12" }), somber).warnings[0]).toMatch(/3\.12/);
  });
  it("rejects partial upgrades and missing class with clear errors", () => {
    expect(() => importPlannerBuild(dexExport({ weaponUpgrade: 24 }), somber)).toThrow(/fully upgraded/);
    expect(() => importPlannerBuild(dexExport({ characterClass: null }), somber)).toThrow(/no starting class/);
    expect(() => importPlannerBuild({ hello: 1 }, somber)).toThrow(/Not a valid planner build export/);
  });
  it("somber weapons import at +10; left hand uses equipIndex 3–5", () => {
    const x = dexExport({ inventory: { slots: [{ name: "Dragon King's Cragblade", equipIndex: 0 }, { name: "Shamshir", infusion: "Keen", equipIndex: 3 }] } });
    const { build } = importPlannerBuild(x, somber);
    expect(build.rightHand[0]).toEqual({ weapon: "Dragon King's Cragblade", infusion: "Standard", upgrade: 10 });
    expect(build.leftHand![0]!.weapon).toBe("Shamshir");
  });
  it("loadBuild also accepts the neutral build form", () => {
    expect(loadBuild(golden["str-shamshir-125"], somber).build.stats.str).toBe(59);
  });
});

// Zer0's real planner exports (fixtures/builds/planner-exports/). They carry the planner's own `computed` values,
// which the importer + engine must reproduce.
import { apiLegal, baseMaxFp, prepareFighter, resistances } from "@ertc/engine";

describe("Zer0's planner exports", () => {
  const EXPORTS = ROOT + "fixtures/builds/planner-exports/";
  const load = (f: string) => {
    const text = readFileSync(EXPORTS + f, "utf8");
    return { ...importPlannerBuild(text, somber), computed: JSON.parse(text).computed };
  };
  const verdigrisDivine = { head: "Divine Bird Helm", body: "Verdigris Armor", arms: "Steel Gauntlets", legs: "Verdigris Greaves" };

  it("dextra_erpvp_test.json imports: Keen Shamshir (Spinning Slash) in right slot 1, nothing else equipped", () => {
    const { build, warnings } = load("dextra_erpvp_test.json");
    expect(warnings).toEqual([]);
    expect(build.class).toBe("Heavy Knight");
    expect(build.stats).toEqual({ vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 });
    expect(build.rightHand).toEqual([{ weapon: "Shamshir", infusion: "Keen", upgrade: 25, ashOfWar: "Spinning Slash" }]);
    expect(build.leftHand).toEqual([]);
    expect(build.armour).toEqual(verdigrisDivine);
    // The inventory holds 70 talismans (incl. banned Shard of Alexander) and banned tools (Rune Arc, Crimson Tears),
    // none equipped: only equipped items are imported.
    expect(build.talismans).toEqual([]);
    expect(build.tears).toEqual([]);
  });
  it("dextra_erpvp_test.json is ladder-legal: banned items in the inventory but not equipped don't count", () => {
    const { build } = load("dextra_erpvp_test.json");
    const r = apiLegal({ data, ruleset: loadLadderRuleset() }, build, "duel-start");
    expect(r.violations).toEqual([]);
    expect(r.legal).toBe(true);
  });
  it("strenuous.json imports", () => {
    const { build } = load("strenuous.json");
    expect(build.stats).toEqual({ vig: 60, mnd: 8, end: 42, str: 55, dex: 15, int: 7, fth: 8, arc: 9 });
    expect(build.rightHand).toEqual([{ weapon: "Shamshir", infusion: "Heavy", upgrade: 25, ashOfWar: "Spinning Slash" }]);
    expect(build.leftHand).toEqual([]);
    expect(build.armour).toEqual(verdigrisDivine);
  });

  for (const f of ["dextra_erpvp_test.json", "strenuous.json"]) {
    it(`${f}: engine reproduces the planner's computed values`, () => {
      const { build, computed: c } = load(f);
      const fi = prepareFighter(data, build, { scenario: "duel-start" });
      expect(fi.rl).toBe(125);
      expect({ str: fi.stats.str, dex: fi.stats.dex }).toEqual(c.stats); // Divine Bird Helm +3 str / +4 dex
      expect(fi.maxHp).toBe(c.maxHealth);
      expect(baseMaxFp(data, fi.stats)).toBe(c.maxFP);
      expect(fi.equipLoad.max).toBeCloseTo(c.maxEquipLoad, 6);
      expect(fi.poise.total).toBe(c.poise.original);
      const neg = (t: keyof typeof fi.cutRates) => 100 * (1 - fi.cutRates[t]);
      for (const [k, t] of [["physical", "standard"], ["slash", "slash"], ["pierce", "pierce"], ["strike", "strike"], ["magic", "magic"], ["fire", "fire"], ["lightning", "lightning"], ["holy", "holy"]] as const) {
        expect(neg(t), k).toBeCloseTo(c.absorption[k], 6);
      }
      for (const t of ["physical", "magic", "fire", "lightning", "holy"] as const) expect(fi.defence.total[t], t).toBe(c.defenses[t]);
      const r = resistances(data, fi.stats, fi.armour).values;
      expect({ immunity: r.immunity, robustness: r.robustness, vitality: r.vitality }).toEqual({ immunity: c.resistances.immunity, robustness: c.resistances.robustness, vitality: c.resistances.vitality });
    });
    // Q14 (resolved): the planner shows focus 125 because it divides the Divine Bird Helm's "Focus −45" by its tick_interval 0.5 (→ −90).
    // In-game the helm lowers Focus by 43 (Zer0, RL 138 66-dex/19-str build: 275 → 232). The engine applies the item's own −45,
    // so it sits exactly 45 above the planner's value.
    it(`${f}: focus applies the helm's own −45, not the planner's −90`, () => {
      const { build, computed: c } = load(f);
      const fi = prepareFighter(data, build, { scenario: "duel-start" });
      const r = resistances(data, fi.stats, fi.armour, fi.effects);
      expect(r.values.focus - c.resistances.focus).toBe(45);
      expect(r.effectSources).toEqual(["Divine Bird Helm: Focus -45"]);
    });
  }
});

describe("Divine Bird Helm focus vs in-game (docs/09 Q14)", () => {
  // The effect is −45, but the helm's +3 str / +4 dex raise Σ stats, and the focus level graph (114) adds ~2 back:
  // the net drop matches the in-game 43 (measured on a different build, so this is a consistency check, not a golden).
  it("helm: effect −45, net focus drop 43 = in-game", () => {
    const base = { class: "Heavy Knight", stats: { vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 }, rightHand: [], talismans: [], buffs: [] };
    const focus = (head: string | null) => {
      const fi = prepareFighter(data, { ...base, armour: { head, body: null, arms: null, legs: null } }, { scenario: "base" });
      return resistances(data, fi.stats, fi.armour, fi.effects).values.focus;
    };
    const IN_GAME_DROP = 43; // Zer0's in-game test, 275 → 232
    const engineDrop = focus(null) - focus("Divine Bird Helm");
    expect(engineDrop).toBe(IN_GAME_DROP);
  });
});
