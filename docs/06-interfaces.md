# 06 — Interfaces

All interfaces are thin wrappers over `packages/engine`. Same inputs, same numbers, same breakdowns.

## Inputs common to all
- **Two builds** (planner export JSON). No attacker/defender roles: results always show A→B and B→A.
- **An attack per build** — chosen from that build's real attack list (`attacks` command / autocomplete). Names follow the planner's attack names
  (e.g. `2h R1 1`, `1h R2 1 Release`, `Offhand L1 1`, AoW stage names like `Storm Blade - Wind Slash 1`).
- **Hits landed** per attack: `all` (default) | `first` | explicit list (e.g. Storm Blade `blade`, `wind`).
- **Scenario**: `base` | `duel-start` | `low-hp` (docs/03), plus overrides: `--buff`, `--grease`, `--tear`, `--talisman`, `--hp-pct`.
- **PvP only**: both inputs are player builds. There is no enemy/NPC input.
- **Timing**: `--offset <frames>` (B starts N frames after A), `--input-delay-a <frames>`, `--input-delay-b <frames>` (default 0, additive only).
- **Poise state**: `--poise-taken-a/-b` (default 0).
- Ladder legality is checked first; illegal setups return an error naming the rule (override with `--ignore-rules` for experiments, clearly flagged).

## Phase 1 — CLI: `ertc`
```
ertc attacks <build.json>                      list attacks available to this build (by weapon slot)
ertc hit <A.json> <B.json> --a "<attack>"      one attack, A into B (and the same attack B into A if B can do it)
ertc trade <A.json> <B.json> --a "<atk>" --b "<atk>" [--scenario …] [--offset N] [--hits-a …] [--hits-b …]
                                               verdict (trade / no trade: X wins / unknown: reason), both damages, poise outcome, frames, hits to kill
ertc sweep <A.json> <B.json> --a … --b … --stat-a str --rl-a 95..125 [--rl-b …]
                                               trade table across RLs (points removed from the damage stat by default; --take-from vig to change)
ertc legal <build.json>                        ladder legality report
ertc explain …                                 any command with --breakdown prints the full step-by-step
ertc assumptions                               list A1–A7 with status
```
Output: readable tables by default; `--json` for machines; `--breakdown` for the full chain. Footer: assumptions used, patch, credit.

## Phase 1 — MCP server (`packages/mcp-server`)
Transports: **stdio** (local: Claude Code, Claude desktop) and **Streamable HTTP** at `POST /mcp` (Railway: Claude custom connector, ChatGPT developer-mode app/connector). Plus `GET /health`.
No auth in phase 1 (read-only calculator, no user data stored). Rate-limit per IP lightly. Builds are passed **inline as JSON** in tool arguments; nothing is stored.

Tools (names and descriptions must be clear enough for the model to choose correctly):
| Tool | Purpose |
|---|---|
| `list_attacks` | attacks available to a build |
| `compute_trade` | two builds + one attack each (+ scenario/timing/hits) → verdict, damage both ways, poise, frames, hits to kill, breakdown |
| `compute_hit` | one attack, both directions |
| `sweep_rune_level` | RL sweep for one or both builds |
| `check_legality` | ladder ruleset check |
| `explain_formula` | returns the relevant section of docs/public/formulas.md |
| `list_assumptions` | A1–A7 with status, so the model can caveat answers |

Every tool result includes `assumptionsUsed`, `patch`, `credit`. Tool descriptions tell the model: never invent numbers; quote the engine's.

Docs to write: `docs/setup.md` — local stdio config for Claude Code (`claude mcp add …`) and Claude desktop; hosted URL `${PUBLIC_URL}/mcp` as a Claude custom connector and as a ChatGPT developer-mode app/connector. Product names for these change; describe them as "remote MCP server" and give current steps.

## Phase 2 — Discord bot (not now)
Railway service #2. Slash commands `/trade`, `/hit`, `/attacks`, `/legal` with two build **attachments** and **autocomplete** for attack names. AI-free. Nothing stored.
