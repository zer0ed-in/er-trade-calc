# er-trade-calc

Elden Ring PvP trade calculator for the ERPvP ladder ruleset (PC, patch 1.17).
Two builds in → damage both ways, poise outcome, trade verdict, hits to kill, with a step-by-step breakdown.

> Status: phase 1 (calculator: CLI + MCP server) complete — see [PROGRESS.md](PROGRESS.md).

## Quick start
```bash
corepack enable && pnpm install
pnpm test
pnpm -s ertc trade str.json dex.json --a "2h R1 1" --b "2h R1 1" --breakdown
```
Builds are exports from Emilia's ER Build Planner ("Export and save"). Commands, the MCP server (Claude Code, Claude, ChatGPT) and hosting:
[docs/setup.md](docs/setup.md).

## What you can trust
- Numbers checked against the planner are golden tests that must pass exactly (`fixtures/golden/`).
- Anything that depends on an unconfirmed assumption says so: every result lists the assumption IDs it used (`ertc assumptions`).
- Where the data can't answer (e.g. a skill hit with no scaling data), the result is **unknown**, never a guess.
- ⚠ **Projectile damage uses an unverified formula (A3).** Skill projectiles (Storm Blade's wind, Sacred Blade's wave…) use a formula
  that hasn't been checked in-game yet; every result that uses it says so at the top. Normal attacks and weapon swings are planner-checked.

## Credits
Data: Emilia (sovietspaceship) — [ER Build Planner](https://er-build-planner.nyasu.business) & [Frame Data Explorer](https://er-frame-data.nyasu.business).
AR calculation based on Tom Clark's [elden-ring-weapon-calculator](https://github.com/ThomasJClark/elden-ring-weapon-calculator) (MIT).
Param field definitions: [soulsmods/Paramdex](https://github.com/soulsmods/Paramdex) and [Smithbox](https://github.com/vawser/Smithbox).
Game file (regulation.bin 1.17.3): TKGP's [ER Regulation Archive](https://www.nexusmods.com/eldenring/mods/4262).
