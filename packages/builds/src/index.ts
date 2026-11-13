// Importer: Emilia's planner build export ("Export and save") → engine Build. Zod-validated, versioned (A6).
// Format read from the planner code (character object; version constant `3.14`). Field mapping notes:
//  - stats.vit is endurance; stats.rl is the planner's own RL (checked against ours, warning only)
//  - weapons: inventory.slots[].equipIndex 0–2 = right-hand slots 1–3, 3–5 = left-hand slots 1–3
//    (planner treats 0 and 3 as the primary weapons; mapping UNVERIFIED until real exports are tested — see PROGRESS.md)
//  - upgrade: one global `weaponUpgrade` (0–25); somber weapons map 25 → +10. Only 25 is in scope (+25/+10).
import { z } from "zod";
import { ASSUMPTIONS, EngineError, type Build, type WeaponSlot } from "@ertc/engine";

const Slot = z.object({ name: z.string(), equipIndex: z.number().int().nullable().optional() }).passthrough();
const SlotList = z.object({ slots: z.array(Slot) }).passthrough();
const WeaponItem = Slot.extend({ infusion: z.string().nullable().optional(), weaponArt: z.string().nullable().optional() });

export const PlannerExportSchema = z
  .object({
    version: z.string(),
    name: z.string().optional(),
    characterClass: z.union([z.string(), z.null()]),
    stats: z.object({ vig: z.number(), mnd: z.number(), vit: z.number(), str: z.number(), dex: z.number(), int: z.number(), fth: z.number(), arc: z.number(), rl: z.number().optional() }).passthrough(),
    weaponUpgrade: z.number().int(),
    is2h: z.boolean().optional(),
    inventory: z.object({ slots: z.array(WeaponItem) }).passthrough(),
    talismans: SlotList,
    protectors: z.object({ head: SlotList, body: SlotList, arms: SlotList, legs: SlotList }).passthrough(),
    items: z.object({ crystalTears: z.array(z.union([z.string(), z.object({ name: z.string() }).passthrough(), z.null()])).optional() }).passthrough().optional(),
  })
  .passthrough();
export type PlannerExport = z.infer<typeof PlannerExportSchema>;

export interface ImportResult {
  build: Build;
  warnings: string[];
  /** Whether the build was two-handing its right weapon when exported (informational; attacks choose the grip). */
  twoHandedInPlanner: boolean;
}

/** Accepts the export as parsed JSON, a JSON string, or the planner's base64 serialisation. */
export function parseExport(input: unknown): PlannerExport {
  let value = input;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("{")) value = JSON.parse(text);
    else {
      try {
        value = JSON.parse(Buffer.from(text, "base64").toString("utf8"));
      } catch {
        throw new EngineError("Build export is neither JSON nor the planner's base64 format.", "invalid-build");
      }
    }
  }
  // Some exports wrap the character: { character: {...} }.
  if (value && typeof value === "object" && "character" in value && !("stats" in value)) value = (value as { character: unknown }).character;
  const parsed = PlannerExportSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new EngineError(`Not a valid planner build export: ${issues}`, "invalid-build");
  }
  return parsed.data;
}

const equipped = (list: { slots: { name: string; equipIndex?: number | null }[] }) => list.slots.find((s) => s.equipIndex !== null && s.equipIndex !== undefined)?.name ?? null;

export function importPlannerBuild(input: unknown, somberWeapons: (name: string) => boolean): ImportResult {
  const x = parseExport(input);
  const warnings: string[] = [];
  const a6 = ASSUMPTIONS.A6.choice;
  if (!(a6.acceptedVersions as readonly string[]).includes(x.version)) {
    const msg = `Export version ${x.version} is not ${a6.acceptedVersions.join("/")}; importing anyway — check the numbers against the planner.`;
    if (a6.warnOnOtherVersions) warnings.push(msg);
  }
  if (!x.characterClass) throw new EngineError("The export has no starting class; pick one in the planner and export again.", "invalid-build");
  if (x.weaponUpgrade !== 25) {
    throw new EngineError(`Weapons must be fully upgraded (+25 / somber +10); the export uses upgrade level ${x.weaponUpgrade}.`, "illegal-upgrade");
  }

  const rightHand: (WeaponSlot | null)[] = [null, null, null];
  const leftHand: (WeaponSlot | null)[] = [null, null, null];
  for (const item of x.inventory.slots) {
    const idx = item.equipIndex;
    if (idx === null || idx === undefined || idx < 0 || idx > 5) continue;
    const slot: WeaponSlot = {
      weapon: item.name,
      infusion: item.infusion ?? "Standard",
      upgrade: somberWeapons(item.name) ? 10 : 25,
      ...(item.weaponArt ? { ashOfWar: item.weaponArt } : {}),
    };
    if (idx < 3) rightHand[idx] = slot;
    else leftHand[idx - 3] = slot;
  }
  const trim = (a: (WeaponSlot | null)[]) => {
    while (a.length && a[a.length - 1] === null) a.pop();
    return a;
  };

  const tears = (x.items?.crystalTears ?? []).map((t) => (t === null ? null : typeof t === "string" ? t : t.name)).filter((t): t is string => !!t);
  const build: Build = {
    name: x.name || undefined,
    class: x.characterClass,
    stats: { vig: x.stats.vig, mnd: x.stats.mnd, end: x.stats.vit, str: x.stats.str, dex: x.stats.dex, int: x.stats.int, fth: x.stats.fth, arc: x.stats.arc },
    rightHand: trim(rightHand),
    leftHand: trim(leftHand),
    armour: { head: equipped(x.protectors.head), body: equipped(x.protectors.body), arms: equipped(x.protectors.arms), legs: equipped(x.protectors.legs) },
    talismans: x.talismans.slots.filter((s) => s.equipIndex !== null && s.equipIndex !== undefined).sort((a, b) => a.equipIndex! - b.equipIndex!).map((s) => s.name),
    tears,
    buffs: [],
  };
  if (!build.rightHand.length && !build.leftHand?.length) warnings.push("No equipped weapons found in the export.");
  return { build, warnings, twoHandedInPlanner: x.is2h ?? false };
}

/** Builds may also be given directly in the engine's neutral form (as in fixtures/golden/damage.json). */
export const NeutralBuildSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  class: z.string(),
  stats: z.object({ vig: z.number().int(), mnd: z.number().int(), end: z.number().int(), str: z.number().int(), dex: z.number().int(), int: z.number().int(), fth: z.number().int(), arc: z.number().int() }),
  rightHand: z.array(z.object({ weapon: z.string(), infusion: z.string(), upgrade: z.number().int(), ashOfWar: z.string().optional() }).nullable()),
  leftHand: z.array(z.object({ weapon: z.string(), infusion: z.string(), upgrade: z.number().int(), ashOfWar: z.string().optional() }).nullable()).optional(),
  armour: z.object({ head: z.string().nullable().optional(), body: z.string().nullable().optional(), arms: z.string().nullable().optional(), legs: z.string().nullable().optional() }),
  talismans: z.array(z.string()).default([]),
  tears: z.array(z.string()).optional(),
  buffs: z.array(z.string()).default([]),
});

/** Load either format: planner export (has `version` + `stats.vit`) or neutral build. */
export function loadBuild(input: unknown, somberWeapons: (name: string) => boolean): ImportResult {
  const value = typeof input === "string" && input.trim().startsWith("{") ? JSON.parse(input) : input;
  if (value && typeof value === "object" && "class" in value && "rightHand" in value) {
    const parsed = NeutralBuildSchema.safeParse(value);
    if (!parsed.success) throw new EngineError(`Not a valid build: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, "invalid-build");
    return { build: parsed.data as Build, warnings: [], twoHandedInPlanner: false };
  }
  return importPlannerBuild(value, somberWeapons);
}
