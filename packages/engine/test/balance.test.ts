// Balance search (local branch): expander, classifier, bulk table, Mirror view, search and report on a small inline setups doc.
import { describe, expect, it } from "vitest";
import { loadLadderRuleset } from "@ertc/data";
import {
  BalanceEvaluator, balanceReport, basketFor, bulkTable, DEFAULT_BALANCE_CONFIG, expandSetups, NO_RULES, normalClass, searchBalance, validateSetupsDoc,
  type SetupsDoc,
} from "@ertc/engine";
import { data } from "./data.ts";

const doc: SetupsDoc = validateSetupsDoc({
  version: 1,
  patch: "1.17",
  defaults: {
    class: "Heavy Knight",
    armour: { head: "Divine Bird Helm", body: "Verdigris Armor", arms: "Steel Gauntlets", legs: "Verdigris Greaves" },
    talismans: [], tears: [], upgrade: { regular: 25, somber: 10 },
    requirements_rule: "skip: a setup whose one-handed requirements (2H: str x1.5) the body doesn't meet is skipped and reported, never re-statted.",
    grease_candidates: ["Drawstring Dragonbolt Grease"],
  },
  bodies: {
    str: { stats: { vig: 60, mnd: 8, end: 42, str: 55, dex: 15, int: 7, fth: 8, arc: 9 } },
    dex: { stats: { vig: 60, mnd: 8, end: 40, str: 15, dex: 57, int: 7, fth: 8, arc: 9 } },
  },
  setups: {
    str: [{ name: "shamshir", grip: "2h", main: { weapon: "Shamshir", infusions: ["Heavy", "Fire"], ashes: ["Spinning Slash"] } }],
    dex: [
      { name: "shamshir", grip: "2h", main: { weapon: "Shamshir", infusions: ["Keen"], ashes: ["Spinning Slash", "Ice Spear"] } },
      { name: "psgs-lance", grip: "powerstance", main: { weapon: "Lance", infusions: ["Keen"], ashes: [] } },
      { name: "estoc", grip: "2h", main: { weapon: "Estoc", infusions: ["Lightning"], ashes: ["Kick"] }, greases: false },
    ],
  },
});
const rules = loadLadderRuleset();
const ex = expandSetups(data, rules, doc);

describe("setup expander", () => {
  it("tries infusions × ashes × greases, greases only on Standard/Heavy/Keen and never where greases: false", () => {
    const ids = ex.variants.map((v) => v.id);
    expect(ids).toContain("str/shamshir Heavy + Spinning Slash [Drawstring Dragonbolt Grease]");
    expect(ids).toContain("str/shamshir Fire + Spinning Slash");
    expect(ids.some((i) => i.startsWith("str/shamshir Fire") && i.includes("Grease"))).toBe(false);
    expect(ids.some((i) => i.startsWith("dex/estoc") && i.includes("Grease"))).toBe(false);
  });
  it("skips combos the game doesn't allow, with the reason", () => {
    expect(ex.skipped).toContainEqual(expect.objectContaining({ where: "dex/shamshir", kind: "game", reason: expect.stringMatching(/Ice Spear doesn't allow Keen/) }));
  });
  it("applies requirements_rule skip (Lance needs str 20, the dex body has 18 with the helm)", () => {
    expect(ex.skipped).toContainEqual(expect.objectContaining({ where: "dex/psgs-lance", kind: "requirements", reason: expect.stringMatching(/Lance needs strength 20, the body has 18/) }));
  });
  it("rejects a requirements rule other than skip", () => {
    expect(() => validateSetupsDoc({ ...doc, defaults: { ...doc.defaults, requirements_rule: "raise: …" } })).toThrow(/skip/);
  });
});

describe("attack classifier", () => {
  it("classifies planner names by grip", () => {
    expect(normalClass("2h R1 3", "2h", undefined)).toBe("R1 chain");
    expect(normalClass("1h R1 3", "2h", undefined)).toBe("wrong-grip");
    expect(normalClass("2h Charged R2 1", "2h", undefined)).toBe("R2");
    expect(normalClass("2h R2 1 Release", "2h", undefined)).toBe("R2");
    expect(normalClass("Paired L1 2", "powerstance", undefined)).toBe("paired L1 chain");
    expect(normalClass("Offhand L1 1", "main+offhand", undefined)).toBe("off-hand L1 chain");
    expect(normalClass("1h Barbaric Roar R2 1 Charged", "main+offhand", undefined)).toBe("wrong-grip");
    expect(normalClass("Something New", "2h", undefined)).toBeNull();
  });
  it("ashes come from the type/labels: first FP entry = opening, its No-FP twin is kept", () => {
    const v = ex.variants.find((x) => x.id === "dex/shamshir Keen + Spinning Slash")!;
    const b = basketFor(data, v);
    const first = b.attacks.find((a) => a.class === "ash first hit")!;
    expect(first.hits).toBe("first");
    expect(first.noFp).toMatch(/No FP/);
    expect(b.attacks.some((a) => a.class === "full ash" && a.attack === first.attack)).toBe(true);
    expect(b.attacks.filter((a) => a.class === "R1 chain").every((a) => a.attack.startsWith("2h R1"))).toBe(true);
    expect(b.notSupported).toEqual([]);
  });
  it("no mounted attacks in any basket", () => {
    for (const v of ex.variants) expect(basketFor(data, v).attacks.some((a) => /Mounted/.test(a.attack))).toBe(false);
  });
});

describe("evaluator, Mirror view, search and report", () => {
  const ev = new BalanceEvaluator(data, ex.variants, { ...DEFAULT_BALANCE_CONFIG, rlMin: 115, rlMax: 130, rlStep: 5 });
  it("bulk table: every classified attack of every variant into every body; Kick damage from its game rows (A10 removed)", () => {
    const { summary, rows } = bulkTable(ev);
    expect(summary.rows).toBe(rows.length);
    expect(summary.defenders).toBe(2);
    const kick = rows.find((r) => String(r.variant).startsWith("dex/estoc") && r.attack === "Kick");
    expect(kick?.damage).toBeGreaterThan(1); // AtkParam 301100800/801 (A3 flat path), no longer the A10 placeholder of 1
  });
  it("Mirror at RL 125 compares the same setup across bodies, normal and ash separately; reference 2H R1 1 numbers hold", () => {
    const ms = ev.mirror(NO_RULES, true);
    const normal = ms.find((m) => m.view === "normal" && m.setup === "shamshir")!;
    const ash = ms.find((m) => m.view === "ash" && m.setup === "shamshir · Spinning Slash")!;
    expect(normal && ash).toBeTruthy();
    // strenuous Heavy Shamshir 2h R1 1 into dextra = 290 and dextra Keen 2h R1 1 into strenuous = 256 (planner-verified golden cases).
    const t = (side: typeof normal.a, def: typeof normal.b) => ev.table(side.variant, 125, def.variant, 125);
    const r1 = (rows: ReturnType<typeof t>) => (Array.isArray(rows) ? rows.find((r) => r.attack.attack === "2h R1 1")?.damage : undefined);
    const heavy = ex.variants.find((v) => v.id === "str/shamshir Heavy + Spinning Slash")!;
    const keen = ex.variants.find((v) => v.id === "dex/shamshir Keen + Spinning Slash")!;
    expect(r1(ev.table(heavy, 125, keen, 125))).toBe(290);
    expect(r1(ev.table(keen, 125, heavy, 125))).toBe(256);
    expect(normal.perClass.map((p) => p.cls)).toContain("R1 chain");
  });
  it("search never makes the worst matchup worse, and the report states the honesty verdict and the not-supported list", () => {
    const result = searchBalance(ev);
    expect(result.objectives.recommended).toBeLessThanOrEqual(result.objectives.reference + 1e-12);
    const report = balanceReport({ ev, doc, expansion: ex, result, bulk: bulkTable(ev).summary, date: "2026-11-13", setupsPath: "inline", tablePath: "t.json" });
    expect(report).toMatch(/## Verdict/);
    expect(report).toMatch(/No balanced set exists|balance every Mirror matchup/);
    expect(report).toMatch(/Not supported right now: FP budget/);
    expect(report).toMatch(/Data: Emilia/);
  });
});
