// Trade resolution (docs/04): who lands first, does it stagger the other before their hit, counter hits, HA/SA.
import { ASSUMPTIONS, type AssumptionId } from "../assumptions.ts";
import { KICK_NOT_SUPPORTED, resolveAttack, type AttackChoice, type ResolvedAttack } from "../attacks/attacks.ts";
import { resultMeta } from "../explain/explain.ts";
import type { GameData } from "../game-data.ts";
import type { HitSituation } from "../hit/hit.ts";
import { EngineError, NotSupportedError, type ResultMeta } from "../types.ts";
import { computeAttack, type AttackResult } from "../duel/attack-result.ts";
import type { Fighter } from "../duel/fighter.ts";
import { hitsToKill, type HitsToKill } from "../duel/htk.ts";

export const COUNTER_FRAMES_SPEFFECT = 45; // SpEffect #45 "[HKS] Counter Frames"

export interface TradeOptions {
  /** B starts this many frames after A (negative = B first). Default 0. */
  offset?: number;
  /** Additive input delay per player, frames (A7: default 0, never multiplied). */
  inputDelayA?: number;
  inputDelayB?: number;
  /** Poise damage each player has already taken (default 0; no regen timers in phase 1). */
  poiseTakenA?: number;
  poiseTakenB?: number;
}

export type PoiseState =
  | { kind: "normal"; poise: number }
  | { kind: "hyper-armour"; poise: number; damageMultiplier: number; formula: string }
  | { kind: "super-armour" }
  | { kind: "unknown"; reason: string };

export interface SideTiming {
  /** First landed hit's data frame index (A2: planner shows +1). */
  startupFrame: number;
  inputDelay: number;
  offset: number;
  /** Global frame the first hit lands: startup + input delay + offset. */
  hitFrame: number;
}

export interface SideOutcome {
  label: string;
  attack: string;
  timing: SideTiming;
  landed: boolean;
  /** This side's poise state at the moment the other's first hit lands (if it does). */
  poiseWhenHit: PoiseState | null;
  /** Poise damage this side's first hit deals. */
  poiseDamageDealt: number;
  staggeredOther: boolean;
  counterHitOnOther: boolean;
  damage: AttackResult | null;
  hitsToKill: HitsToKill | null;
  /** Poise needed to tank each follow-up hit of this side's attack (hit 2, 3, …). */
  poiseToTankFollowUps: { hit: number; poiseNeeded: number }[];
}

export type Verdict =
  | { kind: "trade"; summary: string }
  | { kind: "no-trade"; winner: "A" | "B"; summary: string }
  | { kind: "unknown"; reason: string };

export interface TradeResult {
  verdict: Verdict;
  a: SideOutcome;
  b: SideOutcome;
  caveats: string[];
  meta: ResultMeta;
}

function validateFrames(name: string, v: number | undefined): number {
  const x = v ?? ASSUMPTIONS.A7.choice.defaultFrames;
  if (!Number.isInteger(x)) throw new EngineError(`${name} must be a whole number of frames (got ${v}).`, "invalid-option");
  return x;
}

/** Poise state of `fighter` at its own animation frame `frame` of `attack` (frame < 0 = not started yet: plain poise). */
export function poiseAtFrame(data: GameData, fighter: Fighter, attack: ResolvedAttack, frame: number, poiseTaken: number): PoiseState {
  const plain: PoiseState = { kind: "normal", poise: fighter.poise.total - poiseTaken };
  if (frame < 0) return plain;
  const anim = data.animations.get(attack.entry.filename);
  if (!anim) return { kind: "unknown", reason: `no animation data for ${attack.entry.filename}` };
  const window = anim.hyperArmour.find((w) => frame >= w.range[0] && frame <= w.range[1]);
  if (!window) return plain;
  if (window.super) return { kind: "super-armour" };
  const ha = attack.entry.ha;
  if (!ha) return { kind: "unknown", reason: `${attack.name} has a hyper-armour window at frames ${window.range.join("–")} but no HA strength data` };
  // planner (router) effective HA poise: (armourPoise × armourPoiseContribution + poiseContribution) × poiseMultipliers / poiseDamageMultiplier
  const poise = ((fighter.poise.armour * ha.armourPoiseContribution + ha.poiseContribution) * fighter.poise.multiplier) / ha.poiseDamageMultiplier - poiseTaken;
  return {
    kind: "hyper-armour",
    poise,
    damageMultiplier: ha.damageMultiplier,
    formula: `(${fighter.poise.armour} × ${ha.armourPoiseContribution} + ${ha.poiseContribution}) × ${fighter.poise.multiplier} / ${ha.poiseDamageMultiplier}${poiseTaken ? ` − ${poiseTaken} taken` : ""}`,
  };
}

export function inCounterWindow(data: GameData, attack: ResolvedAttack, frame: number): boolean {
  if (frame < 0) return false;
  const anim = data.animations.get(attack.entry.filename);
  return !!anim?.spEffects.some((s) => s.id === COUNTER_FRAMES_SPEFFECT && frame >= s.range[0] && frame <= s.range[1]);
}

/** Stagger at ≥ (planner: 110 breaks 110, survives at 111). */
export const breaksPoise = (poiseDamage: number, state: PoiseState): boolean | null =>
  state.kind === "super-armour" ? false : state.kind === "unknown" ? null : poiseDamage >= state.poise;

export function poiseToTankFollowUps(attack: ResolvedAttack): { hit: number; poiseNeeded: number }[] {
  const out: { hit: number; poiseNeeded: number }[] = [];
  // To tank hit k you must stay standing after hits 1..k: poise > Σ poise damage (stagger at ≥).
  let cumulative = 0;
  attack.hits.forEach((h, i) => {
    cumulative += h.poiseDamage;
    if (i > 0) out.push({ hit: h.index, poiseNeeded: Math.floor(cumulative) + 1 });
  });
  return out;
}

export function computeTrade(data: GameData, a: Fighter, b: Fighter, choiceA: AttackChoice, choiceB: AttackChoice, opts: TradeOptions = {}): TradeResult {
  const atkA = resolveAttack(data, a.build, choiceA);
  const atkB = resolveAttack(data, b.build, choiceB);
  if (!atkA.hits.length || !atkB.hits.length) throw new EngineError("Each attack needs at least one landed hit.", "invalid-hits");
  // A verdict needs both sides' timing and poise damage; Kick has neither in the data (A10).
  if ([...atkA.hits, ...atkB.hits].some((h) => h.poiseAndTimingUnknown)) throw new NotSupportedError(...KICK_NOT_SUPPORTED);
  const offset = validateFrames("offset", opts.offset);
  const delayA = validateFrames("input delay A", opts.inputDelayA);
  const delayB = validateFrames("input delay B", opts.inputDelayB);
  const takenA = opts.poiseTakenA ?? 0;
  const takenB = opts.poiseTakenB ?? 0;
  if (takenA < 0 || takenB < 0) throw new EngineError("Poise taken can't be negative.", "invalid-option");

  // A7: input delay is additive frames only. The B side's animation starts at offset + delayB.
  const startA = delayA;
  const startB = offset + delayB;
  const tA = atkA.hits[0]!.startup + startA;
  const tB = atkB.hits[0]!.startup + startB;
  const timing = (atk: ResolvedAttack, delay: number, off: number, t: number): SideTiming => ({ startupFrame: atk.hits[0]!.startup, inputDelay: delay, offset: off, hitFrame: t });

  // State of each side when the other's first hit lands (frames are already speed-adjusted, A1).
  const bFrameWhenAHits = tA - startB;
  const aFrameWhenBHits = tB - startA;
  const bPoise = poiseAtFrame(data, b, atkB, bFrameWhenAHits, takenB);
  const aPoise = poiseAtFrame(data, a, atkA, aFrameWhenBHits, takenA);
  const aStaggersB = breaksPoise(atkA.hits[0]!.poiseDamage, bPoise);
  const bStaggersA = breaksPoise(atkB.hits[0]!.poiseDamage, aPoise);

  let verdict: Verdict;
  let aLands = true;
  let bLands = true;
  if (tA < tB) {
    if (aStaggersB === null) verdict = { kind: "unknown", reason: (bPoise as { reason: string }).reason };
    else if (aStaggersB) { bLands = false; verdict = { kind: "no-trade", winner: "A", summary: `A hits first (frame ${tA} vs ${tB}) and breaks B's poise before B's hit — no trade, A wins.` }; }
    else verdict = { kind: "trade", summary: `A hits first (frame ${tA} vs ${tB}) but doesn't stagger B — both land.` };
  } else if (tB < tA) {
    if (bStaggersA === null) verdict = { kind: "unknown", reason: (aPoise as { reason: string }).reason };
    else if (bStaggersA) { aLands = false; verdict = { kind: "no-trade", winner: "B", summary: `B hits first (frame ${tB} vs ${tA}) and breaks A's poise before A's hit — no trade, B wins.` }; }
    else verdict = { kind: "trade", summary: `B hits first (frame ${tB} vs ${tA}) but doesn't stagger A — both land.` };
  } else verdict = { kind: "trade", summary: `Both hit on frame ${tA} — simultaneous trade.` };

  const counterOnB = inCounterWindow(data, atkB, bFrameWhenAHits);
  const counterOnA = inCounterWindow(data, atkA, aFrameWhenBHits);
  const situation = (atk: Fighter, def: Fighter, counter: boolean, defState: PoiseState): HitSituation => ({
    attackerHpFraction: atk.startHpFraction,
    defenderHpFraction: def.startHpFraction,
    counterHit: counter,
    defenderDamageMultiplier: defState.kind === "hyper-armour" ? defState.damageMultiplier : 1,
  });
  const used = new Set<AssumptionId>();
  const dmgA = aLands ? computeAttack(data, a, atkA, b, situation(a, b, counterOnB, bPoise)) : null;
  const dmgB = bLands ? computeAttack(data, b, atkB, a, situation(b, a, counterOnA, aPoise)) : null;
  dmgA?.assumptionsUsed.forEach((x) => used.add(x));
  dmgB?.assumptionsUsed.forEach((x) => used.add(x));
  const htkA = hitsToKill(data, a, atkA, b);
  const htkB = hitsToKill(data, b, atkB, a);
  htkA.assumptionsUsed.forEach((x) => used.add(x));
  htkB.assumptionsUsed.forEach((x) => used.add(x));

  if (verdict.kind === "trade" && (dmgA?.total === null || dmgB?.total === null)) {
    verdict = { ...verdict, summary: `${verdict.summary} (some hit damage is unknown — see hits)` };
  }

  const side = (f: Fighter, atk: ResolvedAttack, t: SideTiming, landed: boolean, poiseWhenHit: PoiseState | null, staggeredOther: boolean, counter: boolean, dmg: AttackResult | null, htk: HitsToKill): SideOutcome => ({
    label: f.label, attack: atk.name, timing: t, landed, poiseWhenHit, poiseDamageDealt: atk.hits[0]!.poiseDamage, staggeredOther, counterHitOnOther: counter && landed,
    damage: dmg, hitsToKill: htk, poiseToTankFollowUps: poiseToTankFollowUps(atk),
  });

  return {
    verdict,
    a: side(a, atkA, timing(atkA, delayA, 0, tA), aLands, bLands ? aPoise : null, aStaggersB === true && tA < tB, counterOnB, dmgA, htkA),
    b: side(b, atkB, timing(atkB, delayB, offset, tB), bLands, aLands ? bPoise : null, bStaggersA === true && tB < tA, counterOnA, dmgB, htkB),
    caveats: [
      "Same-frame start unless an offset is given; no latency; no distance or reach.",
      `Poise assumed fresh unless poise-taken is given (A: ${takenA}, B: ${takenB}); no poise regen modelled.`,
      "Only each side's first landed hit decides the verdict; later hits of a multi-hit attack are assumed to land.",
    ],
    meta: resultMeta(data.patch, used),
  };
}
