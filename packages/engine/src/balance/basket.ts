// Balance search, step 3: classify every attack a setup can do into an attack class, from its type, the animation's
// FDE labels and the planner's structured names. Nothing is dropped silently: an attack that fits no rule is "unclassified".
import { attacksForSlot, skillSupport, slotSkillName } from "../attacks/attacks.ts";
import type { GameData } from "../game-data.ts";
import { notSupportedLine, type PlannerAttackEntry } from "../types.ts";
import type { Variant } from "./setups.ts";

/** Classes the basket weighs (docs/10). Default weights are equal for these. */
export const BASKET_CLASSES = ["R1 chain", "R2", "running", "rolling", "jumping", "off-hand L1 chain", "paired L1 chain", "ash first hit", "full ash"] as const;
export type BasketClass = (typeof BASKET_CLASSES)[number];
/** Classified but outside the basket by default (weight 0, configurable): situational or not a neutral-game swing. */
export const EXTRA_CLASSES = ["backstep", "guard counter", "crouch", "critical", "jump landing", "feint", "ash-modified R2", "no-FP ash", "ash follow-up", "other"] as const;
export type AttackClass = BasketClass | (typeof EXTRA_CLASSES)[number];

export const NORMAL_CLASSES: readonly AttackClass[] = ["R1 chain", "R2", "running", "rolling", "jumping", "off-hand L1 chain", "paired L1 chain"];
export const ASH_CLASSES: readonly AttackClass[] = ["ash first hit", "full ash"];

export interface BasketAttack {
  class: AttackClass;
  /** Planner/FDE attack name, resolved from `hand`. */
  attack: string;
  hand: "right" | "left";
  /** Which hits count: "first" for "ash first hit", else all. */
  hits: "all" | "first";
  /** For ash classes: the matching No-FP entry, used when the FP budget runs out. */
  noFp?: string;
  /** Ash skill name for ash classes. */
  skill?: string;
}

export interface Basket {
  attacks: BasketAttack[];
  /** "Not supported right now — …" lines for this variant (unclassified attacks, ashes without data). */
  notSupported: string[];
}

const NO_FP = /\bNo FP\b|without FP|Lacking FP/i;
const FOLLOW_UP = /^Follow-up \d+ with FP$/;

/** Normal-attack class from the planner's structured name and the grip; null = unclassified. */
export function normalClass(name: string, grip: Variant["grip"], ash: string | undefined): AttackClass | "wrong-grip" | null {
  const prefix = grip === "2h" ? "2h" : "1h";
  const g = name.match(/^(1h|2h) /)?.[1];
  if (g && g !== prefix) return "wrong-grip";
  const rest = g ? name.slice(3) : name;
  if (/^(Paired|Offhand) /.test(name)) {
    if (grip === "2h") return "wrong-grip";
    const paired = name.startsWith("Paired ");
    if (paired && grip !== "powerstance") return "wrong-grip";
    if (!paired && grip !== "main+offhand") return "wrong-grip";
    const r = name.replace(/^(Paired|Offhand) /, "");
    if (/^L1 \d+$/.test(r)) return paired ? "paired L1 chain" : "off-hand L1 chain";
    if (/^Running L1$/.test(r)) return "running";
    if (/^Rolling L1$/.test(r)) return "rolling";
    if (/^Jumping L1$/.test(r)) return "jumping";
    if (/^Backstep L1$/.test(r)) return "backstep";
    if (/^Crouch L1$/.test(r)) return "crouch";
    if (/^Jumping L1 (Landing|Hangtime)$|^Attack Landing/.test(r)) return "jump landing";
    return null;
  }
  if (/^R1 \d+$/.test(rest)) return "R1 chain";
  if (/^(R2 \d+ Release|Charged R2 \d+)$/.test(rest)) return "R2";
  if (/^Charged R2 \d+ Feint$/.test(rest)) return "feint";
  if (/^(Barbaric Roar|War Cry) R2 \d+ (Charged|Release)$/.test(rest)) return ash && rest.startsWith(ash) ? "ash-modified R2" : "wrong-grip";
  if (/^Running R[12]$/.test(rest)) return "running";
  if (/^Rolling R1$/.test(rest)) return "rolling";
  if (/^Jumping R[12]$/.test(rest)) return "jumping";
  if (/^Jumping R[12] (Landing|Hangtime)$|^Attack Landing/.test(rest)) return "jump landing";
  if (/^Backstep R1$/.test(rest)) return "backstep";
  if (/^Guard Counter$/.test(rest)) return "guard counter";
  if (/^Crouch R1$/.test(rest)) return "crouch";
  if (/^(Riposte|Backstab|Weak-Point Riposte)\b|^Backstab/.test(rest)) return "critical";
  if (/^Shieldpoke/.test(name) || /Release$/.test(name)) return "other";
  return null;
}

/** Whether the animation (if we have it) is a weapon skill / a hitting attack, from FDE labels. */
function labelsOf(data: GameData, entry: PlannerAttackEntry): string[] {
  return data.animations.get(entry.filename)?.labels ?? [];
}

/**
 * The variant's basket. Ash attacks: type WeaponSkill (or the FDE label WeaponSkill) for the slot's skill. The first
 * FP entry in data order is the ash's opening; "ash first hit" = its first hit, "full ash" = all its hits; its No-FP twin
 * is the first No-FP entry. Later FP entries are follow-ups (classified, weight 0 by default).
 */
export function basketFor(data: GameData, v: Variant): Basket {
  const notSupported: string[] = [];
  const out: BasketAttack[] = [];
  const main = v.build.rightHand[0]!;
  const unclassified = (weapon: string, name: string, why: string) =>
    notSupported.push(notSupportedLine(`${weapon} "${name}"`, `unclassified attack (${why})`, "a classification rule in balance/basket.ts"));

  // Normal moveset: right hand, plus the left hand for off-hand / paired attacks.
  const hands: ("right" | "left")[] = v.grip === "2h" ? ["right"] : ["right", "left"];
  for (const hand of hands) {
    const slot = hand === "right" ? main : v.build.leftHand?.[0];
    if (!slot) continue;
    for (const entry of attacksForSlot(data, slot, hand, false)) {
      const isSkill = entry.type === "WeaponSkill" || labelsOf(data, entry).includes("WeaponSkill");
      if (isSkill) continue; // ashes below (right hand only)
      if (entry.type !== "Attack") { unclassified(slot.weapon, entry.name, `type ${entry.type}`); continue; }
      if (hand === "left" && !/^(Paired|Offhand) /.test(entry.name)) continue; // the left hand's 2h moves aren't used in these grips
      const cls = normalClass(entry.name, v.grip, v.ash);
      if (cls === "wrong-grip") continue;
      if (cls === null) { unclassified(slot.weapon, entry.name, "name matches no attack class"); continue; }
      out.push({ class: cls, attack: entry.name, hand, hits: "all" });
    }
  }

  // Ash of war (listed ash only; "ashes: []" = normal moveset only).
  if (v.ash) {
    const unsupported = skillSupport(data, main);
    if (unsupported) notSupported.push(unsupported.line);
    else {
      const skill = slotSkillName(data, main)!;
      const entries = attacksForSlot(data, main, "right", false).filter((e) => e.categories[0] === skill && (e.type === "WeaponSkill" || labelsOf(data, e).includes("WeaponSkill")));
      const fp = entries.filter((e) => !NO_FP.test(e.name));
      const noFp = entries.find((e) => NO_FP.test(e.name));
      const opening = fp[0];
      if (!opening) notSupported.push(notSupportedLine(`${skill} on ${main.weapon}`, "only No-FP entries in the data", "animation data"));
      else {
        const base = { hand: "right" as const, skill, ...(noFp && { noFp: noFp.name }) };
        out.push({ ...base, class: "ash first hit", attack: opening.name, hits: "first" });
        out.push({ ...base, class: "full ash", attack: opening.name, hits: "all" });
        for (const e of fp.slice(1)) out.push({ class: FOLLOW_UP.test(e.name) || e.name !== opening.name ? "ash follow-up" : "other", attack: e.name, hand: "right", hits: "all", skill });
        for (const e of entries.filter((x) => NO_FP.test(x.name))) out.push({ class: "no-FP ash", attack: e.name, hand: "right", hits: "all", skill });
      }
    }
  }
  return { attacks: out, notSupported };
}
