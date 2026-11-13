// Hits to kill, applied hit by hit with duel state (docs/03 rule 13) — not HP ÷ one number.
import type { AssumptionId } from "../assumptions.ts";
import type { ResolvedAttack } from "../attacks/attacks.ts";
import { pvpValue } from "../effects/effects.ts";
import type { GameData } from "../game-data.ts";
import { computeHit } from "../hit/hit.ts";
import { procDamage, resistances, STATUS_RESISTANCE } from "../stats/status.ts";
import type { Fighter } from "./fighter.ts";

export interface HtkStep {
  attack: number; // 1-based attack repetition
  hit: number;
  damage: number;
  hpAfter: number;
  event?: string;
}

export interface HitsToKill {
  /** Attacks (each = all landed hits) needed to kill; null if a hit's damage is unknown or it can't kill within the cap. */
  attacks: number | null;
  hits: number | null;
  steps: HtkStep[];
  startHp: number;
  notes: string[];
  assumptionsUsed: AssumptionId[];
}

const MAX_ATTACKS = 100;

/** Crimson Bubbletear (legal on ladder): one heal when HP drops below its threshold. Heal = (value − 1) × max HP (planner tearHealing = 30%). */
function bubbletear(defender: Fighter): { threshold: number; heal: number } | null {
  const fx = defender.effects.find((e) => e.kind === "tear" && e.effect.model === "max-hp" && e.effect.activation === "once");
  if (!fx) return null;
  const below = fx.effect.conditions?.map((c) => c.match(/^HP below (\d+)%$/)).find(Boolean);
  if (!below) return null;
  return { threshold: Number(below[1]) / 100, heal: Math.trunc((pvpValue(fx.effect) - 1) * defender.maxHp) };
}

/**
 * The attacker repeats `attack` into `defender` from the defender's starting HP. The attacker's own HP stays at its
 * starting fraction (the defender isn't hitting back in this count), so e.g. Ritual Sword stays on if the attacker starts at full HP.
 */
export function hitsToKill(data: GameData, attacker: Fighter, attack: ResolvedAttack, defender: Fighter, opts: { counterHit?: boolean; statusProcs?: boolean } = {}): HitsToKill {
  const startHp = Math.trunc(defender.maxHp * defender.startHpFraction);
  let hp = startHp;
  const steps: HtkStep[] = [];
  const notes: string[] = [];
  const assumptions = new Set<AssumptionId>(attack.assumptions);
  const tear = bubbletear(defender);
  let tearUsed = false;
  let hitCount = 0;
  // Optional status procs: buildup adds up per hit; a proc deals its direct damage once the defender's
  // resistance is reached, then buildup restarts. No decay and no post-proc resistance change are modelled (noted).
  const buildup: Record<string, number> = {};
  const res = opts.statusProcs ? resistances(data, defender.stats, defender.armour, defender.effects) : null;
  for (let n = 1; n <= MAX_ATTACKS; n++) {
    for (const h of attack.hits) {
      const r = computeHit(data, attacker, attack, h, defender, {
        attackerHpFraction: attacker.startHpFraction,
        defenderHpFraction: hp / defender.maxHp,
        counterHit: !!opts.counterHit && n === 1,
        defenderDamageMultiplier: 1,
      });
      r.assumptions.forEach((a) => assumptions.add(a));
      if (r.damage === null) return { attacks: null, hits: null, steps, startHp, notes: [...notes, `hit ${h.index} damage unknown: ${r.unknownReason}`], assumptionsUsed: [...assumptions].sort() };
      hp -= r.damage;
      hitCount++;
      const step: HtkStep = { attack: n, hit: h.index, damage: r.damage, hpAfter: hp };
      if (res) {
        for (const [status, amount] of Object.entries(r.status)) {
          const kind = STATUS_RESISTANCE[status];
          if (!kind || amount <= 0) continue;
          buildup[status] = (buildup[status] ?? 0) + amount;
          if (buildup[status]! < res.values[kind]) continue;
          buildup[status] = 0;
          const proc = procDamage(status, defender.maxHp);
          if (proc.damage === null) {
            if (!notes.some((x) => x.startsWith(`${status} proc`))) notes.push(`${status} proc: ${proc.note}`);
            continue;
          }
          hp -= proc.damage;
          step.damage += proc.damage;
          step.hpAfter = hp;
          step.event = [step.event, `${status} proc ${proc.damage}`].filter(Boolean).join("; ");
          if (!notes.some((x) => x.startsWith("status procs"))) notes.push("status procs: buildup has no decay and no post-proc resistance change (not modelled)");
        }
      }
      if (hp <= 0) {
        steps.push(step);
        return { attacks: n, hits: hitCount, steps, startHp, notes, assumptionsUsed: [...assumptions].sort() };
      }
      if (tear && !tearUsed && hp / defender.maxHp < tear.threshold) {
        hp = Math.min(defender.maxHp, hp + tear.heal);
        tearUsed = true;
        step.event = `Crimson Bubbletear heals ${tear.heal}`;
        step.hpAfter = hp;
      }
      steps.push(step);
    }
  }
  notes.push(`no kill within ${MAX_ATTACKS} attacks`);
  return { attacks: null, hits: null, steps, startHp, notes, assumptionsUsed: [...assumptions].sort() };
}
