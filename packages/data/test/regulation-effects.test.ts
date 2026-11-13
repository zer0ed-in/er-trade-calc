// Effect values checked against the full SpEffectParam extracted from regulation.bin 1.17.3 (gen/regulation, committed).
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ASSUMPTIONS } from "@ertc/engine";

const rows = JSON.parse(gunzipSync(readFileSync(new URL("../gen/regulation/1.17.3/SpEffectParam.json.gz", import.meta.url))).toString("utf8")) as Record<string, number>[];
const sp = new Map(rows.map((r) => [r["Row ID"]!, r]));
const talismans = JSON.parse(readFileSync(new URL("../gen/1.17/talismans.json", import.meta.url), "utf8")) as { name: string; effects: { attribute: string; value: number }[] }[];
const f32 = Math.fround;

describe("SpEffectParam (regulation.bin 1.17.3)", () => {
  it("A9 Lightning Slash: 1675/1677 cycle into 1676/1678 = thunderAttackPower 85 for 40 s", () => {
    expect([sp.get(1675)!.cycleOccurrenceSpEffectId, sp.get(1677)!.cycleOccurrenceSpEffectId]).toEqual([1676, 1678]);
    for (const id of [1676, 1678]) expect([sp.get(id)!.thunderAttackPower, sp.get(id)!.effectEndurance]).toEqual([ASSUMPTIONS.A9.choice.lightningFlat, ASSUMPTIONS.A9.choice.durationSeconds]);
  });
  it("Spear Talisman 320600: physicsAttackRate 1.15 on counter (stateInfo 197), as the planner table has it; SpEffect #45 thrust ×1.15 (A4 stays open)", () => {
    expect(sp.get(320600)).toMatchObject({ physicsAttackRate: f32(1.15), stateInfo: 197 });
    expect(talismans.find((t) => t.name === "Spear Talisman")!.effects[0]!.value).toBe(1.15);
    expect(sp.get(45)!.thrustDamageCutRate).toBe(f32(1.15));
  });
  it("Great-Jar's Arsenal 310320: equip load × 1.19, as the planner table has it", () => {
    expect(sp.get(310320)!.equipWeightChangeRate).toBe(f32(1.19));
    expect(talismans.find((t) => t.name === "Great-Jar's Arsenal")!.effects[0]).toMatchObject({ attribute: "Maximum Equip Load", value: 1.19 });
  });
  it("Flask of Cerulean Tears +12: SpEffect 501062 changeMpEstusFlaskPoint −220 = +220 FP", () => {
    expect(sp.get(501062)!.changeMpEstusFlaskPoint).toBe(-220);
  });
});
