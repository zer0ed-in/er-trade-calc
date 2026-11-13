// `pnpm data:build` — rebuild packages/data/gen/<patch>/ from the committed raw files. No network.
// Every output table records the raw file it came from (gen/<patch>/sources.json).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { buildAshCompat, extractPlannerAshes } from "./lib/ash-compat.ts";
import { evalDefaultExportModule, extractAssignedLiteral, extractLiteralContaining, identFromUsage } from "./lib/js-literal.ts";

const PATCH = process.env.GAME_PATCH ?? "1.17";
const DATA_ROOT = fileURLToPath(new URL("../", import.meta.url));
const RAW = join(DATA_ROOT, "raw/emilia", PATCH);
const TOM_CLARK_RAW = join(DATA_ROOT, "raw/tom-clark", `v${PATCH}`, `regulation-vanilla-v${PATCH}.js`);
const OUT = join(DATA_ROOT, "gen", PATCH);

interface ManifestFile { url: string; file: string; sha256: string; gzipped: boolean }
const manifest = JSON.parse(readFileSync(join(RAW, "manifest.json"), "utf8")) as { files: ManifestFile[] };

/** Raw file by logical name (e.g. "notifications" matches notifications-BNvikVlY.js), checksum-verified. */
function readRaw(prefixOrName: string): { text: string; file: string } {
  const entry = manifest.files.find((f) => f.file === prefixOrName || f.file.replace(/\.gz$/, "") === prefixOrName) ??
    manifest.files.find((f) => new RegExp(`^${prefixOrName}-[\\w-]{8}\\.js(\\.gz)?$`).test(f.file));
  if (!entry) throw new Error(`Raw file not in manifest: ${prefixOrName}`);
  const stored = readFileSync(join(RAW, entry.file));
  const body = entry.gzipped ? gunzipSync(stored) : stored;
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.file} — raw files must never be hand-edited`);
  return { text: body.toString("utf8"), file: entry.file };
}

const sources: Record<string, string> = {};
function write(name: string, value: unknown, source: string) {
  writeFileSync(join(OUT, name), JSON.stringify(value) + "\n");
  sources[name] = source;
  console.log(`  ${name}  ← ${source}`);
}

mkdirSync(OUT, { recursive: true });
console.log(`Building gen/${PATCH}`);

// ---- Tom Clark regulation (weapon AR) ----------------------------------------------------------
write("tc-regulation.json", JSON.parse(readFileSync(TOM_CLARK_RAW, "utf8")), `tom-clark/v${PATCH}/regulation-vanilla-v${PATCH}.js (MIT)`);

// ---- Planner data-only chunks ---------------------------------------------------------------------
for (const [prefix, out] of [
  ["correction-attack", "correction-attack.json"],
  ["reinforcements", "reinforcements.json"],
  ["poise-breakpoints", "poise-breakpoints.json"],
] as const) {
  const raw = readRaw(prefix);
  write(out, evalDefaultExportModule(raw.text), raw.file);
}

// ---- Planner main bundle: literals located by stable data keys / usage patterns --------------------
const bundle = readRaw("notifications");
const fromBundle = (needle: string) => extractLiteralContaining(bundle.text, needle).value;

// Full CalcCorrectGraph rows (stage maxima + exponents). Defence, HP and skill curves read these.
write("calc-correct-graphs.json", fromBundle('{"Row ID":0,"Row Name":`Default`,stageMaxVal0'), `${bundle.file} (CalcCorrectGraph table)`);

type PlannerClass = { label: string; stats: Record<"rl" | "vig" | "mnd" | "vit" | "str" | "dex" | "int" | "fth" | "arc", number> };
const plannerClasses = fromBundle("label:`Heavy Knight`") as PlannerClass[];
write(
  "classes.json",
  plannerClasses.map(({ label, stats }) => ({
    name: label,
    level: stats.rl,
    base: { vig: stats.vig, mnd: stats.mnd, end: stats.vit, str: stats.str, dex: stats.dex, int: stats.int, fth: stats.fth, arc: stats.arc },
  })),
  `${bundle.file} (starting classes)`,
);

const tableIdent = (re: RegExp) => extractAssignedLiteral(bundle.text, identFromUsage(bundle.text, re)) as number[];
write(
  "stat-tables.json",
  {
    maxEquipLoadByEndurance: tableIdent(/([\w$]+)\[this\.finalStats\.value\.vit\|0\];return\{curren/),
    maxFpByMind: tableIdent(/let e=([\w$]+)\[this\.finalStats\.value\.mnd\|0\]/),
    maxStaminaByEndurance: tableIdent(/let e=([\w$]+)\[this\.finalStats\.value\.vit\|0\];return\{currentMaxStamina/),
  },
  `${bundle.file} (calculateEquipLoad / calculateMaxFP / calculateMaxStamina tables)`,
);

type PlannerEffect = Record<string, unknown>;
const pickEffects = (rec: Record<string, { id: number; name: string; weight?: number; category?: string; effects?: PlannerEffect[]; conflicts?: string[]; requirements?: unknown }>) =>
  Object.values(rec).map(({ id, name, weight, category, effects, conflicts, requirements }) => ({
    id, name, ...(weight !== undefined && { weight }), ...(category && { category }), effects: effects ?? [], ...(conflicts && { conflicts }), ...(requirements !== undefined && { requirements }),
  }));

write("talismans.json", pickEffects(fromBundle('"Ritual Sword Talisman":{full_hex_id') as never), `${bundle.file} (talismans)`);
write("goods.json", pickEffects(fromBundle('"Opaline Hardtear":{full_hex_id') as never), `${bundle.file} (tools/goods incl. greases, crystal tears)`);

type PlannerProtector = { id: number; name: string; category: string; weight: number; absorptions: Record<string, number>; resistances: { immunity: number; robustness: number; focus: number; vitality: number; poise: number }; effects?: PlannerEffect[] };
const plannerProtectors = fromBundle('"Verdigris Helm":{full_hex_id') as Record<string, PlannerProtector>;

type PlannerArt = Record<string, unknown> & { "Row ID": number; "Row Name": string; types?: string[]; effects?: PlannerEffect[] };
const plannerArts = fromBundle('"Sacred Blade":{"Row ID":201') as Record<string, PlannerArt>;
const weaponArts = Object.values(plannerArts).map((a) => ({
    id: a["Row ID"],
    name: a["Row Name"],
    types: a.types ?? [],
    effects: a.effects ?? [],
    fpCost: { L1: a.useMagicPoint_L1, L2: a.useMagicPoint_L2, R1: a.useMagicPoint_R1, R2: a.useMagicPoint_R2 },
  }));
write("weapon-arts.json", weaponArts, `${bundle.file} (weapon arts / SwordArtsParam + planner effects)`);

let ashCompatText = "";
// Ash-of-war compatibility (planner rule Nc/Pc). Pretty-printed and byte-stable: people read and diff this file.
{
  const armaments = readRaw("armaments.json");
  const swordArts = readRaw("SwordArtsParam.json");
  ashCompatText = buildAshCompat(JSON.parse(armaments.text), extractPlannerAshes(bundle.text), JSON.parse(swordArts.text), weaponArts as never, PATCH);
  writeFileSync(join(OUT, "ash-compat.json"), ashCompatText);
  sources["ash-compat.json"] = `${bundle.file} (ash table) + ${armaments.file} + ${swordArts.file}`;
  console.log(`  ash-compat.json  ← ${sources["ash-compat.json"]}`);
}

// Counter-hit / environment pseudo-effects as the planner models them — reference only (see docs/09 Q10).
write("planner-condition-effects.json", fromBundle("counterhit:{effects:[{attribute:`Pierce Absorption`"), `${bundle.file} (condition effects; reference)`);

// ---- Planner rulesets chunk ---------------------------------------------------------------------
{
  const raw = readRaw("rulesets");
  const src = raw.text.replace(/export\s*\{[^}]*\}\s*;?\s*$/, "");
  const ident = raw.text.match(/export\s*\{\s*([\w$]+)\s+as\s+Rulesets\s*\}/)?.[1];
  if (!ident) throw new Error("rulesets chunk: no `Rulesets` export");
  write("planner-rulesets.json", evalDefaultExportModule(`${src};export{${ident} as default};`), raw.file);
}

// ---- Frame Data Explorer params -----------------------------------------------------------------
const params = <T>(name: string) => {
  const raw = readRaw(name);
  return { rows: JSON.parse(raw.text) as T, file: raw.file };
};

// Armour: absorption/poise/weight straight from EquipParamProtector; planner `effects` joined by name.
{
  type ProtectorRow = Record<string, number | string> & { "Row ID": number; "Row Name": string };
  const { rows, file } = params<ProtectorRow[]>("EquipParamProtector.json");
  const slotByModelCategory: Record<number, string> = { 5: "head", 2: "body", 1: "arms", 6: "legs" };
  const armour = rows
    .filter((r) => r["Row Name"] && slotByModelCategory[r.equipModelCategory as number])
    .map((r) => ({
      id: r["Row ID"],
      name: r["Row Name"],
      slot: slotByModelCategory[r.equipModelCategory as number],
      weight: r.weight,
      // Cut rates are damage multipliers per piece (0.928 = 7.2% negation). Param names: neutral=standard, blow=strike, thrust=pierce, thunder=lightning, dark=holy.
      cutRate: {
        standard: r.neutralDamageCutRate, slash: r.slashDamageCutRate, strike: r.blowDamageCutRate, pierce: r.thrustDamageCutRate,
        magic: r.magicDamageCutRate, fire: r.fireDamageCutRate, lightning: r.thunderDamageCutRate, holy: r.darkDamageCutRate,
      },
      // toughnessCorrectRate × 1000 = displayed poise (Verdigris Helm 0.015 → 15, matching the planner).
      poise: Math.round((r.toughnessCorrectRate as number) * 1000 * 1000) / 1000,
      effects: plannerProtectors[r["Row Name"]]?.effects ?? [],
      // Status resistances as the planner shows them (immunity/robustness/focus/vitality); null when the planner has no entry.
      resistances: (() => {
        const pr = plannerProtectors[r["Row Name"]]?.resistances;
        return pr ? { immunity: pr.immunity, robustness: pr.robustness, focus: pr.focus, vitality: pr.vitality } : null;
      })(),
    }));
  write("armour.json", armour, `${file} (+ planner effects from ${bundle.file})`);
}

{
  type ArmamentRow = { id: number; name: string; category: string; weight: number; is_buffable: boolean; allow_ash_of_war: boolean; attack_attributes: string[]; requirements: Record<string, number>; default_skill_id: number; upgrade_material: string };
  const { rows, file } = params<Record<string, ArmamentRow>>("armaments.json");
  write(
    "weapons.json",
    Object.values(rows).map((w) => ({
      id: w.id, name: w.name, category: w.category, weight: w.weight, isBuffable: w.is_buffable, allowAshOfWar: w.allow_ash_of_war,
      attackAttributes: w.attack_attributes, requirements: w.requirements, defaultSkillId: w.default_skill_id,
      somber: /somber/i.test(w.upgrade_material),
    })),
    file,
  );
}

// SpEffects actually used by the engine (counter frames #45). Kept as full rows.
{
  const { rows, file } = params<Record<string, unknown>[]>("SpEffectParam.json");
  const wanted = new Set([45]);
  write("speffects.json", rows.filter((r) => wanted.has(r["Row ID"] as number)), file);
}

// ---- Attacks: planner names → hit rows, joined with AtkParam flags and animation frame data -------
{
  const plannerAttacksRaw = readRaw("attacks");
  const { weapons: movesets, attacks: hitRows } = (() => {
    const src = plannerAttacksRaw.text;
    const exportBlock = src.match(/export\s*\{([^}]*)\}\s*;?\s*$/)![1]!;
    const identFor = (name: string) => exportBlock.split(",").map((s) => s.trim().split(/\s+as\s+/)).find(([, as]) => as === name)?.[0];
    const w = identFor("weapons"), a = identFor("attacks");
    if (!w || !a) throw new Error("attacks chunk: expected `weapons` and `attacks` exports");
    const body = src.slice(0, src.lastIndexOf("export"));
    const pick = (ident: string) => evalDefaultExportModule(`${body};export{${ident} as default};`);
    return { weapons: pick(w) as Record<string, Record<string, PlannerAttack>>, attacks: pick(a) as Record<string, Record<string, unknown>> };
  })();
  type PlannerAttack = { filename: string; attacks: string[]; type: string; categories: string[]; ha?: Record<string, number | boolean> };

  const atkParam = params<Record<string, number | string>[]>("AtkParam_Pc.json");
  const atkFlags = new Map(atkParam.rows.map((r) => [r["Row ID"] as number, r]));

  const usedHitIds = new Set<string>();
  const usedFiles = new Set<string>();
  const movesetsOut: Record<string, { name: string; filename: string; hitIds: string[]; type: string; categories: string[]; ha?: unknown }[]> = {};
  for (const [weaponName, attacks] of Object.entries(movesets)) {
    const list = Object.entries(attacks)
      .filter(([, a]) => a.attacks.length > 0)
      .map(([name, a]) => {
        a.attacks.forEach((id) => usedHitIds.add(id));
        usedFiles.add(a.filename);
        return { name, filename: a.filename, hitIds: a.attacks, type: a.type, categories: a.categories, ...(a.ha && { ha: a.ha }) };
      });
    if (list.length) movesetsOut[weaponName] = list;
  }

  // Second source for ash attacks: FDE's animations list each animation's weapon users and hit rows. Used only for a
  // (weapon, ash) pair the game allows (ash-compat) but the planner table lacks, and only animations that name the weapon
  // as a user — never another class's animation (DLC weapons have their own sections). Pairs with no hit rows stay missing.
  {
    type FdeAnimation = { name: string; filename: string; labels: string[]; categories: string[]; users: { name: string; type: string }[]; attacks: string[] | null };
    const fde = params<Record<string, FdeAnimation>>("animations.json").rows;
    const byWeaponAndAsh = new Map<string, FdeAnimation[]>();
    for (const anim of Object.values(fde)) {
      if (!anim.labels.includes("WeaponSkill") || !anim.attacks?.length) continue;
      for (const user of anim.users) {
        if (user.type !== "Weapon") continue;
        for (const ash of anim.categories) {
          const key = `${user.name}\u0000${ash}`;
          byWeaponAndAsh.set(key, [...(byWeaponAndAsh.get(key) ?? []), anim]);
        }
      }
    }
    const compat = JSON.parse(ashCompatText) as { weapons: Record<string, { ashes: Record<string, string[]> }> };
    let added = 0;
    for (const [weaponName, entry] of Object.entries(compat.weapons)) {
      const existing = movesetsOut[weaponName] ?? [];
      const plannerAshes = new Set(existing.filter((a) => a.type === "WeaponSkill").map((a) => a.categories[0]));
      for (const ash of Object.keys(entry.ashes)) {
        if (plannerAshes.has(ash)) continue;
        const anims = (byWeaponAndAsh.get(`${weaponName}\u0000${ash}`) ?? []).filter((a) => a.attacks!.every((id) => id in hitRows));
        for (const anim of anims) {
          anim.attacks!.forEach((id) => usedHitIds.add(id));
          usedFiles.add(anim.filename);
          existing.push({ name: anim.name, filename: anim.filename, hitIds: anim.attacks!, type: "WeaponSkill", categories: [ash], source: "fde-animation-users" } as never);
          added++;
        }
      }
      if (existing.length) movesetsOut[weaponName] = existing;
    }
    console.log(`  note: ${added} ash attack entries added from FDE animation users (pairs missing from the planner table)`);
  }
  write("movesets.json", movesetsOut, `${plannerAttacksRaw.file} + animations.json (FDE users, for ash pairs the planner lacks)`);

  const rowsOut: Record<string, unknown> = {};
  const missingAtkParam: number[] = [];
  for (const hitId of usedHitIds) {
    const row = hitRows[hitId];
    if (!row) throw new Error(`Planner attack row missing for ${hitId}`);
    const atkParamId = Number(hitId.split(":")[0]);
    const flags = atkFlags.get(atkParamId);
    if (!flags) missingAtkParam.push(atkParamId);
    rowsOut[hitId] = {
      ...row,
      atkParam: flags
        ? {
            id: atkParamId,
            isAddBaseAtk: flags.isAddBaseAtk,
            overwriteAttackElementCorrectId: flags.overwriteAttackElementCorrectId,
            isDisableBothHandsAtkBonus: flags.isDisableBothHandsAtkBonus,
            finalDamageRateId: flags.finalDamageRateId,
            atkAttribute: flags.atkAttribute,
          }
        : null,
    };
  }
  write("hits.json", rowsOut, `${plannerAttacksRaw.file} + ${atkParam.file}`);
  if (missingAtkParam.length) console.warn(`  note: ${missingAtkParam.length} hit rows have no AtkParam_Pc row (atkParam: null)`);

  const anims = params<Record<string, { name: string; labels?: string[]; events?: Record<string, unknown> }>>("animations.json");
  const animOut: Record<string, unknown> = {};
  for (const file of usedFiles) {
    const a = anims.rows[file];
    if (!a) continue;
    const e = a.events ?? {};
    // Frames as listed (A1: already speed-adjusted). `gradients` deliberately dropped so nothing can re-apply them.
    animOut[file] = { name: a.name, labels: a.labels ?? [], activeFrames: e.activeFrames ?? [], hyperArmour: e.hyperArmour ?? [], spEffects: e.spEffects ?? [], iframes: e.iframes ?? [], canBeParried: e.canBeParried ?? [] };
  }
  write("animations.json", animOut, anims.file);
}

writeFileSync(join(OUT, "sources.json"), JSON.stringify({ patch: PATCH, builtFrom: sources }, null, 1) + "\n");
console.log("done");
