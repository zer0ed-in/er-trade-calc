# 09 — Assumptions and open questions

## The assumptions file
`packages/engine/src/assumptions.ts` exports one typed object. Each entry:
```ts
{ id: 'A1', question: string, choice: <typed value>, alternative: <typed value>,
  status: 'assumed' | 'confirmed', reason: string, source?: string, tests: string[] }
```
Engine code reads choices only from here. Each result returns `assumptionsUsed: string[]` (entries still `assumed` that affected it).
Flipping an entry + `pnpm test` is the whole correction process.

## Entries
| ID | Question | Choice | Status | Source / reason |
|---|---|---|---|---|
| A1 | Are listed frame ranges already adjusted for speed gradients? | **yes — use frames as listed**, never apply `gradients` again | **confirmed** | Emilia, 2026-11-12 |
| A2 | What is the +1 between data `startup` and planner display? | counting convention (a setting in her tools): store the 0-based index, display index + 1 | **confirmed** | Emilia + planner code |
| A3 | How does skill/projectile flat damage scale? | `flat × baseAtkRate(upgrade) × (1 + Σ overrideRate × correctRate(upgrade) × curve(stat))`, stats/rates from the hit's `overwriteAttackElementCorrectId` table; weapon-base addition when `isAddBaseAtk` (exact meaning to pin down); **no 2H bonus** | **assumed** | Param-based Steam guide (Flame of the Redmanes example) + data. Directional evidence from Zer0's PvE tests (fixtures/golden/evidence-pve.json): which stat drives each projectile matches the tables; infusion still changes the result (consistent with a weapon-base term). Exact numbers unverified. Planner code (2026-11-12): the planner does not compute skill projectile damage at all (it only sums flats for display). **Loud:** every result using A3 shows "⚠ Projectile damage uses an unverified formula (A3)" until the friend test (fixtures/golden/friend-test-sheet.md) confirms it. |
| A4 | Counter hits | **planner PvP model**: defender inside their #45 counter frames loses 15 points of pierce negation (additive); Spear Talisman = attacker physical ×1.15 (planner). Alternative: pierce damage ×1.15 (SpEffect #45 `thrustDamageCutRate`) | **assumed** (changed 2026-11-12 from "value confirmed") | planner `Nr.counterhit` + wiki.gg (penalty scales with pierce negation); SpEffect #45 export may lack a PvP row |
| A5 | Data source | one-time copy of Emilia's files (docs/05), committed; never fetched again | **confirmed** | Emilia's permission |
| A6 | Build export format | versioned; accept `3.14`, warn on others, zod-validate | **confirmed** (versioned, mostly stable) | Emilia |
| A7 | Input delay | 0 frames per player, additive only | **confirmed** (design rule) | Zer0 |
| A8 | 2H str bonus when the hit's AtkParam_Pc row is missing from the copy | row present → read `isDisableBothHandsAtkBonus`; row missing → normal moveset attacks get the bonus, skill/ash hits never do | **assumed** | The copied AtkParam_Pc is a subset (no row for most normal attacks, incl. Shamshir R1s). Planner applies 2H to every attack (no flag); in-game tests show ashes ignore 2H. Zer0, 2026-11-12 |
| A9 | Lightning Slash weapon buff | +85 lightning AR, 40 s, applies to Lightning infusion | **assumed** (**wiki-sourced**, curated entry) | The copy has SpEffect rows 1675/1677 "[Weapon] Lightning Slash", but they only point to cycle effects 1676/1678, which aren't in the copy; the planner neither models it nor offers it as a buff. wiki.gg (value), wiki.gg/Fextralife (applies to Lightning infusion). Zer0 / planning session, 2026-11-12 |
| A10 | Kick damage | fixed 1 physical, unscaled (in-game ~0–2; 1 avoids zero-division in ratios and infinite hits to kill) | **assumed** | No hit row for Kick in FDE or our AtkParam copy (animation a712_040000 only, no active frames). Its poise damage and timing are unknown, so stagger, trade and timing verdicts with Kick are "Not supported right now" (fix: regulation.bin); guard break needs blocking, not modelled. Zer0, 2026-11-13 |

## Open questions (none block phase 1)
| # | Question | Who |
|---|---|---|
| Q2 | Preferred credit wording | Emilia — default in use |
| Q4 | Ladder max poise is 133 (Zer0) — confirm from armour data at medium load | **Confirmed** (2026-11-12, `packages/data/scripts/max-poise.ts`), banned armour excluded, carrying Shamshir + Bull-Goat: best set Verdigris Helm + Verdigris Armor + Steel Gauntlets + Verdigris Greaves = 100 × 1.333 = **133**, at both reference endurances (40 → max load 90.90, 42 → 93.69). The D16 default armour (Divine Bird Helm instead of Verdigris Helm) gives 93 (124 with Bull-Goat). More endurance or a lighter loadout can exceed 133 |
| Q5 | 2H str past 99: confirm curves cap it (test 70 str 2H) | engine |
| Q7 | Greases/buffs apply to right-hand weapon only — confirm from effect data | engine |
| Q8 | Exact meaning of `isAddBaseAtk` for skill hits (part of A3) | Paramdex: 1 = the row's own flat atk values are the damage source. Planner does not compute skill projectile damage, so no planner check is possible |
| Q9 | Effect values (talismans, tears, greases) come from the planner's hand-curated tables, not raw SpEffectParam (the copy is a 729-row subset) | Emilia — any known mismatches? |
| Q10 | Counter-hit model (A4): additive −15 pierce negation (planner) vs ×1.15 (SpEffect #45) | in-game test needed |
| Q11 | Complete 1.17 AtkParam_Pc / SpEffectParam (only `regulation.bin` has them) — would settle A8 and Q9 | Zer0 |
| Q12 | Can greases go on infused weapons? | **Resolved 2026-11-12 (Zer0, in-game):** greases only go on Standard, Heavy or Keen weapons. The engine refuses a grease on any other infusion (`GREASE_INFUSIONS`, packages/engine/src/game-data.ts), on top of the weapon's `is_buffable`. Weapon-art buffs (Sacred Blade, Lightning Slash) are not greases and aren't limited |
| Q13 | Planner hit `300000841:5373` (Beast's Roar, flat 110) has no AtkParam row; AtkParam `30000841` "[AOW] Beast's Roar" (atkPhys 110, table 51020) looks like the same row with one fewer zero. Engine does not join them, so the hit is "unknown". Same family as Q11 (Ice Spear projectile `300000075` also has no row) | Zer0 / Emilia |
| Q14 | Divine Bird Helm "Focus −45" (tick_interval 0.5): planner divides by tick_interval → −90 (export shows focus 125) | **Resolved 2026-11-12:** in-game the helm lowers Focus by 43 (Zer0, RL 138 66-dex / 19-str build: 275 → 232), so the planner's −90 is wrong. The engine applies gear resistance effects at the item's own value (−45). The net drop is 43 because the helm's +3 str / +4 dex raise the focus level graph by ~2 (reproduced by the engine on the reference dex build; test in packages/builds/test/importer.test.ts). Helm's own armour fields: resistSleep 0, resistMadness 0 (EquipParamProtector 5253000); the −45 comes from the planner's curated effect for resident SpEffect 6525300, which isn't in our SpEffectParam copy |
| Q15 | Multi-hit attacks (e.g. Charged R2 1, 2 hits): the planner shows floor(Σ unrounded hits) (router bundle `Math.floor(n.total.damage.total)`), the engine floors each hit and sums (how in-game hits are applied). Differs by 1 on 2 of the 28 reference cases (2h Charged R2 1: 632 vs 631, 561 vs 560). Golden tests compare the planner's quantity; engine totals unchanged | info; in-game check optional |
