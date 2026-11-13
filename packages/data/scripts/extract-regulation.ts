// `pnpm data:regulation` — extract the game tables we use from a local regulation.bin into packages/data/gen/regulation/<patch>/.
// The .bin and the paramdefs stay local (game-files/, gitignored). No network.
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
