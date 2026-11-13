# Setup: running er-trade-calc and connecting it to Claude / ChatGPT

Everything runs from the repo. Nothing at runtime, in tests or in CI contacts Emilia's sites (docs/05).

## Local (Zer0's Mac)
```bash
nvm use            # Node 22 (.nvmrc)
corepack enable    # pnpm 12.18.0 from package.json "packageManager"
pnpm install
pnpm test          # golden tests (planner-verified numbers must pass exactly)
pnpm typecheck
```

### CLI
```bash
pnpm -s ertc attacks my-build.json
pnpm -s ertc trade str.json dex.json --a "2h R1 1" --b "2h R1 1"
pnpm -s ertc trade str.json dex.json --a "2h R1 1" --b "2h R1 1" --offset 3 --input-delay-b 2 --breakdown
pnpm -s ertc hit str.json dex.json --a "Storm Blade - Wind Slash 1" --hits-a wind --scenario duel-start
pnpm -s ertc sweep str.json dex.json --a "2h R1 1" --b "2h R1 1" --rl-a 95..125
pnpm -s ertc legal my-build.json
pnpm -s ertc explain defence curve
pnpm -s ertc assumptions
```
Builds are the JSON you get from the planner's **Export and save**, or the neutral form used in `fixtures/golden/damage.json`.
Add `--json` for machine output, `--breakdown` for the full calculation, `--ignore-rules` to calculate an illegal setup (flagged).
`-s` just hides pnpm's own "$ tsx …" line.

## MCP server

The same seven tools in both modes: `list_attacks`, `compute_hit`, `compute_trade`, `sweep_rune_level`, `check_legality`,
`explain_formula`, `list_assumptions`. Builds are passed inline as JSON; nothing is stored.

### Local, stdio — Claude Code
```bash
claude mcp add er-trade-calc -- pnpm -s --dir ~/Developer/er-trade-calc mcp:stdio
```
Keep the `-s`: over stdio, stdout is the protocol channel and must carry nothing else (a test runs exactly this command).
Check with `claude mcp list`, then ask e.g. *"Use er-trade-calc to trade these two builds with 2h R1 1"* and paste the exports.

### Local, stdio — Claude desktop
Add to the desktop app's MCP config file (Settings → Developer → Edit Config, `claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "er-trade-calc": {
      "command": "/ABSOLUTE/PATH/TO/pnpm",
      "args": ["-s", "--dir", "/ABSOLUTE/PATH/TO/er-trade-calc", "mcp:stdio"]
    }
  }
}
```
Use the absolute path from `which pnpm`: the desktop app doesn't load your shell's nvm PATH. Restart the app afterwards.

### Local, HTTP
```bash
pnpm mcp:http                # http://localhost:3000/mcp  and  http://localhost:3000/health
PORT=4000 pnpm mcp:http
```
`/health` returns 200 only after the data is loaded and the self-test reproduces the planner's 286/243.

## Hosted (Railway)
`railway.json` configures build (`pnpm install --frozen-lockfile`), start (`pnpm -s mcp:http`) and the `/health` healthcheck.
Railway sets `PORT`. Variables already set: `GAME_PATCH=1.17`, `NODE_ENV=production` (pnpm then skips devDependencies — everything the
server needs at runtime is a regular dependency; checked with a production install). Optional: `RATE_LIMIT_PER_MINUTE` (default 60 per IP).
Merging to `main` deploys. After the first deploy, add `PUBLIC_URL` (the domain Railway generates). The MCP endpoint is `${PUBLIC_URL}/mcp`.
No auth in phase 1 (read-only calculator, no user data stored). No CDN in front of it (MCP is POST + streaming).

### Claude (web/desktop) — remote MCP server
Add a **custom connector** (remote MCP server) in Claude's settings (currently Settings → Connectors → Add custom connector),
URL `${PUBLIC_URL}/mcp`, no authentication. Enable it in a chat from the tools menu.

### ChatGPT — remote MCP server
In ChatGPT's **developer mode** (Settings → Apps & Connectors → Advanced → Developer mode at the time of writing), create a new
app/connector pointing at the remote MCP server URL `${PUBLIC_URL}/mcp`, authentication **none**. Then enable it in a chat.
Menu names in both products change often; what matters is "remote MCP server", the `/mcp` URL and "no auth".

## Data
- `pnpm data:build` regenerates `packages/data/gen/<patch>/` from the committed raw copy (checksums verified first).
- `pnpm data:snapshot` is the **one-time** copy from Emilia's sites. It refuses to run if a manifest exists. Re-run only for a new game
  patch, once, with Zer0's OK (`--force`). CI never runs it.
- `pnpm report:prototype` compares the engine with `fixtures/golden/prototype.json` (prototype expectations, report only). That file is a
  local-only kickoff file (gitignored), so in a fresh clone the command just says it is absent.
