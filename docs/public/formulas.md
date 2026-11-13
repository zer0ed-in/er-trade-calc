# How er-trade-calc calculates a trade

This is the public guide to every formula the calculator uses, written for players. Each formula is shown as an equation with every
term labelled, followed by what it means in the game. Where a number comes from Emilia's planner and has been checked against it,
it says so. Where we're still relying on an assumption, it says that too.

> **Status: draft.** Sections marked ✅ are checked against Emilia's ER Build Planner. Sections marked ⚠️ depend on an assumption
> (listed at the end) that hasn't been confirmed yet.

> ⚠ **Projectile damage uses an unverified formula (A3).** Skill projectiles (wind, waves, shockwaves) are calculated with the formula in
> section 3, which hasn't been checked in-game yet. Every result that uses it shows this warning. Normal attacks and weapon swings don't.

---

## 1. One hit, in one line ✅

Everything is built from single hits. An R1 is one hit; Spinning Slash is several; Storm Blade is a blade hit plus a wind hit.
Each hit is calculated **separately for each damage type** (physical, magic, fire, lightning, holy), and the results are added up.

$$
\text{Damage} \;=\; \left\lfloor\; \sum_{\text{type}} \;
\underbrace{A_t}_{\text{attack value}} \times
\underbrace{f\!\left(\tfrac{A_t}{D_t}\right)}_{\text{defence curve}} \times
\underbrace{(1-N_t)}_{\text{negation}} \times
\underbrace{R_t}_{\text{PvP rate}}
\;\right\rfloor
$$

- **Attack value** — how hard this hit is for this damage type (section 4).
- **Defence curve** — how much the defender's defence stat cuts it (sections 5–6).
- **Negation** — the % your armour and effects absorb (section 7).
- **PvP rate** — a per-attack multiplier the game applies in PvP (section 8).
- ⌊ ⌋ means round down. The game shows whole numbers.

Why per type matters: a holy hit is cut by holy defence, a physical hit by physical defence. Mixing them into one number gives wrong answers.

---

## 2. Attack rating (AR) ✅

AR is the number on your weapon's status screen, split by damage type.

$$
AR_t \;=\; \underbrace{B_t}_{\text{base at +25/+10}} \;+\; \sum_{\text{stat}} \;
\underbrace{B_t}_{\text{base}} \times
\underbrace{k_{t,\text{stat}}}_{\text{scaling letter}} \times
\underbrace{C(\text{stat})}_{\text{stat curve}}
$$

- **Base** — the weapon's damage of that type at full upgrade, after infusion.
- **Scaling** — the S/A/B/C/D/E letter, as a number. Infusions change it (Heavy moves scaling to str, Keen to dex, Sacred adds faith-scaled holy).
- **Stat curve** — how much of your stat counts. It flattens past the soft caps (e.g. str past 80).

**Two-handing:** when you two-hand, your strength counts as 1.5× (rounded down) for this weapon. Dexterity doesn't change.

$$
\text{Str}_{\text{2H}} = \left\lfloor 1.5 \times \text{Str} \right\rfloor
$$

So 54 str two-handed counts as 81, already past the 80 soft cap — which is why extra str after ~54 adds little damage when two-handing.

**Not every attack gets it.** The game data has a per-attack switch that turns the bonus off. Every ash of war has it switched off,
and so do backstabs/ripostes and some normal attacks (e.g. Barbaric Roar R2s, the Lizard Greatsword and Bloodfiend's Arm charged R2s,
Serpent Flail R2s). We read the switch for each hit, from the attack row the game actually uses: an attack's hit points to a behavior
row, which points either straight to an attack row or to a projectile that names one. Emilia's planner applies the bonus to these attacks,
so results there are marked "game data, differs from planner". Paired weapons (fists, claws, backhand blades…) never get the bonus.
Only one hit has no attack row (Blasphemous Blade's Taker's Flames); two-handed, it is "not supported".

**Requirements.** If you don't meet a weapon's stat requirement, the game cuts that weapon's AR by 40% and drops the scaling. The calculator
does the same and warns you.

---

## 3. Flat additions: greases and weapon buffs ✅

Greases and buffs like Sacred Blade or Lightning Slash **add a fixed amount** to one damage type.

Greases only go on **Standard, Heavy or Keen** weapons (checked in-game); the calculator refuses a grease on any other infusion.
Weapon-art buffs like Sacred Blade aren't greases and aren't limited this way.

$$
AR'_t = AR_t + \underbrace{F_t}_{\text{flat buff}}
$$

The same +90 holy is worth very different amounts depending on the weapon (section 9 shows why).

### Skill projectiles ⚠️ (assumption A3)
> ⚠ Projectile damage uses an unverified formula (A3). An in-game test against a friend's build is planned to confirm or correct it.

Some skill hits (Storm Blade's wind, Beast's Roar's shockwave, Sacred Blade's golden wave) carry their own fixed damage. We use:

$$
P_t \;=\; \underbrace{F_t}_{\text{skill's own damage}} \times
\underbrace{U}_{\text{upgrade multiplier}} \times
\Big(1 + \sum_{\text{stat}} \underbrace{o_{\text{stat}}}_{\text{skill's rate}} \times \underbrace{c_{\text{stat}}}_{\text{upgrade scaling}} \times \underbrace{C(\text{stat})}_{\text{stat curve}}\Big)
$$

- **Skill's rate** — fixed per skill (e.g. Storm Blade wind: 0.15 str + 0.15 dex).
- **Upgrade multiplier / upgrade scaling** — from the weapon's upgrade table at +25 (e.g. damage ×2.45, str scaling ×1.5).
- **Stat curve** — the weapon's curve for that damage type at your stat. Two-handing never counts here.

Which stats count is decided by the skill itself, not your infusion:

| Skill hit | Scales with |
|---|---|
| Beast's Roar shockwave | dexterity only |
| Storm Blade wind | strength + dexterity |
| Ground Slam | strength only |
| Sacred Blade wave | faith only |
| Lightning Slash bolt | dexterity only |

The stat list is confirmed from the game data; the exact formula above is still an assumption.

Each skill hit's fixed damage and scaling table come from the attack row found the same way (behavior → attack row, or behavior →
projectile → attack row). Example: Ice Spear's projectile is 230 magic with the dex + int table. A hit that still has no row would be shown
as **unknown**, never guessed.

**Lightning Slash** adds +85 lightning for 40 s (game data: its effect rows in regulation.bin).
Buffs and greases add to the weapon's own hits (the ones with a motion value), not to a skill's separate projectile.

### Ashes of war ignore two-handing ✅
No ash of war gets the two-handed strength bonus — not the projectiles and not the weapon swings. This is set in the game data for every ash we checked,
and in-game tests showed identical damage one-handed and two-handed for every ash and infusion tried.

---

## 4. Motion value → attack value ✅

Every attack has a **motion value (MV)**: a % of your AR that the attack uses. A Shamshir 1H R1 is 100%; its 2H R1 is 103%.

$$
A_t \;=\; \underbrace{AR'_t}_{\text{AR with buffs}} \times \frac{\underbrace{MV_t}_{\text{motion value}}}{100} \times
\underbrace{M}_{\text{attack effects}}
$$

- **Attack effects** — multipliers like Ritual Sword (+10% only while you're at full HP). These come from the game's effect data.

---

## 5. Defence ✅

Each damage type has its own defence stat. All of them grow with your rune level; some also grow with one attribute.

$$
D_t \;=\; \underbrace{\big\lfloor L(\text{RL}) \big\rfloor}_{\text{level part}} + \underbrace{\big\lfloor S_t(\text{stat}) \big\rfloor}_{\text{attribute part}}
$$

| Defence | Attribute part comes from |
|---|---|
| Physical (and slash/strike/pierce) | Strength |
| Magic | Intelligence |
| Fire | Vigor |
| Lightning | **Nothing** — level only |
| Holy | Arcane |

Level part (rune level 92–160, where ladder builds sit):

$$
L(\text{RL}) = 120 + \frac{\text{RL} - 91}{4.667}
$$

Strength part:

$$
S_{\text{phys}}(s) =
\begin{cases}
s/3 & s < 30\\
10 + (s-30)/2 & 30 \le s < 40\\
15 + (s-40)/1.333 & 40 \le s < 60\\
30 + (s-60)/3.9 & s \ge 60
\end{cases}
$$

Each part is rounded down **separately**, then added. Example: RL 125, 15 str → 127 + 5 = **132**. RL 125, 59 str → 127 + 29 = **156**. That 24-point gap is strength's built-in defence advantage.
(Rounding the sum instead gives a value 1 too high at e.g. RL 123 with 57 str: 126.86 + 27.75 → the planner shows 153, not 154.)

---

## 6. The defence curve ✅

Defence doesn't subtract a fixed amount. What matters is the **ratio** of attack to defence. Big hits lose a smaller share; small hits lose a bigger one.

$$
r = \frac{A_t}{D_t}, \qquad
f(r) =
\begin{cases}
0.90 & r \ge 8\\[2pt]
0.90 - 0.20\left(\dfrac{8-r}{5.5}\right)^{2} & 2.5 < r < 8\\[6pt]
0.70 - 0.30\left(\dfrac{2.5-r}{1.5}\right)^{2} & 1 \le r \le 2.5\\[6pt]
0.10 + 0.30\left(\dfrac{r-0.12}{0.88}\right)^{2} & 0.12 < r < 1\\[6pt]
0.10 & r \le 0.12
\end{cases}
$$

- At best (huge hit vs low defence) you keep **90%** before negation.
- At worst (tiny hit vs high defence) you keep **10%**.

---

## 7. Negation ✅

Negation is the % your gear absorbs. Armour negation depends on the hit's **physical type** — slash, strike, pierce or standard —
so the same armour can be weaker against a strike than a slash.

Several sources multiply, they don't add:

$$
N_t \;=\; 1 - \prod_{i} \big(1 - \underbrace{n_{t,i}}_{\text{each source}}\big)
$$

Two 10% sources give 19%, not 20%. Sources include each armour piece, Ritual Shield (only at full HP) and Opaline Hardtear (10% in PvP).

Talisman and tear values come from Emilia's planner effect tables, using their **PvP** values. They're written as a boost to
negation: Ritual Shield "×1.3" means you take ×0.7 damage, Opaline Hardtear's PvP "×1.1" means ×0.9:

$$
1 - N_t = \underbrace{\prod_{\text{armour}} (1 - n_{t,i})}_{\text{armour}} \times \prod_{\text{effects}} \big(2 - \underbrace{v_j}_{\text{effect value}}\big) \; - \; \frac{\underbrace{p_t}_{\text{flat points}}}{100}
$$

Flat points are things like the counter-hit penalty (section 13).

---

## 8. PvP rate ✅

The game applies a final multiplier per attack in PvP. Normal attacks are 100%. **Most weapon skills are 80% in PvP** (some 70%).

---

## 9. Worked example ✅ (matches the planner exactly)

Heavy Shamshir, 59 str, two-handed R1, into a 15-str build at RL 125 in full Verdigris.

| Step | Value |
|---|---|
| AR (2H, 59 str counts as 88) | 548.5 physical |
| × motion value 103% | **A = 564.96** |
| Defender physical defence (RL 125, 15 str) | **D = 132** |
| Ratio r = 564.96 / 132 | 4.28 |
| Curve f(4.28) = 0.90 − 0.20 × ((8 − 4.28)/5.5)² | 0.8085 |
| Slash negation (full Verdigris) | 37.278% → × 0.62722 |
| 564.96 × 0.8085 × 0.62722 | 286.5 |
| Round down | **286** ✅ |

### Why the same buff helps some builds more (calculator result, not checked in the planner)
Sacred Blade adds +90 holy. Builds: Heavy Knight, 60 vig / 39 end, Verdigris with Steel Gauntlets, 2H R1, into a 53-faith Sacred build (holy defence 145).

| Attacker | No buff | + Sacred Blade | Holy share |
|---|---|---|---|
| **Heavy** Shamshir, 60 str | 285 | **299 (+14)** | 92.7 / 145 → ratio 0.64 → curve keeps 20% |
| **Sacred** Shamshir, 53 faith | 300 | **365 (+65)** | 491.8 / 145 → ratio 3.39 → curve keeps 76% |

On the Heavy Shamshir the +90 is the only holy damage, so the curve cuts it hard. On the Sacred Shamshir it joins ~400 holy already there.
Same buff, five times the value — purely because each damage type goes through the curve on its own.

---

## 10. Hits to kill ✅

$$
\text{HTK} = \min\Big\{\, n \;:\; \sum_{i=1}^{n} \text{Damage}_i \ge \text{HP} \,\Big\}
$$

Hits are applied in order, because some effects change after the first hit: Ritual Sword and Ritual Shield only work at full HP,
so they apply to the first hit of a duel and not the second.

**Crimson Bubbletear** (legal on the ladder) heals once, 30% of max HP, the first time HP drops below 21% — so it can add a hit to kill.
Example: 286 per hit into 1900 HP is 7 hits; with Bubbletear it's ⌈(1900 + 570) / 286⌉ = 9.

---

## 11. Poise and stagger ✅

**Poise damage of a hit** (PvP, in the units the game menu shows) comes from the hit's attack row and the weapon:

$$
\text{PD} = \big(\underbrace{a}_{\text{hit's flat poise}} + \underbrace{w}_{\text{weapon poise base}} \times \underbrace{c}_{\text{hit's poise MV}} / 100\big) \times \underbrace{r}_{\text{PvP poise rate}} \times 10
$$

The PvP rate is 2.2 for normal attacks and 2.7 for skills (it differs on some weapons). Examples: Shamshir 1H R1 = (0 + 5 × 100/100) × 2.2 × 10 = **110**;
2H R1 = **143**; Lion's Claw on a Knight's Greatsword = 5.5 × 600/100 = 33 → **891**. Skill hits with their own flat poise count it too:
Beast's Roar does 6 × 2.7 × 10 = **162** per hit (Emilia's planner shows 0 for these). Kick: hit 1 = 6 × 2.7 × 10 = **162**, hit 2 = half the weapon's poise base.

**Poise over time.** Each hit lowers your current poise ("chip"). The hit that brings it to 0 or below staggers you (110 damage breaks
110 poise; 111 survives). Your poise refills to full **30 s** after the last hit you took (game values: 30 s × 1.0). After a break it
goes back to full ⚠️ (assumption A12: community knowledge, not in the game tables).

**Your poise** is the sum of your armour's poise times talisman effects (Bull-Goat's Talisman ×1.33). At 40 endurance with a Shamshir
at medium load, the best legal set is Verdigris with Steel Gauntlets: 100 × 1.33 = **133** — the ladder maximum (computed from the armour data).

**Multi-hit attacks:** to tank hit *k* you must stay standing after hits 1…*k*, so you need more poise than their total poise damage.

### Hyper armour (HA) and super armour (SA)
During certain frames of some attacks, your poise is boosted (HA) or you can't be staggered at all (SA). The frames come from the game's
animation data; each HA window names a row of the game's hyper-armour table, which sets how strong it is:

$$
P_{\text{max}} = \big(\underbrace{P}_{\text{armour poise}} \times \underbrace{c_a}_{\text{armour share}} + \underbrace{T}_{\text{weapon toughness}} \times \underbrace{c_w}_{\text{weapon share}}\big) \times \underbrace{m}_{\text{poise effects}}
$$

At the start of the window your current poise is **raised to the window's minimum** if it is lower. That's why moves like Kick or
Storm Stomp "reset" your poise: Storm Stomp's minimum is 300, so it starts at 300 poise even if you were nearly broken. Incoming
poise damage during HA is multiplied by the window's rate (e.g. ×0.5), and HP damage by its own rate (e.g. ×0.925).
For windows without the "minimum isn't scaled" switch we assume the minimum is scaled like the weapon toughness ⚠️ (assumption A13).
If an attack's HA window names no row, the calculator says "not supported".

### Hitstun
Each hit has a stagger level (the game's damage level against players): 1 short, 2 moderate, 3 long, 4 knockback, 5 push + long stagger,
6 faceplant, 7 knockdown, 8 very short, 9 launch, 10 knockdown, 11 knockback + down (names from wiki.gg). The calculator reports the
level; how long the stagger lasts needs the reaction animations and is **not supported** yet.

**Stamina damage if blocked** is reported where the hit's row has its own value (e.g. Kick: 999, a guard break). Blocking itself isn't modelled.

---

## 12. Who hits first: trades ✅

$$
t_{\text{hit}} = \underbrace{s}_{\text{startup frame}} + \underbrace{\delta}_{\text{input delay}} + \underbrace{o}_{\text{offset}}
$$

- **Startup** — the frame the attack becomes active, from the animation data (already adjusted for animation speed changes). The planner shows this number + 1 because it counts the first frame as frame 1.
- **Input delay** — a setting per player, default **0**. It's only ever *added*; it never scales anything.
- **Offset** — how many frames later one player pressed the button.

The earlier hit lands first. If it staggers the other player before their own hit becomes active, **there's no trade**. Otherwise both land: **a trade**.

---

## 13. Counter hits ⚠️ (assumption A4)

If you're hit while your own attack is in its counter window (from the animation data), you lose **15 points of pierce negation** in PvP,
the way Emilia's planner models it — so the penalty grows with your pierce negation. Only pierce damage is affected; slash, strike and
elemental damage get no counter bonus.

$$
1 - N_{\text{pierce}} \;\to\; (1 - N_{\text{pierce}}) + 0.15
$$

The game's own "Counter Frames" effect lists pierce damage ×1.15; which model is right in PvP isn't settled yet, so this is an assumption
(the other model is one switch away).

The data settles who it applies to: SpEffect #45 "[HKS] Counter Frames" is part of every attack's animation, not tied to any talisman,
and its only value is pierce ×1.15 — so it's pierce hits only, the physical part only, any infusion, somber weapons included, with the
Spear Talisman stacking on top. The engine already does this; only the size (−15 points vs ×1.15) and the talisman stacking stay A4.

---

## 14. Rune level ✅

$$
\text{RL} = \underbrace{\ell_{\text{class}}}_{\text{class level}} + \sum_{\text{stats}} \big(\underbrace{x}_{\text{your stat}} - \underbrace{x_0}_{\text{class base}}\big)
$$

For Heavy Knight, that's simply **RL = (sum of all eight stats) − 79**.

---

## 15. HP, equip load and status ✅

- **HP** comes from vigor through the game's HP curve: 60 vigor = **1900 HP**.
- **Equip load:** your maximum load comes from endurance (40 end = **90.9**). Medium roll is under 70%; light load (≤ 30%) is banned on the ladder.
- **Status buildup** (bleed, frost …) per hit = the weapon's status value × the attack's status rate, plus grease buildup. It procs when the total
  reaches your resistance (robustness for bleed and frost), which comes from your level, a stat, your armour, and resistance effects on
  your gear at their own value (Divine Bird Helm: Focus −45. The planner doubles this to −90; in-game the helm lowers Focus by 43,
  because its +3 str / +4 dex raise your level-based focus by about 2).
  Proc damage (planner formulas): bleed 15% max HP + 100, frostbite 10% max HP + 30, madness 15% max HP + 100. Buildup decay isn't modelled.

---

## Assumptions still open

| ID | What we assume | Why it matters |
|---|---|---|
| A3 | Exact skill projectile damage formula (section 3) — which stats count is confirmed | Storm Blade wind, Beast's Roar, Sacred Blade wave |
| A4 | Counter hits: −15 points of pierce negation (planner) vs pierce ×1.15 (game effect); Spear Talisman stacking | Pierce counter hits only |
| A12 | Poise goes back to full after a break | Poise across several hits |
| A13 | Hyper-armour minimum is scaled by weapon toughness when the row doesn't say otherwise | HA windows of normal attacks |

Confirmed since the first draft: frame numbers already include animation speed changes; the planner's "+1" on startup is a counting setting;
defence parts are rounded down separately (section 5); the ladder poise maximum of 133 (section 11); two-handing per hit,
Lightning Slash's value, and Kick's damage and poise now come from the game data (regulation.bin 1.17.3). Kick's timing isn't in the
animation data, so trades with Kick still aren't judged.

Values for talismans, tears and greases come from Emilia's planner tables (her data copy doesn't include the raw effect rows).

---

*Data: Emilia (sovietspaceship) — [ER Build Planner](https://er-build-planner.nyasu.business) & [Frame Data Explorer](https://er-frame-data.nyasu.business).
AR calculation based on Tom Clark's [elden-ring-weapon-calculator](https://github.com/ThomasJClark/elden-ring-weapon-calculator) (MIT).*
