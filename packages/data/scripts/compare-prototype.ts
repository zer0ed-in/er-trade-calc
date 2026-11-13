// Compares engine results with fixtures/golden/prototype.json (PROTOTYPE, not planner-verified). Reports; never forces.
import { existsSync, readFileSync } from "node:fs";
import { loadGameData } from "../src/index.ts";
import { computeHit, prepareFighter, resolveAttack, type Build, type Stats } from "@ertc/engine";

const data = loadGameData("1.17");
// prototype.json is a local-only kickoff file (untracked, gitignored); it is absent in fresh clones.
const protoUrl = new URL("../../../fixtures/golden/prototype.json", import.meta.url);
if (!existsSync(protoUrl)) {
  console.log("fixtures/golden/prototype.json is not present (local-only kickoff file, not in the repo). Nothing to compare.");
  process.exit(0);
}
const proto = JSON.parse(readFileSync(protoUrl, "utf8"));
const armour = { head: "Verdigris Helm", body: "Verdigris Armor", arms: "Steel Gauntlets", legs: "Verdigris Greaves" };
const hk = (s: Partial<Stats>, end = 40): Stats => ({ vig: 60, mnd: 8, end, str: 15, dex: 11, int: 7, fth: 8, arc: 9, ...s });
const b = (stats: Stats, infusion: string, buffs: string[] = []): Build => ({ class: "Heavy Knight", stats, rightHand: [{ weapon: "Shamshir", infusion, upgrade: 25 }], armour, talismans: [], buffs });
const dmg = (a: Build, d: Build) => {
  const A = prepareFighter(data, a, { scenario: "duel-start" });
  const D = prepareFighter(data, d, { scenario: "duel-start" });
  const atk = resolveAttack(data, a, { attack: "2h R1 1" });
  return computeHit(data, A, atk, atk.hits[0]!, D).damage;
};
const rows: [string, number, number | null][] = [];
const str60 = b(hk({ str: 60, dex: 13 }, 39), "Heavy"), faith53 = b(hk({ dex: 13, fth: 53 }, 39), "Sacred");
const c1 = proto.cases.find((c: any) => c.id === "proto-str60-vs-faith").expected;
rows.push(["str60 → faith53", c1.str_to_faith, dmg(str60, faith53)], ["faith53 → str60", c1.faith_to_str, dmg(faith53, str60)]);
const sb = proto.cases.find((c: any) => c.id === "proto-sacredblade").expected;
const faithSB = b(hk({ dex: 13, fth: 53 }, 39), "Sacred", ["Sacred Blade"]);
rows.push(["faith+SB → faith53", sb.into_faith_build, dmg(faithSB, faith53)], ["faith+SB → str60", sb.into_heavy_str60, dmg(faithSB, str60)], ["faith+SB → dex(18 str)", sb.into_dex_str18, dmg(faithSB, b(hk({ str: 18, dex: 55 }, 39), "Keen"))]);
const gr = proto.cases.find((c: any) => c.id === "proto-greases-heavy60-into-faith").expected;
for (const [label, name] of [["Lightning Grease +85", "Lightning Grease"], ["Drawstring Lightning +110", "Drawstring Lightning Grease"], ["Dragonbolt +120", "Dragonbolt Grease"]] as const)
  rows.push([`str60 + ${name} → faith53`, gr[label], dmg(b(hk({ str: 60, dex: 13 }, 39), "Heavy", [name]), faith53)]);
for (const [label, exp, got] of rows) console.log(`${label.padEnd(44)} prototype ${String(exp).padStart(4)}  engine ${String(got).padStart(4)}  ${exp === got ? "same" : `Δ ${(got ?? 0) - exp}`}`);
