// `pnpm data:regulation` — extract the game tables we use from a local regulation.bin into packages/data/gen/regulation/<patch>/.
// The .bin and the paramdefs stay local (game-files/, gitignored; paramdefs are GPL-3.0 and never vendored). No network.
// Where Emilia's copy already holds a table and matches the game file, we keep her copy and only record the check here.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { compareWithCopy, openRegulation, parseParamDef, readParam, type ParamRow } from "./lib/regulation.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const PATCH = "1.17.3";
const REGULATION_VERSION = 11730034;
const EXPECTED_SHA256 = "b8cdab84c0772f66811fdc5176a381877ca6657b37d420cc2c1562a90d63870e";
const BIN = process.env.REGULATION_BIN ?? join(REPO, "game-files", PATCH, "regulation.bin");
const DEFS = process.env.PARAMDEFS ?? join(REPO, "game-files/paramdefs/ER");
const EMILIA = join(REPO, "packages/data/raw/emilia/1.17");
const OUT = join(REPO, "packages/data/gen/regulation", PATCH);

/** The only difference between Emilia's 1.17 copies and 1.17.3 on the tables we compare. */
export const KNOWN_DIFFERENCES = [{ param: "Bullet", id: 20003309, field: "atkId_Bullet", copy: 0, game: 1, note: "Piquebone Arrow" }];

const bin = readFileSync(BIN);
const sha256 = createHash("sha256").update(bin).digest("hex");
if (sha256 !== EXPECTED_SHA256) throw new Error(`regulation.bin sha256 ${sha256}, expected ${EXPECTED_SHA256}`);
const params = openRegulation(bin);

function rows(param: string, defFile: string): ParamRow[] {
  const buf = params.get(param);
  if (!buf) throw new Error(`regulation.bin has no ${param}`);
  return readParam(buf, parseParamDef(readFileSync(join(DEFS, `${defFile}.xml`), "utf8"), REGULATION_VERSION)).rows;
}
/** Emilia's row format: "Row ID" first, then fields. */
const asCopyFormat = (r: ParamRow) => { const { id, ...fields } = r; return { "Row ID": id, ...fields }; };

mkdirSync(OUT, { recursive: true });
const checks: Record<string, unknown> = {};
const written: Record<string, string> = {};

// Tables Emilia's copies already hold: compare, fail on anything but the known differences.
for (const [param, defFile] of [
  ["AtkParam_Pc", "AtkParam"], ["BehaviorParam_PC", "BehaviorParam"], ["Bullet", "BulletParam"],
  ["EquipParamWeapon", "EquipParamWeapon"], ["EquipParamAccessory", "EquipParamAccessory"], ["EquipParamGoods", "EquipParamGoods"],
  ["ToughnessParam", "ToughnessParam"], ["FinalDamageRateParam", "FinalDamageRateParam"], ["SpEffectParam", "SpEffect"],
] as const) {
  const cmp = compareWithCopy(rows(param, defFile), JSON.parse(readFileSync(join(EMILIA, `${param}.json`), "utf8")));
  const unexpected = cmp.mismatches.filter((m) => !KNOWN_DIFFERENCES.some((k) => k.param === param && k.id === m.id && k.field === m.field && k.game === m.game && k.copy === m.copy));
  if (unexpected.length || cmp.copyRowsMissing) throw new Error(`${param}: ${unexpected.length} unexpected mismatches, ${cmp.copyRowsMissing} copy rows missing: ${JSON.stringify(unexpected.slice(0, 5))}`);
  checks[param] = { copy: `raw/emilia/1.17/${param}.json`, rowsInCopy: cmp.rowsInCopy, rowsInGame: cmp.rowsInGame, fieldsCompared: cmp.fieldsCompared,
    copyFieldsWithOtherNames: cmp.copyFieldsUnmatched, mismatches: cmp.mismatches };
  console.log(`  ${param}: ${cmp.rowsInCopy} rows × ${cmp.fieldsCompared} fields vs Emilia's copy, ${cmp.mismatches.length} known difference(s)`);
}

// Full SpEffectParam: Emilia's copy holds only the rows the planner uses (e.g. the flask restore 501062 is missing).
const spEffects = rows("SpEffectParam", "SpEffect");
// Gzipped: the full table is ~95 MB as JSON, ~0.8 MB gzipped.
writeFileSync(join(OUT, "SpEffectParam.json.gz"), gzipSync(JSON.stringify(spEffects.map(asCopyFormat)) + "\n", { level: 9 }));
written["SpEffectParam.json.gz"] = `SpEffectParam, all ${spEffects.length} rows`;

// Toughness (poise) recovery: one-row params, only the fields we use.
const gameSystem = rows("GameSystemCommonParam", "GameSystemCommonParam")[0]!;
const playerCommon = rows("PlayerCommonParam", "PlayerCommonParam")[0]!;
writeFileSync(join(OUT, "toughness-recover.json"), JSON.stringify({
  baseToughnessRecoverTime: gameSystem.baseToughnessRecoverTime,
  toughnessRecoverCorrection: playerCommon.toughnessRecoverCorrection,
}, null, 1) + "\n");
written["toughness-recover.json"] = "GameSystemCommonParam.baseToughnessRecoverTime, PlayerCommonParam.toughnessRecoverCorrection";

// Skill (flat) attack rate per upgrade level: ReinforceParamWeapon's last f32 (row offset 0x7C; 1.0 at +0, 4.0 at max).
// No local paramdef for this table, so the row is read by offset. The layout is pinned by cross-checking every row the planner
// uses against Emilia's copy: offsets 0x00–0x0C/0x58 = damage rates, 0x1C–0x28/0x60 = scaling rates. Any mismatch fails.
// In-game fit (Zer0, 2026-11-14): skill flat damage = flat × this rate × (1 + scaling); see docs/09 A3.
{
  const buf = params.get("ReinforceParamWeapon");
  if (!buf) throw new Error("regulation.bin has no ReinforceParamWeapon");
  const ROW_SIZE = 128, SKILL_RATE_OFFSET = 0x7c;
  const count = buf.readUInt16LE(0x0a);
  const byId = new Map<number, Buffer>();
  for (let i = 0; i < count; i++) {
    const h = 0x40 + i * 24;
    const dataOffset = Number(buf.readBigInt64LE(h + 8));
    byId.set(buf.readInt32LE(h), buf.subarray(dataOffset, dataOffset + ROW_SIZE));
  }
  const planner = JSON.parse(readFileSync(join(REPO, "packages/data/gen/1.17/reinforcements.json"), "utf8")) as Record<string, { level: number; damage: Record<string, number>; scaling: Record<string, number> }[]>;
  const checked: [number, string, string][] = [
    [0x00, "damage", "physical"], [0x04, "damage", "magic"], [0x08, "damage", "fire"], [0x0c, "damage", "lightning"], [0x58, "damage", "holy"],
    [0x1c, "scaling", "strength"], [0x20, "scaling", "dexterity"], [0x24, "scaling", "intelligence"], [0x28, "scaling", "faith"], [0x60, "scaling", "arcane"],
  ];
  const skillRate: Record<string, number[]> = {};
  let rowsChecked = 0;
  for (const [typeId, levels] of Object.entries(planner)) {
    skillRate[typeId] = levels.map((lv) => {
      const row = byId.get(Number(typeId) + lv.level);
      if (!row) throw new Error(`ReinforceParamWeapon has no row ${Number(typeId) + lv.level}`);
      for (const [offset, group, key] of checked) {
        const game = row.readFloatLE(offset), copy = (lv as unknown as Record<string, Record<string, number>>)[group]![key]!;
        if (Math.fround(copy) !== game) throw new Error(`ReinforceParamWeapon ${Number(typeId) + lv.level} @0x${offset.toString(16)}: ${game}, planner ${group}.${key} ${copy} — layout assumption broken`);
      }
      rowsChecked++;
      return +row.readFloatLE(SKILL_RATE_OFFSET).toFixed(6);
    });
  }
  writeFileSync(join(OUT, "reinforce-skill-rate.json"), JSON.stringify(skillRate) + "\n");
  written["reinforce-skill-rate.json"] = `ReinforceParamWeapon f32 at row offset 0x7C, by reinforce type and level (${rowsChecked} rows; layout checked against the planner's damage/scaling rates)`;
}

const defsSource = (() => { try { return readFileSync(join(DEFS, "../SOURCE.txt"), "utf8").trim(); } catch { return "unknown"; } })();
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  patch: PATCH, regulationVersion: REGULATION_VERSION, sha256,
  source: "regulation.bin from TKGP's ER Regulation Archive (Nexus Mods, Elden Ring mod 4262)",
  paramdefs: defsSource,
  extractedAt: new Date().toISOString().slice(0, 10),
  files: written,
  comparedWithEmiliaCopies: checks,
  knownDifferences: KNOWN_DIFFERENCES,
}, null, 1) + "\n");
console.log(`Wrote gen/regulation/${PATCH}: ${Object.keys(written).join(", ")}, manifest.json`);
