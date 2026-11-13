// Step-by-step breakdowns and the result footer (assumptions, patch, credit).
import { ASSUMPTIONS, unconfirmedAssumptions, type AssumptionId } from "../assumptions.ts";
import { CREDIT_LINE } from "../credit.ts";
import type { HitDamage } from "../hit/hit.ts";
import type { ResultMeta } from "../types.ts";

const n = (x: number, d = 2) => (Number.isInteger(x) ? String(x) : x.toFixed(d));
const pct = (x: number) => `${(100 * x).toFixed(3)}%`;

/** Shown whenever a result uses A3, until the friend test confirms the projectile formula (Zer0, 2026-11-12). */
export const A3_WARNING = "⚠ Projectile damage uses an unverified formula (A3)";

export function resultMeta(patch: string, used: Iterable<AssumptionId>, notSupported: string[] = []): ResultMeta {
  const assumptionsUsed = unconfirmedAssumptions(used);
  return { patch, assumptionsUsed, warnings: assumptionsUsed.includes("A3") ? [A3_WARNING] : [], notSupported, credit: CREDIT_LINE };
}

/** Plain-text breakdown of one hit: AR per type → flat adds → MV → multipliers → defence & ratio → curve → negation → final rate → total. */
export function explainHit(h: HitDamage, label: string): string[] {
  const out: string[] = [];
  out.push(`${label} — hit ${h.hit.index} (${h.hit.kind}, ${h.hit.physAttribute}, id ${h.hit.id})`);
  out.push(`  2H str bonus: ${h.twoHandBonusApplied ? `yes (str counts as ${h.effectiveStr})` : "no"} — ${h.hit.disable2H.source === "AtkParam" ? "AtkParam flag" : "A8 (no AtkParam row)"}${h.hit.disable2H.value ? ", disabled for this hit" : ""}`);
  if (h.skill) {
    out.push(`  Skill flat damage: ${h.skill.note}; upgrade rate ×${n(h.skill.upgradeRate, 3)}`);
    for (const s of h.skill.scaling) out.push(`    ${s.stat}: override ${s.override} × correct rate ${n(s.correctRate, 3)} × curve ${n(s.curve, 4)}`);
  }
  for (const t of h.types) {
    out.push(`  ${t.type}:`);
    if (t.weaponPart) out.push(`    AR ${n(t.ar)}${t.flatBuff ? ` + buff ${n(t.flatBuff)}` : ""} × MV ${t.mv}/100 = ${n(t.weaponPart)}`);
    if (t.skillPart) out.push(`    skill flat (A3) = ${n(t.skillPart)}`);
    if (t.attackerMultiplier !== 1) out.push(`    × attacker multipliers ${n(t.attackerMultiplier, 4)}`);
    out.push(`    attack value A = ${n(t.attackValue)}; defence D = ${t.defence}; ratio A/D = ${n(t.ratio, 3)}; curve = ${n(t.curve, 4)}`);
    out.push(`    negation (${t.negationType}) ${pct(t.negation)} → ×${n(1 - t.negation, 5)}; PvP final rate ×${t.finalRate}`);
    out.push(`    = ${n(t.damage, 3)}`);
  }
  for (const e of h.attackerEffects) out.push(`  attacker effect: ${e.source} — ${e.attribute} ${e.value} [${e.cite}]`);
  for (const e of h.defenderEffects) out.push(`  defender effect: ${e.source} — ${e.attribute} ${e.value} [${e.cite}]`);
  for (const e of h.ignoredEffects) out.push(`  not applied: ${e.source} — ${e.attribute} (${e.reason})`);
  if (h.buffNote) out.push(`  note: ${h.buffNote}`);
  for (const w of h.warnings) out.push(`  WARNING: ${w}`);
  out.push(h.damage === null ? `  total: unknown — ${h.unknownReason}` : `  total: floor(${n(h.types.reduce((a, t) => a + t.damage, 0), 3)}) = ${h.damage}`);
  return out;
}

export function footer(meta: ResultMeta): string[] {
  const lines = [`Patch ${meta.patch}.`];
  lines.push(
    meta.assumptionsUsed.length
      ? `Assumptions used (unconfirmed): ${meta.assumptionsUsed.map((id) => `${id} — ${ASSUMPTIONS[id].question}`).join("; ")}`
      : "Assumptions used: none unconfirmed.",
  );
  lines.push(meta.credit);
  return lines;
}
