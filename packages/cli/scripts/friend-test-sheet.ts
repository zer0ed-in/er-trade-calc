// Generates fixtures/golden/friend-test-sheet.md: the in-game A3 test (Zer0 hits a friend standing still, no talismans/buffs/tears)
// with the engine's predicted damage per hit, so results can be compared on the spot and dropped into golden tests.
// Usage: pnpm -s report:friend-test [friend-export.json]
//   Without a friend export, predictions use dextra_erpvp_test.json as a stand-in defender — regenerate with the real export.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { importPlannerBuild } from "@ertc/builds";
import { loadGameData } from "@ertc/data";
import { A3_WARNING, computeHit, INFUSIONS, prepareFighter, resolveAttack, type Build } from "@ertc/engine";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXPORTS = ROOT + "fixtures/builds/planner-exports/";
const data = loadGameData("1.17");
const somber = (n: string) => data.weaponMeta.get(n)?.somber ?? false;
const importFile = (path: string) => importPlannerBuild(readFileSync(path, "utf8"), somber).build;

const friendPath = process.argv[2];
const defenderBuild = importFile(friendPath ?? EXPORTS + "dextra_erpvp_test.json");
const defenderLabel = friendPath ? `friend (${basename(friendPath)})` : "STAND-IN: dextra_erpvp_test.json (no friend export yet)";
// Standing still, no talismans/buffs/tears → "base" scenario (armour only), no counter hit.
const defender = prepareFighter(data, defenderBuild, { scenario: "base" });

const attackers = {
  str: { file: "strenuous.json", infusions: ["Heavy", "Fire"] },
  dex: { file: "dextra_erpvp_test.json", infusions: ["Keen", "Lightning", "Cold"] },
} as const;

// Ash → weapon and the first full-FP skill attack (planner name). Allowed affinities come from EquipParamGem
// configurableWepAttr00–12 on the ash's real row (the one with a non-zero defaultWepAttr), read below.
const ASHES = [
  { ash: "Storm Blade", weapon: "Shamshir", attack: "Storm Blade - Wind Slash 1", projectile: "wind (physical)" },
  { ash: "Vacuum Slice", weapon: "Shamshir", attack: "Wave of Destruction - Downward Slam (Vacuum Slice), Taker's Flames - Magma Launch (Vacuum Slice), Corpse Wax Cutter - Downward Slam (Vacuum Slash), Vacuum Slice - Downward Slam", projectile: "wave (physical)" },
  { ash: "Lightning Slash", weapon: "Shamshir", attack: "Lightning Slash - Sword Slash", projectile: "stomp + bolt (lightning)" },
  { ash: "Sacred Blade", weapon: "Shamshir", attack: "Unblockable Blade - Slash (Sacred Blade), Mists of Slumber - Mist Throw (Sacred Blade), Poisonous Mist - Mist Spray (Sacred Blade), Chilling Mist - Mist Spray (Sacred Blade), Sacred Blade - Slash", projectile: "golden wave (holy)" },
  { ash: "Beast's Roar", weapon: "Wakizashi", attack: "Beast's Roar - Roar", projectile: "shockwave (physical)" },
] as const;

type GemRow = { "Row Name": string; defaultWepAttr: number } & Record<string, unknown>;
const gems = JSON.parse(readFileSync(ROOT + "packages/data/raw/emilia/1.17/EquipParamGem.json", "utf8")) as GemRow[];
function allowedInfusions(ash: string): Set<string> {
  const row = gems.find((g) => g["Row Name"] === `Ash of War: ${ash}` && g.defaultWepAttr !== 0);
  if (!row) throw new Error(`No EquipParamGem row for ${ash}`);
  return new Set(INFUSIONS.filter((_, i) => row[`configurableWepAttr${String(i).padStart(2, "0")}`] === 1));
}

// Hit ids let the in-game result be matched to the exact data row (docs/09 Q13 for Beast's Roar).
const partLabel = (kind: string, attr: string, id: string) =>
  kind === "weapon" ? `weapon swing (${attr}, ${id})` : kind === "flat" ? `own flat damage — A3 (${id})` : `swing + flat — A3 (${id})`;

const rows: string[] = [];
const skipped: string[] = [];
let n = 0;
const fmt = (d: number | null, reason?: string) => (d === null ? `unknown (${reason})` : String(d));

for (const [side, cfg] of Object.entries(attackers)) {
  const base = importFile(EXPORTS + cfg.file);
  for (const a of ASHES) {
    const allowed = allowedInfusions(a.ash);
    for (const infusion of cfg.infusions) {
      if (!allowed.has(infusion)) {
        skipped.push(`${a.ash} on ${infusion} (${side} build): not an allowed affinity for this ash`);
        continue;
      }
      const build: Build = { ...base, rightHand: [{ weapon: a.weapon, infusion, upgrade: 25, ashOfWar: a.ash }], leftHand: [], talismans: [], tears: [], buffs: [] };
      const attacker = prepareFighter(data, build, { scenario: "base" });
      for (const grip of ["1h", "2h"] as const) {
        const attack = resolveAttack(data, build, { attack: a.attack, grip });
        for (const hit of attack.hits) {
          const r = computeHit(data, attacker, attack, hit, defender);
          rows.push(`| ${++n} | ${side} RL ${attacker.rl} | ${a.weapon} ${infusion} | ${a.ash} | ${grip.toUpperCase()} | hit ${hit.index}: ${partLabel(hit.kind, hit.physAttribute, String(hit.id))} | ${fmt(r.damage, r.unknownReason)} |  |`);
        }
      }
      // Weapon buffs from the ash: a normal 1H R1 before and after the buff, to check A9 (Lightning Slash +85) and Sacred Blade +90.
      if (a.ash === "Lightning Slash" || a.ash === "Sacred Blade") {
        for (const buffed of [false, true]) {
          const f = prepareFighter(data, build, { scenario: "base", ...(buffed && { extraBuffs: [a.ash] }) });
          const attack = resolveAttack(data, build, { attack: "1h R1 1" });
          const r = computeHit(data, f, attack, attack.hits[0]!, defender);
          rows.push(`| ${++n} | ${side} RL ${f.rl} | ${a.weapon} ${infusion} | ${a.ash} | 1H | 1h R1 1, ${buffed ? `**${a.ash} buff active**${a.ash === "Lightning Slash" ? " (A9)" : ""}` : "no buff"} | ${fmt(r.damage, r.unknownReason)} |  |`);
        }
      }
    }
  }
}

const sheet = `# Friend test sheet — A3 skill projectiles (in-game)

${A3_WARNING}: this test is meant to confirm or correct it.

Generated by \`pnpm -s report:friend-test ${friendPath ? basename(friendPath) : "[friend-export.json]"}\` on patch ${data.patch}. Don't hand-edit the predictions; regenerate.

**Defender:** ${defenderLabel}. ${friendPath ? "" : "**Regenerate with the friend's planner export before the test**; these predictions are for the stand-in."}
Standing still, no talismans, buffs or tears (engine scenario \`base\`), not a counter hit.

**Attackers:** Zer0's reference builds (\`strenuous.json\` str, \`dextra_erpvp_test.json\` dex), RL 125, with the weapon, infusion and ash below.
No talismans, buffs or tears. Divine Bird Helm's +3 str / +4 dex is included (it's armour).

**Record per hit:** ash, infusion, 1H/2H, which part landed (weapon swing or projectile), damage shown in-game. Fill the *in-game* column.
Ash hits never get the 2H strength bonus in-game (Zer0's tests); the 2H rows check that.

Status: list proposed by the planning session; **Zer0 confirms before the test.**

Projectile per ash: ${ASHES.map((a) => `${a.ash} = ${a.projectile}`).join("; ")}. A hit with its own flat damage is the projectile/stomp/bolt part.

| # | attacker | weapon | ash | grip | hit | predicted | in-game |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

Not tested (not allowed by the ash, EquipParamGem):
${skipped.map((s) => `- ${s}`).join("\n")}

Notes:
- Beast's Roar hit 1 is "unknown": the planner's hit id 300000841 has no AtkParam row in our copy (docs/09 Q13). The in-game number
  for it decides whether AtkParam 30000841 ("[AOW] Beast's Roar", atkPhys 110) is the same row.
- After the test, each recorded hit becomes a golden case (status "in-game"), and A3 is marked confirmed or corrected in docs/09.
`;

writeFileSync(ROOT + "fixtures/golden/friend-test-sheet.md", sheet);
console.log(`wrote fixtures/golden/friend-test-sheet.md (${n} rows, defender: ${defenderLabel})`);
