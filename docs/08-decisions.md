# 08 — Decisions already made (don't re-argue; ask Zer0 if one looks wrong)

| # | Decision |
|---|---|
| D1 | Purpose: a trade calculator for ERPvP ladder duels. |
| D2 | TypeScript monorepo, Node 22, pnpm. No Python/Docker/conda. |
| D3 | Engine is pure; all interfaces share it. |
| D4 | Data from Emilia's files (one-time copy, see D18) + Tom Clark's MIT calculator. Snapshotted with checksums. |
| D5 | Input = two builds exported from Emilia's planner. No attacker/defender roles; always both directions. |
| D6 | Scope: PC, ERPvP ladder ruleset (not Infamous), +25/+10 weapons, patch 1.17. |
| D7 | Phases: 1 = the calculator: CLI + MCP (Claude & ChatGPT, local + hosted); 2 = Discord bot; 3 = frame-perfect + true combos. |
| D8 | Hosting: Railway (project er-trade-calc, auto-deploy from `main`, `/health`, no CDN). Discord bot later on same project. |
| D9 | AI is optional and user-supplied: people use their own Claude/ChatGPT via MCP. The bot is AI-free. No API keys handled by us. |
| D10 | Unknowns are assumptions in one file, listed in every result that uses them. |
| D11 | Input delay: per-player setting, default 0, additive frames only. |
| D12 | Public formulas guide with annotated equations, kept in sync with the engine. |
| D13 | Workflow: branch per phase, PR, Zer0 tests locally, merge = deploy. |
| D14 | Identity: author "Zer0", GitHub zer0ed-in, email zer0eed.in@gmail.com. No other identity anywhere. |
| D15 | Default RL convention for sweeps: points removed from/added to the build's main damage stat; configurable. |
| D16 | Default test template: Heavy Knight, 60 vig, 40 end, rest in damage stat(s), minimum other stats for weapon requirements, Divine Bird Helm, Verdigris Armor, Steel Gauntlets, Verdigris Greaves (changed 2026-11-12 from full Verdigris + Steel Gauntlets, to match Zer0's reference exports), medium roll. |
| D17 | **PvP only.** Inputs are always two player builds. No enemy/NPC data, ever. |
| D18 | Emilia's data is **copied once** and committed; never fetched again except a deliberate re-copy per game patch. Supersedes the "live fetch" idea in D4. |
| D20 | Ruleset = latest Discord screenshots + planner-only items, with Zer0's rulings (fixtures/ruleset/erpvp-ladder.json). |
