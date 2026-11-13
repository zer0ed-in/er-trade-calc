# 04 — Interaction layer (poise, stagger, trades)

Uses the same hit packets as the damage engine.

## Poise **[D/V]**
- Defender poise = Σ armour poise × multipliers (e.g. Bull-Goat's Talisman via effect data). **Ladder maximum is 133** (Zer0; check with armour optimiser data).
- Poise damage per hit = attack data `poiseDamageFlat` (already includes the weapon's poise for that attack — planner uses it directly). **[V]** Shamshir 1H R1 1 = 110, 2H R1 1 = 143.
- Stagger when accumulated poise damage ≥ current poise. Planner breaks at **≥** (110 breaks 110, survives at 111) **[V]**.
- Output for multi-hit attacks: poise needed to tank hit 2, hit 3, … (e.g. Spinning Slash).
- Poise reset timing after being hit: input parameter "poise already taken" (default 0). Don't model regen timers in phase 1.

## Stagger level **[D]**
`damageLevel` per hit. Show it. Stagger duration (for combos) is phase 3.

## Hyper armour (HA) and super armour (SA) **[D]**
- Animation data lists `hyperArmour` windows by frame range, each with either an HA id (strength) or `super: true` (SA).
  Examples: colossal sword 2H R1 HA frames 7–25 (hit frames 17–20); Thundercloud Form (Dragon King's Cragblade) SA frames 9–92.
- HA strength (planner attack data `ha` block): `damageMultiplier`, `poiseContribution`, `poiseDamageMultiplier`, `armourPoiseContribution`.
  Planner's effective HA poise (code) **[D]**: `(armourPoise × armourPoiseContribution + poiseContribution) × poiseMultipliers / poiseDamageMultiplier`.
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
