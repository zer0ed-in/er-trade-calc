// ONE-TIME copy of Emilia's files (docs/05, D18). This is the ONLY code in the repo allowed to contact her sites.
// Run once per game patch, with Zer0's OK. CI, tests, runtime and deploy must never run it.
//
//   pnpm data:snapshot            # refuses if a manifest already exists for the patch
//   pnpm data:snapshot --force    # only with Zer0's explicit OK
//
// Sequential requests, 1 s apart (her request). Files are saved byte-for-byte; files over 50 MB are gzipped.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const PATCH = process.env.GAME_PATCH ?? "1.17";
const FORCE = process.argv.includes("--force");
const DELAY_MS = 1000;
const GZIP_THRESHOLD_BYTES = 50 * 1024 * 1024;

const FRAME_DATA_BASE = `https://er-frame-data.nyasu.business/generated/${PATCH}/`;
const PLANNER_BASE = "https://er-build-planner.nyasu.business/";

const FRAME_DATA_FILES = [
  "animations.json",
  "attacks.json",
  "armaments.json",
  "EquipParamWeapon.json",
  "AtkParam_Pc.json",
  "BehaviorParam_PC.json",
  "Bullet.json",
  "EquipParamGoods.json",
  "Magic.json",
  "SpEffectParam.json",
  "SwordArtsParam.json",
  "ToughnessParam.json",
  "FinalDamageRateParam.json",
  "EquipParamAccessory.json",
  "EquipParamProtector.json",
  "EquipParamGem.json",
];
// docs/05 names this one explicitly from the 1.12 folder.
const EXTRA_URLS = ["https://er-frame-data.nyasu.business/generated/1.12/SpEffectParam.names.json"];

// Content-hashed names seen on 2026-11-12 (docs/05 table B). If one 404s we resolve by prefix (see resolvePlannerAsset).
const PLANNER_ASSETS = [
  "correction-attack-BvD1v8dy.js",
  "correction-graph-C8myFf4I.js",
  "reinforcements-GFGYDjN6.js",
  "attacks-CnHm4LBL.js",
  "rulesets-BMUmMfbT.js",
  "poise-breakpoints-r6ljVx1g.js",
  "damage-calculator-defender-presets-CzxEsWKV.js",
  "notifications-BNvikVlY.js",
  "router-kWqAVQQz.js",
  "presets-B44WZM-t.js",
  "presets-dlc1-Ugfvtsbl.js",
  "DuelSimulatorView-OLuS0SVx.js",
];

interface ManifestEntry {
  url: string;
  file: string;
  bytes: number;
  sha256: string;
  gzipped: boolean;
  copiedAt: string;
  note?: string;
}

const outDir = join(fileURLToPath(new URL("../raw/emilia/", import.meta.url)), PATCH);
const manifestPath = join(outDir, "manifest.json");

if (existsSync(manifestPath) && !FORCE) {
  console.error(`Refusing: ${manifestPath} exists. The copy is one-time (docs/05). Use --force only with Zer0's OK.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let requestCount = 0;

// Every request goes through here so the 1 s spacing can't be bypassed.
async function politeFetch(url: string): Promise<Response> {
  if (requestCount > 0) await sleep(DELAY_MS);
  requestCount++;
  console.log(`GET ${url}`);
  return fetch(url, { headers: { "User-Agent": "er-trade-calc one-time snapshot" } });
}

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const entries: ManifestEntry[] = [];

function save(url: string, fileName: string, body: Buffer, note?: string) {
  const gzipped = body.byteLength > GZIP_THRESHOLD_BYTES;
  const stored = gzipped ? gzipSync(body, { level: 9 }) : body;
  const file = gzipped ? `${fileName}.gz` : fileName;
  writeFileSync(join(outDir, file), stored);
  // sha256 + bytes describe the ORIGINAL content, so a re-copy can be compared regardless of compression.
  entries.push({ url, file, bytes: body.byteLength, sha256: sha256(body), gzipped, copiedAt: new Date().toISOString(), ...(note ? { note } : {}) });
}

async function fetchRequired(url: string): Promise<Buffer> {
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Lazily-loaded planner asset list for 404 fallback (index.html + index-*.js fetched at most once each).
let plannerAssetNames: string[] | null = null;
async function resolvePlannerAsset(staleName: string): Promise<string> {
  if (!plannerAssetNames) {
    const html = (await fetchRequired(PLANNER_BASE + "index.html")).toString("utf8");
    const indexJs = html.match(/assets\/(index-[\w-]+\.js)/)?.[1];
    if (!indexJs) throw new Error("Could not find assets/index-*.js in planner index.html");
    const js = (await fetchRequired(PLANNER_BASE + "assets/" + indexJs)).toString("utf8");
    plannerAssetNames = [...new Set([...js.matchAll(/([\w.-]+-[\w-]{8}\.js)/g)].map((m) => m[1]!))];
  }
  const prefix = staleName.replace(/-[\w-]{8}\.js$/, "-");
  const candidates = plannerAssetNames.filter((n) => n.startsWith(prefix) && /^[\w-]{8}\.js$/.test(n.slice(prefix.length)));
  if (candidates.length !== 1) throw new Error(`Cannot resolve ${staleName}: candidates ${JSON.stringify(candidates)}`);
  return candidates[0]!;
}

for (const name of FRAME_DATA_FILES) save(FRAME_DATA_BASE + name, name, await fetchRequired(FRAME_DATA_BASE + name));
for (const url of EXTRA_URLS) save(url, "SpEffectParam.names.json", await fetchRequired(url), "from the 1.12 folder per docs/05");

for (const name of PLANNER_ASSETS) {
  const url = PLANNER_BASE + "assets/" + name;
  const res = await politeFetch(url);
  const body = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  // SPA hosts often answer a stale asset path with index.html (200), so HTML counts as "missing" too.
  const looksLikeHtml = body !== null && /^\s*<(!doctype|html)/i.test(body.subarray(0, 64).toString("utf8"));
  if (body && !looksLikeHtml) {
    save(url, name, body);
    continue;
  }
  if (!res.ok && res.status !== 404) throw new Error(`${res.status} for ${url}`);
  const resolved = await resolvePlannerAsset(name);
  const resolvedUrl = PLANNER_BASE + "assets/" + resolved;
  save(resolvedUrl, resolved, await fetchRequired(resolvedUrl), `docs/05 name ${name} 404'd; resolved by prefix`);
}

writeFileSync(manifestPath, JSON.stringify({ patch: PATCH, requests: requestCount, files: entries }, null, 1) + "\n");
console.log(`Done: ${entries.length} files, ${requestCount} requests → ${outDir}`);
