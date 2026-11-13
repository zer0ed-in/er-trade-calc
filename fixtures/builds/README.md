# Test builds

`../golden/damage.json` contains the planner-verified builds in a neutral form (class, stats, weapon, armour). The engine's own `Build` type expresses them directly (tests construct them without the importer).

## Reference builds — `planner-exports/` (Zer0's exports from Emilia's planner, "Export and save")
Armour on both: Divine Bird Helm, Verdigris Armor, Steel Gauntlets, Verdigris Greaves (the D16 default).
- `strenuous.json` — Heavy Knight RL 125, 60/8/42/55/15/7/8/9 (58 str / 19 dex with the helm), Heavy Shamshir +25 (Spinning Slash).
  Neutral form: `strenuous-125`.
- `dextra_erpvp_test.json` — Heavy Knight RL 125, 60/8/40/15/57/7/8/9 (18 / 61 with the helm), Keen Shamshir +25 (Spinning Slash),
  no talismans equipped. Neutral form: `dextra-125`. Its inventory holds banned items (Bestial Vitality, Shard of Alexander, Rune Arc,
  Flask of Crimson Tears) that are not equipped; only equipped items are imported or checked for legality.

The importer tests (`packages/builds/test/importer.test.ts`) import both and reproduce the planner's saved `computed` values.
The planner-verified damage between them is in `../golden/damage.json` (cases `ref-*`, 2026-11-12).

## Earlier builds (engine tests only)
`dex-shamshir-125` / `str-shamshir-125` (full Verdigris, 2026-10-21, the 286/243 cases) stay as golden cases in neutral form.
No planner exports of them are expected.

Note: Zer0's original str spread (61 str / 11 dex) can't wield the Shamshir (needs 13 dex); that verified build uses 59/13.
