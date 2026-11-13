// regulation.bin reader. The layout test runs everywhere; the game-file tests need the local, gitignored
// game-files/1.17.3/regulation.bin and game-files/paramdefs/ER, and are skipped when those are absent (e.g. CI).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareWithCopy, layoutOf, openRegulation, parseParamDef, readParam } from "../scripts/lib/regulation.ts";

const repo = (p: string) => new URL(`../../../${p}`, import.meta.url);
const BIN = repo("game-files/1.17.3/regulation.bin");
const DEFS = "game-files/paramdefs/ER";
const haveGameFile = existsSync(BIN) && existsSync(repo(`${DEFS}/AtkParam.xml`));

describe("paramdef layout", () => {
  it("packs bitfields by storage size, not type name", () => {
    const def = parseParamDef(`<ParamType>T</ParamType><Fields>
      <Field Def="u8 a:1" /><Field Def="u8 b:2" /><Field Def="dummy8 pad:5" /><Field Def="u8 c:1" />
      <Field Def="u16 d" /><Field Def="u16 e:3" /><Field Def="u8 f:1" /><Field Def="dummy8 pad2[3]" /></Fields>`, 1);
    const at = Object.fromEntries(layoutOf(def).fields.map((f) => [f.name, [f.offset, f.bitOffset]]));
    expect(at).toEqual({ a: [0, 0], b: [0, 1], pad: [0, 3], c: [1, 0], d: [2, 0], e: [4, 0], f: [6, 0], pad2: [7, 0] });
    expect(layoutOf(def).rowSize).toBe(10);
  });
  it("keeps only fields present in the regulation version", () => {
    const def = parseParamDef(`<ParamType>T</ParamType><Fields><Field Def="u8 old" RemovedVersion="200" />
      <Field Def="u8 new" FirstVersion="200" /><Field Def="u8 both" /></Fields>`, 300);
    expect(def.fields.map((f) => f.name)).toEqual(["new", "both"]);
  });
});

describe.skipIf(!haveGameFile)("regulation.bin 1.17.3 vs Emilia's 1.17 copies", () => {
  const bin = haveGameFile ? readFileSync(BIN) : Buffer.alloc(0);
  const params = haveGameFile ? openRegulation(bin) : new Map<string, Buffer>();
  const compare = (param: string, defFile: string) => compareWithCopy(
    readParam(params.get(param)!, parseParamDef(readFileSync(repo(`${DEFS}/${defFile}.xml`), "utf8"), 11730034)).rows,
    JSON.parse(readFileSync(repo(`packages/data/raw/emilia/1.17/${param}.json`), "utf8")));

  it("is the expected file", () => {
    expect(createHash("sha256").update(bin).digest("hex")).toBe("b8cdab84c0772f66811fdc5176a381877ca6657b37d420cc2c1562a90d63870e");
  });
  it("AtkParam_Pc: all 11,017 rows equal on every shared field", () => {
    const c = compare("AtkParam_Pc", "AtkParam");
    expect([c.rowsInGame, c.rowsInCopy, c.copyRowsMissing]).toEqual([11017, 11017, 0]);
    expect(c.fieldsCompared).toBeGreaterThanOrEqual(160);
    expect(c.mismatches).toEqual([]);
  });
  it("BehaviorParam_PC: all 13,865 rows equal", () => {
    const c = compare("BehaviorParam_PC", "BehaviorParam");
    expect([c.rowsInGame, c.rowsInCopy, c.copyRowsMissing, c.mismatches.length]).toEqual([13865, 13865, 0, 0]);
  });
  it("Bullet: all 15,475 rows equal except Piquebone Arrow's atkId (0 → 1 in 1.17.3)", () => {
    const c = compare("Bullet", "BulletParam");
    expect([c.rowsInGame, c.rowsInCopy, c.copyRowsMissing]).toEqual([15475, 15475, 0]);
    expect(c.mismatches).toEqual([{ id: 20003309, field: "atkId_Bullet", game: 1, copy: 0 }]);
  });
});
