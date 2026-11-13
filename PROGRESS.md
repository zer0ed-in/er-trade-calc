# Phase 1 progress

## 1A — Skeleton ✅
- pnpm 12.18.0 workspace (`packages/engine|data|builds|cli|mcp-server`), TypeScript strict (NodeNext ESM), vitest, zod, tsx.
- CI: `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile && pnpm test && pnpm typecheck`. Never runs the snapshot.
- `packages/engine/src/assumptions.ts` holds A1–A7 (docs/09). `CREDIT_LINE` constant in `packages/engine/src/credit.ts`.
- All golden fixtures + ruleset load and validate against zod schemas (`packages/engine/test/fixtures.ts`).
- Note: pnpm 12 fails `install` when a dependency's build script is unapproved; `esbuild` (needed by tsx) is approved in `pnpm-workspace.yaml`.

**Unverified:** CI has not run on GitHub yet (runs when the branch is pushed).
**Next:** 1B — one-time data copy, `data:build`, Tom Clark AR.

## 1B — Data: one-time copy + build ✅
- `pnpm data:snapshot` ran **once** (2026-11-12): 29 requests, 1 s apart, no 404s. 29 files in `packages/data/raw/emilia/1.17/` with `manifest.json` (url, bytes, sha256, copiedAt). Nothing exceeded 50 MB, so nothing is gzipped. The script refuses to re-run without `--force`.
- `pnpm data:build` → `packages/data/gen/1.17/` (19 tables, ~22 MB). It verifies raw checksums first; `sources.json` records the raw file behind every table. Planner literals are evaluated in an empty `vm` context; her app code is never run.
- Tom Clark's calculator vendored (`packages/engine/src/ar/vendor/tom-clark.ts`, MIT, commit `3539d87`) + his `regulation-vanilla-v1.17.js` in `packages/data/raw/tom-clark/`.
- Tests: AR goldens pass (Heavy/Keen 1H 489/493, 2H 548.5/500.2, Lightning optimal 577). +25/+10 enforced. A test proves that only the snapshot script references Emilia's hosts.

**Data gaps found → Zer0's rulings (2026-11-12):**
- The copied `AtkParam_Pc.json` is a subset (no row for 8,277 of 9,587 normal-attack hits, incl. Shamshir R1s) → new **A8**: row present = read `isDisableBothHandsAtkBonus`; missing = normal attacks get 2H, skill hits never.
- The copied `SpEffectParam.json` is a 729-row subset without talisman/tear/grease rows → effect values come from the planner's curated effect tables (in the copied bundle), cited per value (Q9).
- Lightning Slash buff isn't in the copy → new **A9** (+85 lightning, 40 s, wiki-sourced).
- **A4 changed** from "confirmed ×1.15" to *assumed*: default is the planner PvP model (−15 points pierce negation), ×1.15 is the alternative (Q10).
- `fixtures/golden/attacks.json` lists Storm Blade blade hit `300000407:5023`; Shamshir's row is `…:5022` (5023 is another weapon class, poise 96.53 vs 87.75). The fixture is status `data`; tests use Shamshir's real row.

**Unverified:** Q5 (2H past 99 str) — curve 0 runs to 150, so 70 str 2H (105) still scales; no planner check.
**Next:** 1C — core hit engine.

## 1C — Core hit engine ✅
- Effective stats (equipment stat bonuses, cap 99), RL from class data (any class), 2H rule per hit (AtkParam flag or A8), five defences from the planner's CalcCorrectGraph data, armour negation by physical attribute, the planner's effect tables (Absorption v → ×(2−v), PvP values), defence curve, PvP final rates, flat buffs (before MV), per-type sum, `explainHit` breakdown.
- **All planner-verified damage goldens pass exactly**: 286/243/238/230 + the 32-point RL sweep (incl. planner physical column and defender defence). All 66 defence probes pass, as do full-Verdigris absorption (8 types), HP 1900, armour weight 61.6, max load 90.9 at 40 end and 71.6% Heavy.
- **Doc correction:** defences floor each part (level, stat) separately, as the planner does. docs/03 rule 3 said "floor the sum", which is wrong on 7 of the 66 probes. Fixed in docs/03 and docs/public/formulas.md.
- Prototype check (`pnpm report:prototype`): all 8 prototype cases (str vs faith, Sacred Blade ×3, greases ×3) match the engine exactly.
- Greases: the weapon's `is_buffable` is enforced; whether some infusions can't take greases is **not** enforced (Q12, unverified).

**Unverified:** buffs applying to flat projectile hits (not applied); status buildup shown, but not yet hits-to-proc.
**Next:** 1D — attacks.

## 1D — Attacks ✅ (importer round-trip pending Zer0's exports)
- Attack lists per build use the planner's names, by hand/slot. Right hand: normal moves + the mounted ash's stages (or the weapon's default skill). Left hand: Offhand/Paired + 2h. Ashes the weapon can't take are rejected.
- Multi-hit and partial attacks: `hits` = all | first | 1,2 | weapon/flat (aliases blade, wind, projectile, wave, bolt). Totals = plain sum of landed hits.
- 2H per hit: AtkParam flag when the row exists, A8 otherwise. Skill flat damage per A3 (table from `overwriteAttackElementCorrectId`, upgrade rate, reinforcement scaling, weapon curve; no 2H).
- Status: buildup per hit (weapon status × statusMV + grease buildup), defender resistance (planner graphs 110–126 + armour), attacks-to-proc, proc damage (planner formulas: bleed 15% + 100, frost 10% + 30, madness 15% + 100).
- Unmet weapon requirements produce a WARNING on every hit (the game's −40% penalty applies).
- Importer (`packages/builds`): planner character export (JSON, base64 or `{character}`), zod-validated, A6 version warning, only upgrade 25 (→ +25 / somber +10), plus a neutral-build loader.
- Tests: Storm Blade = blade (MV 65 Slash) + wind (flat 150 Standard, table 51030, A3), each with its own number; **1H = 2H** for Beast's Roar, Storm Blade and Ice Spear on every infusion in evidence-pve, for both test builds; Shamshir R1 startup 14 (displayed 15f), poise 110/143.

**Pending / unverified:**
- **Importer round-trip with Zer0's real exports:** `fixtures/builds/planner-exports/` is empty. The tests exist and skip until the files are added. The weapon `equipIndex` → hand mapping (0–2 right, 3–5 left) is read from planner code and unverified.
- **Ice Spear projectile** (`300000075`) and **Beast's Roar hit 1** (`300000841`) have no AtkParam row in the copy, so their damage is reported "unknown" (Q11, Q13). Beast's Roar has a near-identical row `30000841`; not joined (no guessing).
- The `fixtures/golden/attacks.json` Storm Blade blade id is `…:5023`; Shamshir uses `…:5022` (see 1B).

**Next:** 1E — interaction + duel state.

## 1E — Interaction + duel state ✅
- Poise: armour poise × talisman multipliers (Bull-Goat 1.333 from the planner table), stagger at ≥, poise needed to tank each follow-up hit, damage level shown.
- HA/SA from animation windows. Effective HA poise uses the planner formula `(armourPoise × armourContribution + poiseContribution) × poiseMultipliers / poiseDamageMultiplier`, and HA damage multiplier is applied to damage taken. SA is unbreakable. An HA window without HA strength data → verdict "unknown (reason)".
- Trade: hit frame = startup (data index) + input delay + offset (A1 frames as listed; A7 additive only). The earlier hit staggers → "no trade, X wins"; otherwise "trade". Counter hit when a hit lands inside the other's SpEffect #45 window (A4 model).
- Hits to kill: hit by hit with duel state. Full-HP effects (Ritual Shield/Sword) drop after the first hit taken. Crimson Bubbletear heals once below 21% (30% max HP, planner).
- Scenarios `base` / `duel-start` / `low-hp` (50% HP) with overrides. Equip load and roll are reported.
- Ladder legality: every line of `fixtures/ruleset/erpvp-ladder.json` maps to a check or an explicit not-checkable reason (test-enforced); RL 125 is reported separately (sweeps vary it).
- Tests: Shamshir 2H R1 vs 2H R1 offset 0 → **trade, 286 / 243**; input delay 0 is identical to omitting it; offset 5 → no trade, A wins; counter-hit window; poise 110/143 thresholds; HA formula; SA; Ritual Shield first-hit-only; Bubbletear; illegal setups rejected by rule name.
- **Q4 confirmed from data** for the template: max poise at medium load = Verdigris + Steel Gauntlets 100 × Bull-Goat 1.333 = **133**.

**Not checkable (reported in every legality report):** "Reverse Blades" (no matching weapon class/name — needs Zer0's mapping), shield-blocking >90%, spells/consumables/great runes (not part of a calculator build).
**Next:** 1F — CLI + MCP server.

## 1F — CLI + MCP server ✅
- `packages/engine/src/api.ts`: one interface layer for the CLI and MCP (same numbers, same breakdowns). Ladder legality runs first; illegal setups are rejected naming the rule; `ignore-rules` calculates anyway and flags the result. Every result carries `patch`, `assumptionsUsed`, `credit`.
- `ertc` (commander): `attacks`, `hit`, `trade`, `sweep`, `legal`, `explain`, `assumptions`; `--json`, `--breakdown`, scenarios and per-side overrides (`--buff/-b`, `--grease/-b`, `--talisman/-b`, `--tear/-b`, `--hp-pct/-b`), timing (`--offset`, `--input-delay-a/-b`), `--poise-taken-a/-b`, hit/hand/slot/grip per side.
- RL sweep (`packages/engine/src/sweep`): points move in the main damage stat by default (`--stat-a/--take-from`). **It reproduces all 32 planner sweep points** and the HTK parity at str RL 115 / damage crossover at 107. Invalid points are reported, not dropped.
- MCP: seven tools (docs/06), stdio (`pnpm -s mcp:stdio`) and stateless Streamable HTTP (`pnpm mcp:http`: `POST /mcp`, `GET /health`, 2 MB body cap, per-IP rate limit). `/health` = 200 only after data load + a self-test reproducing 286/243.
- `railway.json` (Railpack, frozen lockfile, `pnpm -s mcp:http`, `/health`). `docs/setup.md` covers Claude Code, Claude desktop, Claude custom connector, ChatGPT developer mode.
- Tests: MCP tools in-memory; HTTP server spawned on a free port (health, a real `tools/call`, GET rejected); **stdio via the exact command docs/setup.md gives Claude Code**; CLI smoke tests; production-style install (`NODE_ENV=production`) served `/health` 200 locally.
- Bug found and fixed: legality only looked at the build file's talismans/tears, so CLI/MCP extras and base-scenario equipment slipped through. Now checks everything equipped.

**Unverified:** Railway itself. `railway.json` is checked structurally, and the production install was simulated locally, but the Railpack builder name and the first deploy can only be confirmed on Railway. Connector menu paths in docs/setup.md are current-as-known and may have moved.
**Next:** 1G — public formulas guide.

## 1G — Public formulas guide ✅
- `docs/public/formulas.md` brought in line with the engine:
  - two-handing per hit (A8) and the requirement penalty
  - the A3 skill formula with its upgrade-scaling term; skill hits that are "unknown"
  - Lightning Slash (A9)
  - the effect-value convention (2 − v) for negation
  - counter hits as A4 (−15 points of pierce negation)
  - Bubbletear in hits to kill
  - poise maximum 133 from data
  - new §15 (HP, equip load, status)
  - per-part defence flooring
  - assumptions table A3/A4/A8/A9
- The "same buff" example now names exact builds; the engine reproduces it (+14 Heavy, +65 Sacred; calculator result, not planner-checked).
- `packages/engine/test/formulas-guide.test.ts` checks every worked example in the guide against the engine and that the guide still states the number.

## Post-1G — reference builds, planner damage, focus, A3 warning (2026-11-12, planning-session answers relayed by Zer0)
- Reference builds are Zer0's exports: `strenuous.json` and the corrected `dextra_erpvp_test.json` (Keen Shamshir, Spinning Slash, no talismans).
  Importer reproduces both exports' planner `computed` values. The inventory's banned items aren't equipped, so the dex build is legal (tested).
- **28 new planner-verified damage cases** (`fixtures/golden/damage.json`, `ref-*`), both directions, all exact. Two-hit Charged R2:
  the planner shows floor(Σ unrounded hits), so those cases compare that quantity (docs/09 Q15). No 2H skill cases (the planner wrongly applies 2H to ash hits).
- D16 default armour: Divine Bird Helm, Verdigris Armor, Steel Gauntlets, Verdigris Greaves (`docs/08`).
- Q14 resolved: gear resistance effects now apply at the item's own value (Divine Bird Helm Focus −45; the planner's −90 is wrong).
  Net focus drop is 43, the in-game figure, because the helm's stat bonus raises the level graph.
- Q4: max ladder poise is still 133 (Verdigris Helm set + Steel Gauntlets + Bull-Goat) at 40 and 42 endurance. The default armour gives 93 (124 with Bull-Goat).
- A9: SpEffect rows 1675/1677 exist but point to cycle effects that aren't in the copy, so A9 stays wiki-sourced.
- A3 is loud: "⚠ Projectile damage uses an unverified formula (A3)" tops every CLI/MCP result using it (`meta.warnings`); README and formulas guide too.
- Friend test sheet: `pnpm -s report:friend-test [friend.json]` → `fixtures/golden/friend-test-sheet.md` (102 rows, stand-in defender until the friend's export arrives).
- Q12 resolved (Zer0, in-game): greases only go on Standard, Heavy or Keen weapons; the engine refuses a grease on any other infusion. Weapon-art buffs aren't affected.
- Ruleset fixes (Zer0, 2026-11-12), each with a legality test (`packages/engine/test/legality.test.ts`): 2H ban on the Backhand Blade weapon only;
  power-stanced Backhand Blades stays a class ban (covers the Reverse-Bladed Sword); "Reverse Blades" = Reverse-Bladed Sword by name
  (Lightning 2H banned, all buffs banned when 2H); 2H Stone Club/Club bans any status application (infusion status from weapon data, or a "…Buildup" grease).
- Identity scrub: the owner is Zer0 everywhere in the working tree. Absolute local paths replaced (`~/Developer/er-trade-calc` or a placeholder).
- Kickoff cleanup: `START_HERE.md`, `reference/prototype/`, `fixtures/golden/prototype.json` untracked and gitignored (local copies kept), plus `*.bin`.
  prototype.json had no verified cases, so nothing was moved; its schema-load test was dropped and `pnpm report:prototype` says when the file is absent.
