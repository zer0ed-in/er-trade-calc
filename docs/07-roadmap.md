# 07 — Roadmap

Claude Code stops at the end of each phase; Zer0 tests locally, then merges (merge to `main` = Railway deploy).

## Phase 1 — The calculator: CLI + MCP server (Claude & ChatGPT) — branch `phase-1`
After each milestone update `PROGRESS.md` (passed / unverified / next).

**1A. Skeleton.** pnpm workspace, TS strict, vitest, CI (`pnpm install --frozen-lockfile && pnpm test && pnpm typecheck`), `.nvmrc`, `packageManager`,
README stub with credit line, `.gitignore` (incl. `*.zip`), `packages/engine/src/assumptions.ts` (A1–A7), golden fixtures wired as tests (failing is fine).
*Done when:* CI runs; fixtures load and validate against zod schemas.

**1B. Data: the one-time copy + build.** Write and run the snapshot script **once** (docs/05), commit raw files + manifest. Write `data:build` to extract typed tables
(attacks, animations, params, correction tables, curves, reinforcement, rulesets, class data). Wire Tom Clark's AR code.
*Done when:* raw files committed with checksums; AR golden tests pass (Shamshir Heavy/Keen 1H 489/493; 2H 548.5/500.2 ±0.5); no code path can fetch Emilia's sites except the snapshot script.

**1C. Core hit engine.** Effective stats, RL math (any class, from class data), 2H rule, defences (five types from data curves), negation by physical attribute,
defence curve, PvP final rates, flat buffs, per-type sum, breakdown.
*Done when:* **all planner-verified golden damage tests pass exactly** (286/243/238/230, the 32-point RL sweep, defence probes).

**1D. Attacks.** Attack lists per build (all normal moves, off-hand, paired, AoW stages; planner names); multi-hit and partial hits; skill hits per **A3**
(no 2H bonus for any hit flagged `isDisableBothHandsAtkBonus` — all AoW hits checked so far); status buildup + proc; `+25/+10` only; build import from planner export (zod, version check).
*Done when:* Storm Blade returns wind (+ blade if chosen) as separate hits with their own numbers and the A3 tag; ash damage is identical 1H vs 2H (evidence-pve tests);
attack names match the planner; importer round-trips Zer0's exports.

**1E. Interaction + duel state.** Poise (incl. talisman effects), poise to tank follow-ups, damage level, HA/SA windows, HA effective poise, trade resolution (docs/04)
with offset and additive input delay, counter hits (#45, pierce ×1.15), conditions (full HP etc.), **Crimson Bubbletear** one-time low-HP heal (legal on ladder),
hits to kill hit-by-hit, scenarios `base`/`duel-start`/`low-hp`, equip load / medium roll, ladder legality from the merged ruleset.
*Done when:* poise tests pass (110/143); Shamshir 2H R1 vs 2H R1 at offset 0 → "trade" with both damages; input delay 0 is provably a no-op; illegal setups are rejected with the rule name.

**1F. CLI + MCP server.** `ertc` commands (docs/06), `--json`, `--breakdown`. MCP stdio + Streamable HTTP, `/health`, `railway.json`, `docs/setup.md`.
*Done when:* MCP works locally from Claude Code; `pnpm mcp:http` serves `/mcp` and `/health` locally; Railway config validated.

**1G. Public formulas guide.** Finish `docs/public/formulas.md`; every engine formula has a section; every worked example matches a passing test.

**End of phase 1:** PR into `main` (what's verified, open assumptions, how to test, limitations). **Stop.**

## After phase 1 (Zer0 decides the order)
- **Phase 2 — Discord bot:** Railway service #2, slash commands + attachments + autocomplete (docs/06).
- **Phase 3 — Frame-perfect interaction:** stagger durations, true combos per build, scythe armour behaviour, spacing caveats.
