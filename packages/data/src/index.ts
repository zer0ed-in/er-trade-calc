// The only runtime file reader for game data. Loads packages/data/gen/<patch>/ (committed, built by `pnpm data:build`).
// Never fetches anything: Emilia's files were copied once (docs/05).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexGameData, type GameData, type LadderRuleset, type RawGameData } from "@ertc/engine";

const GEN_ROOT = fileURLToPath(new URL("../gen/", import.meta.url));

export const DEFAULT_PATCH = process.env.GAME_PATCH ?? "1.17";

const cache = new Map<string, GameData>();

export function loadRawGameData(patch = DEFAULT_PATCH): RawGameData {
  const dir = join(GEN_ROOT, patch);
  const read = <T>(name: string): T => {
    try {
      return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
    } catch (e) {
      throw new Error(`Cannot load ${name} for patch ${patch} from ${dir} (run \`pnpm data:build\`): ${(e as Error).message}`);
    }
  };
  return {
    patch,
    tcRegulation: read("tc-regulation.json"),
    calcCorrectGraphs: read("calc-correct-graphs.json"),
    classes: read("classes.json"),
    statTables: read("stat-tables.json"),
    correctionAttack: read("correction-attack.json"),
    reinforcements: read("reinforcements.json"),
    talismans: read("talismans.json"),
    goods: read("goods.json"),
    weaponArts: read("weapon-arts.json"),
    armour: read("armour.json"),
    weapons: read("weapons.json"),
    movesets: read("movesets.json"),
    hits: read("hits.json"),
    animations: read("animations.json"),
    speffects: read("speffects.json"),
    toughness: read("toughness.json"),
    poiseRecovery: read("poise-recovery.json"),
    plannerRulesets: read("planner-rulesets.json"),
    ashCompat: read("ash-compat.json"),
  };
}

/** Loaded + indexed game data, cached per patch for the process lifetime. */
export function loadGameData(patch = DEFAULT_PATCH): GameData {
  let data = cache.get(patch);
  if (!data) {
    data = indexGameData(loadRawGameData(patch));
    cache.set(patch, data);
  }
  return data;
}

const RULESET_PATH = fileURLToPath(new URL("../../../fixtures/ruleset/erpvp-ladder.json", import.meta.url));

/** ERPvP ladder ruleset (fixtures/ruleset/erpvp-ladder.json — human-readable source of truth, D20). */
export function loadLadderRuleset(): LadderRuleset {
  return JSON.parse(readFileSync(RULESET_PATH, "utf8")) as LadderRuleset;
}

const FORMULAS_PATH = fileURLToPath(new URL("../../../docs/public/formulas.md", import.meta.url));

/** Sections of docs/public/formulas.md ("## n. Title"), for `ertc explain` and the explain_formula tool. */
export function formulaSections(): { title: string; body: string }[] {
  const text = readFileSync(FORMULAS_PATH, "utf8");
  return text
    .split(/^(?=## )/m)
    .filter((s) => s.startsWith("## "))
    .map((s) => ({ title: s.split("\n")[0]!.replace(/^##\s*/, "").trim(), body: s.trim() }));
}

/** Best-matching section for a free-text topic (case-insensitive word overlap with the title, then body). */
export function findFormulaSection(topic: string): { title: string; body: string } | null {
  const words = topic.toLowerCase().split(/\W+/).filter((w) => w.length > 1);
  if (!words.length) return null;
  const score = (s: { title: string; body: string }) =>
    words.reduce((a, w) => a + (s.title.toLowerCase().includes(w) ? 10 : 0) + (s.body.toLowerCase().includes(w) ? 1 : 0), 0);
  const ranked = formulaSections().map((s) => ({ s, n: score(s) })).sort((x, y) => y.n - x.n);
  return ranked[0] && ranked[0].n > 0 ? ranked[0].s : null;
}
