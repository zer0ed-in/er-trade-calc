# 04 — Interaction layer (poise, stagger, trades)

Uses the same hit packets as the damage engine.

## Poise **[D/V]**
- Defender poise = Σ armour poise × multipliers (e.g. Bull-Goat's Talisman via effect data). **Ladder maximum is 133** (Zer0; check with armour optimiser data).
- Poise damage per hit (game data, 2026-11-13) = (atkSuperArmor + saWeaponDamage × atkSuperArmorCorrection/100) × saRate × 10, from the hit's resolved AtkParam row, the weapon's EquipParamWeapon row and FinalDamageRateParam saRate (the planner's `saDamageRateFinal`). Equals the planner's `poiseDamageFlat` on every normal attack **[V]** Shamshir 1H R1 1 = 110, 2H R1 1 = 143; the planner leaves out the flat part (atkSuperArmor), so flat-poise skill hits (Beast's Roar, Ice Spear, Storm Stomp) differ.
- Stagger when accumulated poise damage ≥ current poise, i.e. current poise ≤ 0 after the hit. Planner breaks at **≥** (110 breaks 110, survives at 111) **[V]**.
- Output for multi-hit attacks: poise needed to tank hit 2, hit 3, … (e.g. Spinning Slash).
- Poise refill: current poise returns to full 30 s after the last hit (GameSystemCommonParam.baseToughnessRecoverTime × PlayerCommonParam.toughnessRecoverCorrection). After a break it resets to full (A12). Trade inputs: "poise already taken" (default 0) and "seconds since that hit" (≥ 30 → full). `simulatePoise` runs a hit sequence.

## Stagger level **[D]**
`damageLevel` per hit. Show it. Stagger duration (for combos) is phase 3.

## Hyper armour (HA) and super armour (SA) **[D]**
- Animation data lists `hyperArmour` windows by frame range, each with either an HA id (strength) or `super: true` (SA).
  Examples: colossal sword 2H R1 HA frames 7–25 (hit frames 17–20); Thundercloud Form (Dragon King's Cragblade) SA frames 9–92.
- HA strength comes from the ToughnessParam row the window's id names (game data, 2026-11-13): max = (armourPoise × proCorrectionRate + toughnessCorrectRate × 1000 × correctionRate) × poiseMultipliers; at window start current poise is raised to minToughness × 10 (scaled by the weapon-toughness factor when isNonEffectiveCorrectionForMin is 0, A13); incoming poise damage × pvpToughnessDamageRate, HP damage × pvpHpDamageRate. A window with no row → "not supported".
  The planner's `ha` block holds the same row (its `poiseContribution` = weapon part, or minToughness × 10 for rows with the flag set, added instead of used as a floor); results equal the planner's for rows without the flag.
  HA also scales damage taken by `damageMultiplier` while active.
- SA: cannot be staggered during the window.

## Trade resolution (phase 1: stage 1 + HA/SA windows from data)
Inputs: two builds, one attack each, start offset (frames, default 0), input delay per player (frames, default 0, **added only**).
1. Hit time for each = startup frame (data index, A2) + input delay + offset. Frame ranges are already speed-adjusted (**A1 confirmed**) — never apply `gradients` again.
2. Earlier hit lands first. If equal, both land (simultaneous).
3. First hit staggers the other if poise damage ≥ the other's current poise, where the other's poise is HA-modified if in an HA window at that frame, or unbreakable if in SA.
4. If the other is staggered **before its own hit frame** → **no trade (winner named)**. Otherwise both land → **trade**.
5. Counter-hit: a hit landing inside the other's counter-hit window (effect #45 frames in animation data) gets the counter bonus: effect #45 "[HKS] Counter Frames" = thrustDamageCutRate 1.15 (pierce damage ×1.15) **[D]**; Spear Talisman interaction **[A4]**.
6. Report verdict + both damages (if landed) + poise outcome + the frames used. If any needed data is missing → **unknown (reason)**. Never guess.

Caveats printed with every trade: same-frame start, no latency, no distance/reach, poise assumed fresh unless given.

## True combos — PHASE 3
Combo if hit 1 breaks poise and stagger duration > frames until hit 2 is active; checked per build loadout (e.g. Banished Knight's Halberd R1 → off-hand Hand Axe L1). Not in phase 1 or 2.
