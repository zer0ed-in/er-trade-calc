// Planner hit ids → AtkParam_Pc rows via BehaviorParam_PC / Bullet (docs/09 Q11).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hitResolver } from "../scripts/lib/hit-resolution.ts";

const raw = (f: string) => JSON.parse(readFileSync(new URL(`../raw/emilia/1.17/${f}`, import.meta.url), "utf8"));
const resolver = hitResolver(raw("AtkParam_Pc.json"), raw("BehaviorParam_PC.json"), raw("Bullet.json"));
const movesets = JSON.parse(readFileSync(new URL("../gen/1.17/movesets.json", import.meta.url), "utf8")) as Record<string, { hitIds: string[]; source?: string }[]>;
const resolved = (id: number) => { const r = resolver.resolve(id); if ("unresolved" in r) throw new Error(r.unresolved); return r; };

describe("hit resolution", () => {
  it("Ice Spear: behavior 300000075 → Bullet 2490 → AtkParam 300200075", () => {
    const r = resolved(300000075);
    expect([r.via, r.bulletId, r.atkParamId]).toEqual(["bullet", 2490, 300200075]);
    expect(r.row).toMatchObject({ atkMag: 230, overwriteAttackElementCorrectId: 51100, isAddBaseAtk: 1, isDisableBothHandsAtkBonus: 1, atkSuperArmor: 25, dmgLevel: 3 });
  });
  it("Beast's Roar hit 1: behavior 300000841 → Bullet 2800 → AtkParam 30000841; HitBulletID 2801 → 30000842", () => {
    const r = resolved(300000841);
    expect([r.via, r.bulletId, r.atkParamId]).toEqual(["bullet", 2800, 30000841]);
    expect(r.row).toMatchObject({ atkPhys: 110, overwriteAttackElementCorrectId: 51020, atkSuperArmor: 6, dmgLevel: 5 });
    const bullet2800 = (raw("Bullet.json") as Record<string, number>[]).find((b) => b["Row ID"] === 2800)!;
    expect(bullet2800.HitBulletID).toBe(2801);
    expect(resolved(30000842)).toMatchObject({ via: "atk", atkParamId: 30000842 });
  });
  it("Lance 2H R1: behavior 101708200 → AtkParam 1708200", () => {
    expect(resolved(101708200)).toMatchObject({ via: "behavior", atkParamId: 1708200 });
  });
  it("shared extra behaviors 500000000–500000008 → AtkParam 1703001–1703009", () => {
    for (let i = 0; i <= 8; i++) expect(resolved(500000000 + i).atkParamId).toBe(1703001 + i);
  });
  it("every planner hit id resolves, except Taker's Flames 300314902 (its behavior points to no bullet)", () => {
    const ids = new Set<number>();
    for (const list of Object.values(movesets)) for (const e of list) if (!e.source) for (const h of e.hitIds) ids.add(Number(h.split(":")[0]));
    expect(ids.size).toBe(9894);
    const unresolved = [...ids].filter((id) => "unresolved" in resolver.resolve(id));
    expect(unresolved).toEqual([300314902]);
  });
});
