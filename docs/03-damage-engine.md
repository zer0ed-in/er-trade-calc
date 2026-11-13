# 03 — Damage engine

Scope: **PvP only** — both sides are player builds.

Status tags used below: **[V]** verified against Emilia's planner · **[D]** read directly from game/planner data or code · **[in-game]** Zer0's tests ·
**[W]** from wiki/community guide, needs a check · **[A#]** governed by an assumption in docs/09.

## Fundamental model
**The unit of calculation is one hit.** Every attack is an ordered list of hits. Every hit needs four inputs and one function.

### Input 1 — power per damage type (physical, magic, fire, lightning, holy)
From one of three sources, chosen by the hit's own data:
- **Weapon-based** (most attacks): attacker effective stats → weapon + infusion + upgrade → AR per type. Plus flat buffs (grease, AoW buff) added to one type. **[V]**
- **Projectile / skill flat damage**: the hit carries its own flat value per type. Scaling rule is **[A3]**.
- **Spell-scaled** (incantations/sorceries, phase 1 only if trivial): planner formula `flat × (1 + Σ spellBuff stat corrections)` **[D, planner code `spellAR`]**.

### Input 2 — the hit's definition (from attack data) **[D]**
Per hit: motion value per type, flat damage per type, physical attribute (Standard/Slash/Strike/Pierce), poise damage (flat),
damage level (stagger), status buildup per type, PvP final damage rate per type, stamina cost, startup, behaviour/category.

### Input 3 — modifiers with conditions
- Attacker side: talisman/effect attack multipliers (e.g. Ritual Sword at full HP), counter-hit bonus (effect #45: defender takes ×1.15 pierce damage during counter frames) **[D]**, applicability details **[A4]**, PvP final rate per attack **[D]**.
- Defender side: armour negation for the hit's physical attribute, plus other negations (Ritual Shield at full HP, Opaline Hardtear PvP value).
- **All talisman/tear/effect values come from the effect data (SpEffect), not from wiki numbers.** Wiki numbers are only cross-checks.
- Conditions are evaluated against duel state (HP %, "is skill", "is counter-hit window", etc.).

### Input 4 — the defender
Defence per type (RL + stat), negation per type, HP, poise.

### The function (per damage type t, then sum)
```
A_t = (AR_t + Flat_t) × MV_t/100 × Π(attacker multipliers)
d_t = A_t × curve(A_t / D_t) × (1 − armour_t) × Π(1 − other negations_t) × FinalRate_t
damage = floor( Σ_t d_t )
```
**[V]** reproduces all planner-verified numbers in fixtures/golden (exact integers).

## Rules confirmed so far
1. **Damage types are calculated separately and summed.** **[V]** (planner `finalDamage` does exactly this) — never treat AR as one number.
2. **Defence curve** (r = A/D), planner code `adjustForDefense` **[D]**, matches **[V]**:
   - r ≥ 8 → ×0.90
   - 2.5 < r < 8 → ×(0.9 − 0.2·((8 − r)/5.5)²)
   - 1 ≤ r ≤ 2.5 → ×(0.7 − 0.3·((2.5 − r)/1.5)²)
   - 0.12 < r < 1 → ×(0.1 + 0.3·((r − 0.12)/0.88)²)
   - r ≤ 0.12 → ×0.10
3. **Physical defence** = level part + strength part **[V]** (all 16 RL sweep points):
   - level part: RL<72: 40+(RL+78)/2.483 · 72≤RL<92: 29+RL · 92≤RL<161: 120+(RL−91)/4.667 · RL≥161: 135+(RL−161)/27.6
   - str part: S<30: S/3 · 30≤S<40: 10+(S−30)/2 · 40≤S<60: 15+(S−40)/1.333 · S≥60: 30+(S−60)/3.9
   - **floor each part, then add** (planner `getCorrectionGraphValueAtInt` floors each graph value). Flooring the sum is wrong on 7 of the 66 planner probes (e.g. RL 123, 57 str: 126.86 + 27.75 → 153, not 154). Slash/strike/pierce defence = physical defence.
   - The level part is the planner's CalcCorrectGraph 102 indexed by the **sum of the eight stats** (= RL + 79 for every class); str/int/vig/arc parts are graphs 130/132/133/135.
4. **Elemental defences** (checked live in planner by varying stats; see fixtures/golden/defences.json) **[V/D]**:
   - magic = level part + int part; holy = level part + arcane part (int/arcane part: <20: 2x · 20–35: 40+(x−20)/1.5 · 35–60: 50+(x−35)/2.5 · ≥60: 60+(x−60)/3.9) **[V]**
   - fire = level part + **vigor** part, with its **own curve** (not the int/arc one). Read the curve from the planner's correction-graph data **[D]**.
   - lightning = level part **only** (endurance adds nothing) **[V]**.
   - Prefer reading all defence curves from data (CalcCorrectGraph via Emilia's data) over hard-coding; golden tests guard either way.
5. **Two-handing**: effective str = floor(str × 1.5) (Tom Clark: `Math.floor(attributes.str * 1.5)`) **[D]**. Scaling curves top out at 99 —
   confirm the cap is applied by the curves and test 70 str 2H. Some attacks disable the 2H bonus (AtkParam `isDisableBothHandsAtkBonus`) **[D]**.
   Two-handing also counts for meeting str requirements.
6. **Motion values come per attack.** Example **[V]**: Shamshir 1H R1 1 MV 100, 2H R1 1 MV 103. The planner's damage table "Physical" column shows AR × MV/100 (2H: 564 = 548.5 × 1.03).
7. **PvP final damage rate per attack** (`*DamageRateFinal` in attack data) **[D]**: R1s 1.0; weapon skills typically 0.8 (some 0.7). Applied per type, after defence.
8. **Negations stack multiplicatively**: total = 1 − Π(1 − nᵢ) **[V for armour pieces]**. Armour negation uses the hit's physical attribute (slash/strike/pierce/standard).
9. **Flat buffs** add AR to one damage type (greases and most AoW buffs apply to the **right-hand weapon only**) **[W, confirm in data]**.
   Because of rule 1, a lone flat element is cut hard by its own defence; stacked on an existing element it barely is.
10. **AoW buffs can apply to elementally infused weapons** (e.g. Sacred Blade on Sacred, Lightning Slash on Lightning) **[W, Fextralife]**; greases cannot buff elemental infusions **[W]** — confirm "can be buffed" from weapon data (planner shows "Can be buffed").
11a. **Ashes of war ignore two-handing.** Every AoW hit checked has `isDisableBothHandsAtkBonus = 1` (Storm Blade blade + wind, Beast's Roar, Ground Slam, Stamp, Lightning Slash, Sacred Blade) **[D]**, and Zer0's tests show identical damage 1H vs 2H for every ash and infusion **[in-game]**. Read the flag per hit; never assume.
11b. **Skill hit scaling tables.** A skill hit's `overwriteAttackElementCorrectId` picks which stats scale it, with fixed override rates: 51010 str 0.25 · 51020 dex 0.25 (Beast's Roar) · 51030 str 0.15 + dex 0.15 (Storm Blade wind) · 51070 faith 0.25 (Sacred Blade wave) **[D, planner correction-attack]**. Exact damage formula **[A3]**.
11. **Multi-hit and partial attacks**: an attack's hits are listed in data (e.g. Storm Blade: blade hit MV 65 Slash + wind hit flat 150 physical Standard). Users choose which hits landed (all / first / any subset). Totals are the plain sum of hits (in-game: Ice Spear 402 + 844 = 1246) **[D + in-game]**.
12. **Status buildup** (bleed etc.) per hit from attack data × weapon status; proc damage from effect data (`changeHpRate` % max HP + `changeHpPoint`). Phase 1: compute buildup and proc damage; show hits-to-proc. **[D for locations]**
13. **Hits to kill**: apply hits in order with duel state updating conditions between hits (e.g. full-HP effects turn off after the first hit taken). **Not** HP ÷ one number.
    Include **Crimson Bubbletear** when equipped (legal on ladder): one heal when HP drops low, values from effect data. Tick-based regen is banned, so not modelled by default.
14. **Equip load**: medium roll < 70% **[W]**. Load from endurance via data curve; one checkpoint **[V]**: 40 end → 90.9 max load (Verdigris set + Shamshir 65.1 = 71.6%). Talisman load multipliers from effect data.
15. **RL arithmetic**: RL = class level + Σ(stat − class base). Heavy Knight base: vig 14, mnd 8, end 17, str 15, dex 11, int 7, fth 8, arc 9; for HK, RL = Σ stats − 79 **[V]**.
16. **Weapons**: +25 (regular) or +10 (somber) only. Reject other levels with a clear error.

## Scenario presets (named, user can override any part)
- `base` — armour only, no talismans, no buffs.
- `duel-start` — both at full HP: build's opening talismans active (e.g. Ritual Sword, Ritual Shield), tears active (e.g. Opaline Hardtear).
- `low-hp` — defensive swap set, full-HP effects off.
- Buff flags: `--buff "Sacred Blade"`, `--grease "Drawstring Dragonbolt Grease"`. Legality checked against the ruleset.

## Breakdown output (required for every result)
AR per type (and where it came from) → flat adds → MV → attacker multipliers → defence & ratio → curve factor → negation → final rate → per-type damage → total.
Plus: assumptions used, data patch, credit footer.
