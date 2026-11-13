// gen/1.17/ash-compat.json is generated (data:build) from the committed raw files; it must rebuild byte-for-byte.
// The first build was checked identical to a reference file built separately (2026-11-13).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAshCompat, extractPlannerAshes } from "../scripts/lib/ash-compat.ts";

const raw = (f: string) => readFileSync(new URL(`../raw/emilia/1.17/${f}`, import.meta.url), "utf8");
const gen = (f: string) => readFileSync(new URL(`../gen/1.17/${f}`, import.meta.url), "utf8");

describe("ash-compat.json", () => {
  const ashes = extractPlannerAshes(raw("notifications-BNvikVlY.js"));
  it("reads all 116 ashes, including ones the planner stores by variable reference (Gravitas)", () => {
    expect(Object.keys(ashes)).toHaveLength(116);
    expect(ashes.Gravitas!.armament_categories.length).toBeGreaterThan(0);
  });
  it("rebuilds the committed file exactly", () => {
    const built = buildAshCompat(JSON.parse(raw("armaments.json")), ashes, JSON.parse(raw("SwordArtsParam.json")), JSON.parse(gen("weapon-arts.json")), "1.17");
    expect(built).toBe(gen("ash-compat.json"));
  });
  it("applies the planner rule: class, DLC exclusion pairs, infusion on both ash and weapon", () => {
    const doc = JSON.parse(gen("ash-compat.json"));
    expect(doc.weapons.Shamshir.ashes["Spinning Slash"]).toContain("Keen");
    expect(doc.weapons.Shamshir.ashes["Ice Spear"]).toBeUndefined(); // Curved Sword isn't an Ice Spear class
    expect(doc.weapons.Cinquedea.somber).toBe(true);
    expect(doc.weapons.Cinquedea.ashes).toEqual({});
  });
});
