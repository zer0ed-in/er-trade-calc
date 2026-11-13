# 05 — Data sources, licences, credits

## Permission (from Emilia / sovietspaceship, 2026-11-12)
- We may **copy any of her internal files once** and use them in our own repo (internal or public). She is also fine with a full rebuild or public clone of her planner (we don't need one).
- We must **not repeatedly request** her sites or use her files/assets live. So: **one-time copy, committed to the repo. Never fetched at runtime, in CI, on deploy, or in tests.**
  Re-copy only when a new game patch lands, once, with Zer0's OK.
- Credit wording not yet specified → use the default below (one constant in code: `CREDIT_LINE`).

## Default credit line (README + every output footer)
> Data: Emilia (sovietspaceship) — [ER Build Planner](https://er-build-planner.nyasu.business) & [Frame Data Explorer](https://er-frame-data.nyasu.business).
> AR calculation based on Tom Clark's [elden-ring-weapon-calculator](https://github.com/ThomasJClark/elden-ring-weapon-calculator) (MIT).
> Param field definitions: [soulsmods/Paramdex](https://github.com/soulsmods/Paramdex).

## The one-time copy (milestone 1B)
Write `packages/data/scripts/snapshot-emilia.ts`. It downloads the list below **sequentially with a 1 s delay between requests**, saves each file to
`packages/data/raw/emilia/<patch>/` unchanged, and writes `manifest.json` (URL, size, sha256, copied-at). Run it **once**. Commit the output.
The script must refuse to run if the target folder already has a manifest for that patch (use `--force` only with Zer0's OK). CI must never run it.
Large files: store gzipped (`.json.gz` / `.js.gz`) if over 50 MB; AtkParam_Pc.json is ~37 MB.

### A. Frame Data Explorer — `https://er-frame-data.nyasu.business/generated/1.17/`
`animations.json`, `attacks.json`, `armaments.json`, `EquipParamWeapon.json`, `AtkParam_Pc.json`, `BehaviorParam_PC.json`, `Bullet.json`,
`EquipParamGoods.json`, `Magic.json`, `SpEffectParam.json`, `SwordArtsParam.json`, `ToughnessParam.json`, `FinalDamageRateParam.json`,
`EquipParamAccessory.json`, `EquipParamProtector.json`, `EquipParamGem.json`
plus `https://er-frame-data.nyasu.business/generated/1.12/SpEffectParam.names.json`.
**Do not** fetch the per-animation `tae/animations/<id>.json` files (thousands of requests). `animations.json` has what we need.

### B. ER Build Planner — `https://er-build-planner.nyasu.business/assets/`
File names are content-hashed; these are the names seen on 2026-11-12. If one 404s, fetch `index.html` + `assets/index-*.js` once, find the new name by its prefix, and continue.
| File | Contains |
|---|---|
| `correction-attack-BvD1v8dy.js` | attack-element correction: which stats scale each damage type, **including skill tables 51010–51xxx** + override rates |
| `correction-graph-C8myFf4I.js` | stat curves (CalcCorrectGraph) |
| `reinforcements-GFGYDjN6.js` | upgrade multipliers (ReinforceParamWeapon) |
| `attacks-CnHm4LBL.js` | weapon → attack names → hit ids, attack rows, per-animation HA (`ha`) blocks |
| `rulesets-BMUmMfbT.js` | machine-readable ER PvP Ladder rules (2026-03-21) — base for our ruleset (see fixtures/ruleset) |
| `poise-breakpoints-r6ljVx1g.js` | poise thresholds per attack — cross-check |
| `damage-calculator-defender-presets-CzxEsWKV.js` | defender presets — reference |
| `notifications-BNvikVlY.js` | main bundle: game data (weapons, armour, talismans, classes, effects) **and formulas** (defence curve, per-type final damage, HP, defences, equip load, poise, spellAR) |
| `router-kWqAVQQz.js` | UI logic incl. startup display (+1), HA effective-poise formula |
| `presets-B44WZM-t.js`, `presets-dlc1-Ugfvtsbl.js` | build presets — reference |
| `DuelSimulatorView-OLuS0SVx.js` | duel simulator — reference for duel state & status effects |

Then `pnpm data:build` extracts the data blocks from these files into typed JSON under `packages/data/gen/1.17/` (keep ids; record which file each table came from).
Porting her formulas is permitted; cite the planner as the source in code comments and in docs/public/formulas.md.

### C. Tom Clark's elden-ring-weapon-calculator (MIT)
`public/regulation-vanilla-v1.17.js` + `src/calculator/*`. Weapon AR per type; verified against the planner (Shamshir Heavy/Keen 1H 489/493). Vendor the needed code with the MIT notice or pin a commit. GitHub is fine to clone.

### D. Paramdex (soulsmods)
Field meanings for params. Reference only; no licence file — link, don't vendor.

### E. regulation.bin (game file, from TKGP's ER Regulation Archive)
Source of truth for game tables from patch 1.17.3 on. `regulation.bin` for 1.17.3 (regulation version 11730034,
sha256 `b8cdab84c0772f66811fdc5176a381877ca6657b37d420cc2c1562a90d63870e`) comes from TKGP's "ER Regulation Archive"
(Nexus Mods, Elden Ring mod 4262). It lives in `game-files/1.17.3/` (gitignored); `.bin` files are never committed.
`pnpm data:regulation` reads it (`packages/data/scripts/lib/regulation.ts`: AES-256-CBC → DCX/ZSTD → BND4 → PARAM) and writes
only the tables we use to `packages/data/gen/regulation/1.17.3/`, with a manifest (version, sha256, date, checks).
- Field layouts come from the Elden Ring paramdefs in Smithbox (vawser, GPL-3.0; they add FirstVersion/RemovedVersion to Paramdex's defs).
  They are kept locally in `game-files/paramdefs/` and **not vendored** until the licence question is settled.
- Emilia's copies are kept where they match. Checked on every extraction: AtkParam_Pc (11,017 rows), BehaviorParam_PC (13,865),
  Bullet (15,475), EquipParamWeapon, EquipParamAccessory, EquipParamGoods, ToughnessParam, FinalDamageRateParam and her SpEffectParam rows
  all equal 1.17.3 on every same-named field, except Bullet row 20003309 (Piquebone Arrow): `atkId_Bullet` 0 in her 1.17 copy, 1 in 1.17.3.
- New from the game file: full SpEffectParam (11,354 rows; gzipped) and the poise recovery values
  (GameSystemCommonParam.baseToughnessRecoverTime, PlayerCommonParam.toughnessRecoverCorrection).

### F. Not used
- **Enemy data** — not needed. The calculator is PvP only: two player builds.
- Wikis/guides — cross-checks only, never the source of a number.

## What's in the copy (verified 2026-11-12)
- AtkParam_Pc rows carry `isAddBaseAtk`, `overwriteAttackElementCorrectId`, `isDisableBothHandsAtkBonus`, `finalDamageRateId`, `atkPhys…`, `atkPhysCorrection` (= MV for weapon hits), `atkAttribute`.
  Example: 300000410 "[AOW] Storm Blade" (wind) = atkPhys 150, isAddBaseAtk 1, overwriteAttackElementCorrectId 51030, isDisableBothHandsAtkBonus 1.
- SpEffectParam #45 "[HKS] Counter Frames": `thrustDamageCutRate 1.15`.
- Skill scaling tables (planner correction-attack): 51010 str 0.25 · 51020 dex 0.25 · 51030 str 0.15 + dex 0.15 · 51070 faith 0.25 (applies to all damage types of the hit).
