// Balance search, steps 2–5: bulk damage table (each attack of each variant into each body, computed once per RL pair),
// Mirror and Cross views, metrics, candidate rules (RL per stat, RL per stat and grip, outlier bans) and the search.
import { ASSUMPTIONS, type AssumptionId } from "../assumptions.ts";
import { resolveAttack, type ResolvedAttack } from "../attacks/attacks.ts";
import { computeAttack } from "../duel/attack-result.ts";
import { prepareFighter, type Fighter } from "../duel/fighter.ts";
import { hitsToKill } from "../duel/htk.ts";
import type { GameData } from "../game-data.ts";
import { withRuneLevel } from "../sweep/sweep.ts";
import { EngineError, type StatKey } from "../types.ts";
import { ASH_CLASSES, BASKET_CLASSES, basketFor, NORMAL_CLASSES, type AttackClass, type Basket, type BasketAttack } from "./basket.ts";
import type { Grip, Variant } from "./setups.ts";

export type View = "normal" | "ash";

export interface BalanceConfig {
  /** Weight per attack class (0 = classified but not counted). Default: 1 for the basket classes, 0 otherwise. */
  weights: Partial<Record<AttackClass, number>>;
  rlMin: number;
  rlMax: number;
  rlStep: number;
  referenceRl: number;
  /** Honesty rule thresholds (docs/10 defaults: ratio > 1.05 or any HTK gap ≥ 1 = not balanced). */
  maxRatio: number;
  maxHtkGap: number;
  /** A combo is a ban candidate only if its class damage is ≥ (1 + this) × the best other combo's (different weapon/ash). */
  outlierThreshold: number;
  maxBans: number;
  /** Which views the objective covers. */
  objective: View[];
  /** Ash casts in a "round" for the FP-weighted view; casts beyond the FP budget use the No-FP variant. */
  ashCastsPerRound: number;
  maxPasses: number;
}

export const DEFAULT_BALANCE_CONFIG: BalanceConfig = {
  weights: Object.fromEntries(BASKET_CLASSES.map((c) => [c, 1])),
  rlMin: 90,
  rlMax: 150,
  rlStep: 1,
  referenceRl: 125,
  maxRatio: 1.05,
  maxHtkGap: 1,
  outlierThreshold: 0.2,
  maxBans: 5,
  objective: ["normal", "ash"],
  ashCastsPerRound: 3,
  maxPasses: 4,
};

export interface Ban { label: string; weapon: string; ash?: string; infusion: string; body: string; grip: Grip }
export interface Rules {
  rl: Partial<Record<StatKey, number>>;
  /** Overrides `rl` for one grip ("str|2h"). */
  rlByGrip: Record<string, number>;
  bans: Ban[];
}
export const NO_RULES: Rules = { rl: {}, rlByGrip: {}, bans: [] };

export interface AttackRow {
  attack: BasketAttack;
  damage: number | null;
  /** Unrounded damage per type, summed over the landed hits. */
  perType: Record<string, number>;
  poiseDamage: number | null;
  startup: number | null;
  hyperArmour: boolean;
  status: Record<string, number>;
  noFpDamage?: number | null;
  notSupported?: string;
}

export interface ClassValue { cls: AttackClass; damage: number | null; htk: number | null; bestAttack?: string }
export interface SideResult { variant: Variant; rl: number; classes: ClassValue[]; fpUses: number | null; roundDamage: number | null }
export interface Matchup {
  view: View;
  setup: string;
  a: SideResult;
  b: SideResult;
  perClass: { cls: AttackClass; ratio: number | null; htkGap: number | null }[];
  /** max |ln ratio| over weighted classes with both sides known. */
  score: number;
  maxHtkGap: number | null;
  roundRatio: number | null;
}

const key = (...p: (string | number)[]) => p.join("\u0001");

export class BalanceEvaluator {
  readonly baskets = new Map<string, Basket>();
  readonly notSupported = new Map<string, Set<string>>();
  readonly assumptions = new Set<AssumptionId>();
  private fighters = new Map<string, Fighter | EngineError>();
  private resolved = new Map<string, ResolvedAttack | EngineError>();
  private rows = new Map<string, AttackRow[]>();
  private htks = new Map<string, number | null>();
  private bodyBuild = new Map<string, Variant["build"]>();
  private bySetup = new Map<string, Variant[]>();
  rowsComputed = 0;

  constructor(readonly data: GameData, readonly variants: Variant[], readonly config: BalanceConfig) {
    for (const v of variants) {
      const b = basketFor(data, v);
      this.baskets.set(v.id, b);
      b.notSupported.forEach((line) => this.note(line, v.id));
      const sk = key(v.body, v.setup);
      this.bySetup.set(sk, [...(this.bySetup.get(sk) ?? []), v]);
      if (!this.bodyBuild.has(v.body)) this.bodyBuild.set(v.body, { ...v.build, name: v.body, rightHand: [], leftHand: [], buffs: [] });
    }
  }

  note(line: string, where: string) {
    if (!this.notSupported.has(line)) this.notSupported.set(line, new Set());
    this.notSupported.get(line)!.add(where);
  }

  weight(c: AttackClass) {
    return this.config.weights[c] ?? 0;
  }

  rlFor(v: Variant, rules: Rules): number {
    return rules.rlByGrip[`${v.damageStat}|${v.rlGrip}`] ?? rules.rl[v.damageStat] ?? this.config.referenceRl;
  }

  banned(v: Variant, rules: Rules): boolean {
    return rules.bans.some((b) => b.body === v.body && b.weapon === v.build.rightHand[0]!.weapon && b.infusion === v.infusion && b.grip === v.grip && (b.ash ?? null) === (v.ash ?? null));
  }

  private fighter(fkey: string, make: () => Fighter): Fighter | EngineError {
    let f = this.fighters.get(fkey);
    if (!f) {
      try {
        f = make();
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        f = e;
      }
      this.fighters.set(fkey, f);
    }
    return f;
  }
  attackerAt(v: Variant, rl: number) {
    return this.fighter(key("A", v.id, rl), () => prepareFighter(this.data, withRuneLevel(this.data, v.build, rl, v.damageStat), { scenario: "duel-start" }, v.id));
  }
  defenderAt(v: Variant, rl: number) {
    // Damage taken depends only on the body (stats, armour, effects) and its RL, not on the defender's weapons.
    return this.fighter(key("D", v.body, v.damageStat, rl), () => prepareFighter(this.data, withRuneLevel(this.data, this.bodyBuild.get(v.body)!, rl, v.damageStat), { scenario: "duel-start" }, v.body));
  }

  private resolve(v: Variant, a: BasketAttack, name = a.attack): ResolvedAttack | EngineError {
    const k = key(v.id, name, a.hits, a.hand);
    let r = this.resolved.get(k);
    if (!r) {
      try {
        r = resolveAttack(this.data, v.build, { attack: name, hand: a.hand, hits: a.hits, grip: v.rlGrip });
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        r = e;
      }
      this.resolved.set(k, r);
    }
    return r;
  }

  /** Every attack of the variant's basket into the defender body (weighted classes only unless `all`). Cached. */
  table(attacker: Variant, rlA: number, defender: Variant, rlD: number, all = false): AttackRow[] | EngineError {
    const k = key(attacker.id, rlA, defender.body, defender.damageStat, rlD, all ? 1 : 0);
    const cached = this.rows.get(k);
    if (cached) return cached;
    const A = this.attackerAt(attacker, rlA);
    const D = this.defenderAt(defender, rlD);
    if (A instanceof EngineError) return A;
    if (D instanceof EngineError) return D;
    const out: AttackRow[] = [];
    for (const a of this.baskets.get(attacker.id)!.attacks) {
      if (!all && this.weight(a.class) <= 0) continue;
      const r = this.resolve(attacker, a);
      if (r instanceof EngineError) {
        out.push({ attack: a, damage: null, perType: {}, poiseDamage: null, startup: null, hyperArmour: false, status: {}, notSupported: r.message });
        this.note(r.code === "not-supported" ? r.message : `Not supported right now: ${attacker.build.rightHand[0]!.weapon} "${a.attack}" — ${r.message} — fix the setup`, attacker.id);
        continue;
      }
      const res = computeAttack(this.data, A, r, D);
      this.rowsComputed++;
      res.assumptionsUsed.forEach((x) => this.assumptions.add(x));
      res.notSupported.forEach((line) => this.note(line, attacker.id));
      if (res.total === null) this.note(`Not supported right now: ${attacker.build.rightHand[0]!.weapon} "${a.attack}" damage — ${res.hits.find((h) => h.unknownReason)?.unknownReason ?? "unknown hit damage"} — regulation.bin`, attacker.id);
      const anim = this.data.animations.get(r.entry.filename);
      const status: Record<string, number> = {};
      for (const s of res.status) status[s.status] = s.buildupPerAttack;
      const perType: Record<string, number> = {};
      for (const h of res.hits) for (const t of h.types) perType[t.type] = (perType[t.type] ?? 0) + t.damage;
      const row: AttackRow = {
        attack: a, damage: res.total, perType, poiseDamage: res.poiseDamage, startup: r.hits[0]?.startup ?? null,
        hyperArmour: !!anim?.hyperArmour.length, status,
      };
      if (a.noFp) {
        const nf = this.resolve(attacker, a, a.noFp);
        row.noFpDamage = nf instanceof EngineError ? null : computeAttack(this.data, A, nf, D).total;
      }
      out.push(row);
    }
    this.rows.set(k, out);
    return out;
  }

  /** Hits to kill (status procs and duel state included), repeating one attack. Cached. */
  htk(attacker: Variant, rlA: number, defender: Variant, rlD: number, a: BasketAttack): number | null {
    const k = key("htk", attacker.id, rlA, defender.body, defender.damageStat, rlD, a.attack, a.hits, a.hand);
    if (this.htks.has(k)) return this.htks.get(k)!;
    const A = this.attackerAt(attacker, rlA);
    const D = this.defenderAt(defender, rlD);
    const r = this.resolve(attacker, a);
    let v: number | null = null;
    if (!(A instanceof EngineError) && !(D instanceof EngineError) && !(r instanceof EngineError)) {
      const h = hitsToKill(this.data, A, r, D, { statusProcs: true });
      h.assumptionsUsed.forEach((x) => this.assumptions.add(x));
      v = h.attacks;
    }
    this.htks.set(k, v);
    return v;
  }

  classes(view: View): AttackClass[] {
    return (view === "normal" ? NORMAL_CLASSES : ASH_CLASSES).filter((c) => this.weight(c) > 0);
  }

  /** Mean damage per class (equal weight per attack within a class). */
  classDamage(rows: AttackRow[], view: View): Map<AttackClass, { damage: number | null; best?: AttackRow }> {
    const out = new Map<AttackClass, { damage: number | null; best?: AttackRow }>();
    for (const c of this.classes(view)) {
      const known = rows.filter((r) => r.attack.class === c && r.damage !== null);
      if (!rows.some((r) => r.attack.class === c)) continue;
      out.set(c, known.length ? { damage: known.reduce((s, r) => s + r.damage!, 0) / known.length, best: known.reduce((a, b) => (b.damage! > a.damage! ? b : a)) } : { damage: null });
    }
    return out;
  }

  /** Weighted score used to pick a body's best variant of a setup (per view), against one defender. */
  private variantScore(v: Variant, rlA: number, def: Variant, rlD: number, view: View): number | null {
    const rows = this.table(v, rlA, def, rlD);
    if (rows instanceof EngineError) return null;
    const cd = this.classDamage(rows, view);
    let s = 0, w = 0;
    for (const [c, x] of cd) if (x.damage !== null) { s += this.weight(c) * x.damage; w += this.weight(c); }
    return w ? s / w : null;
  }

  /** Best variant of a setup for a body (per view); in the ash view only variants with that exact ash. */
  best(body: string, setup: string, def: Variant, rlD: number, rules: Rules, view: View, ash?: string): Variant | null {
    let best: Variant | null = null, bestScore = -Infinity;
    for (const v of this.bySetup.get(key(body, setup)) ?? []) {
      if (this.banned(v, rules)) continue;
      if (view === "ash" && v.ash !== ash) continue;
      const s = this.variantScore(v, this.rlFor(v, rules), def, rlD, view);
      if (s !== null && s > bestScore) { bestScore = s; best = v; }
    }
    return best;
  }

  fpUses(v: Variant, rl: number): number | null {
    if (!v.ash) return null;
    const cost = this.data.weaponArts.get(v.ash)?.fpCost?.L2;
    const A = this.attackerAt(v, rl);
    if (!cost || cost <= 0 || A instanceof EngineError) return null;
    return Math.floor(A.maxFp / cost);
  }

  side(v: Variant, rl: number, def: Variant, rlD: number, view: View, withHtk: boolean): SideResult {
    const rows = this.table(v, rl, def, rlD);
    const classes: ClassValue[] = [];
    let round = 0, roundW = 0, roundKnown = true;
    const fpUses = this.fpUses(v, rl);
    if (!(rows instanceof EngineError)) {
      for (const [cls, x] of this.classDamage(rows, view)) {
        let htk: number | null = null;
        if (withHtk) {
          const vals = rows.filter((r) => r.attack.class === cls).map((r) => this.htk(v, rl, def, rlD, r.attack)).filter((h): h is number => h !== null);
          htk = vals.length ? Math.min(...vals) : null;
        }
        classes.push({ cls, damage: x.damage, htk, ...(x.best && { bestAttack: x.best.attack.attack }) });
        // FP-weighted round: ash casts beyond the FP budget use the No-FP variant (docs/10).
        if (x.damage === null) { roundKnown = false; continue; }
        let d = x.damage;
        if (view === "ash" && fpUses !== null) {
          const share = Math.min(1, fpUses / this.config.ashCastsPerRound);
          const noFp = rows.filter((r) => r.attack.class === cls).map((r) => r.noFpDamage).find((n) => n !== undefined);
          d = noFp === null || noFp === undefined ? (share < 1 ? NaN : d) : share * d + (1 - share) * noFp;
          if (Number.isNaN(d)) { roundKnown = false; continue; }
        }
        round += this.weight(cls) * d;
        roundW += this.weight(cls);
      }
    }
    return { variant: v, rl, classes, fpUses, roundDamage: roundKnown && roundW ? round / roundW : null };
  }

  /** Mirror view: the same setup across two bodies, each side using its best variant against the other. */
  mirror(rules: Rules, withHtk = false): Matchup[] {
    const bodies = [...new Set(this.variants.map((v) => v.body))];
    const out: Matchup[] = [];
    for (const view of ["normal", "ash"] as View[]) {
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const X = bodies[i]!, Y = bodies[j]!;
        const setups = new Set(this.variants.filter((v) => v.body === X).map((v) => v.setup));
        for (const setup of setups) {
          const xs = (this.bySetup.get(key(X, setup)) ?? []).filter((v) => !this.banned(v, rules));
          const ys = (this.bySetup.get(key(Y, setup)) ?? []).filter((v) => !this.banned(v, rules));
          if (!xs.length || !ys.length) continue;
          // Normal view: the setup's normal moveset. Ash view: the same ash on both sides ("same setup").
          const ashes = view === "normal" ? [undefined] : [...new Set(xs.map((v) => v.ash).filter((a): a is string => !!a))].filter((a) => ys.some((v) => v.ash === a));
          for (const ash of ashes) {
            const a = this.best(X, setup, ys[0]!, this.rlFor(ys[0]!, rules), rules, view, ash);
            const b = this.best(Y, setup, xs[0]!, this.rlFor(xs[0]!, rules), rules, view, ash);
            if (!a || !b) continue;
            out.push(this.matchup(view, ash ? `${setup} · ${ash}` : setup, a, b, rules, withHtk));
          }
        }
      }
    }
    return out;
  }

  matchup(view: View, setup: string, va: Variant, vb: Variant, rules: Rules, withHtk: boolean): Matchup {
    const rlA = this.rlFor(va, rules), rlB = this.rlFor(vb, rules);
    const a = this.side(va, rlA, vb, rlB, view, withHtk);
    const b = this.side(vb, rlB, va, rlA, view, withHtk);
    const perClass = a.classes.map((ca) => {
      const cb = b.classes.find((x) => x.cls === ca.cls);
      const ratio = ca.damage !== null && cb?.damage ? ca.damage / cb.damage : null;
      const htkGap = withHtk && ca.htk !== null && cb?.htk !== null && cb?.htk !== undefined ? ca.htk - cb.htk : null;
      return { cls: ca.cls, ratio, htkGap };
    });
    const logs = perClass.filter((p) => p.ratio !== null && p.ratio > 0).map((p) => Math.abs(Math.log(p.ratio!)));
    const gaps = perClass.filter((p) => p.htkGap !== null).map((p) => Math.abs(p.htkGap!));
    return {
      view, setup, a, b, perClass,
      score: logs.length ? Math.max(...logs) : 0,
      maxHtkGap: gaps.length ? Math.max(...gaps) : null,
      roundRatio: a.roundDamage !== null && b.roundDamage ? a.roundDamage / b.roundDamage : null,
    };
  }

  /** Objective: the worst mirror matchup's max |ln ratio| over the configured views (docs/10). */
  objective(rules: Rules): { worst: number; worstMatchup?: Matchup } {
    let worst = 0, worstMatchup: Matchup | undefined;
    for (const m of this.mirror(rules)) {
      if (!this.config.objective.includes(m.view)) continue;
      if (m.score > worst) { worst = m.score; worstMatchup = m; }
    }
    return { worst, ...(worstMatchup && { worstMatchup }) };
  }

  /** Tie-break: Σ |HTK gap| over the mirror matchups. */
  htkTotal(rules: Rules): number {
    return this.mirror(rules, true).filter((m) => this.config.objective.includes(m.view)).reduce((s, m) => s + m.perClass.reduce((t, p) => t + Math.abs(p.htkGap ?? 0), 0), 0);
  }

  /** RLs a stat can take for every body using it (withRuneLevel must succeed for all of them). */
  rlGrid(): number[] {
    const out: number[] = [];
    for (let rl = this.config.rlMin; rl <= this.config.rlMax; rl += this.config.rlStep) out.push(rl);
    return out;
  }

  validRl(stat: StatKey, rl: number, grip?: "1h" | "2h"): boolean {
    return this.variants.filter((v) => v.damageStat === stat && (!grip || v.rlGrip === grip)).every((v) => !(this.attackerAt(v, rl) instanceof EngineError));
  }
}

export interface SearchStep { rule: string; before: number; after: number }
export interface OutlierCandidate { ban: Ban; cls: AttackClass; defender: string; damage: number; nextBest: number; nextBestCombo: string; ratio: number }
export interface SearchResult {
  reference: Rules;
  rlOnly: Rules;
  byGrip: Rules;
  recommended: Rules;
  objectives: { reference: number; rlOnly: number; byGrip: number; recommended: number };
  steps: SearchStep[];
  outliersConsidered: OutlierCandidate[];
  sensitivity: { stat: StatKey; minus5: number | null; plus5: number | null }[];
}

const cloneRules = (r: Rules): Rules => ({ rl: { ...r.rl }, rlByGrip: { ...r.rlByGrip }, bans: [...r.bans] });

/** Cross view outliers: per defender body and attack class, a combo ≥ (1 + threshold) × the best combo with another weapon/ash. */
export function outliers(ev: BalanceEvaluator, rules: Rules): OutlierCandidate[] {
  const bodies = [...new Set(ev.variants.map((v) => v.body))];
  const out: OutlierCandidate[] = [];
  for (const defBody of bodies) {
    const def = ev.variants.find((v) => v.body === defBody)!;
    const rlD = ev.rlFor(def, rules);
    for (const view of ["normal", "ash"] as View[]) for (const cls of ev.classes(view)) {
      const combos = new Map<string, { ban: Ban; damage: number; family: string }>();
      for (const v of ev.variants) {
        if (ev.banned(v, rules) || (view === "ash" && !v.ash)) continue;
        const rows = ev.table(v, ev.rlFor(v, rules), def, rlD);
        if (rows instanceof EngineError) continue;
        const d = ev.classDamage(rows, view).get(cls)?.damage;
        if (d === null || d === undefined) continue;
        const weapon = v.build.rightHand[0]!.weapon;
        const label = `${v.ash ? `${v.ash} on ` : ""}${v.grip === "2h" ? "2H" : v.grip === "powerstance" ? "power-stanced" : "main-hand 1H"} ${v.infusion} ${weapon} for ${v.body}`;
        const k = key(v.body, weapon, v.ash ?? "-", v.infusion, v.grip);
        const prev = combos.get(k);
        if (!prev || d > prev.damage) combos.set(k, { ban: { label, weapon, ...(v.ash && { ash: v.ash }), infusion: v.infusion, body: v.body, grip: v.grip }, damage: d, family: key(weapon, v.ash ?? "-") });
      }
      const sorted = [...combos.values()].sort((a, b) => b.damage - a.damage);
      const top = sorted[0];
      if (!top) continue;
      const next = sorted.find((c) => c.family !== top.family);
      if (!next) continue;
      const ratio = top.damage / next.damage;
      if (ratio >= 1 + ev.config.outlierThreshold) out.push({ ban: top.ban, cls, defender: defBody, damage: top.damage, nextBest: next.damage, nextBestCombo: next.ban.label, ratio });
    }
  }
  return out;
}

function descend(ev: BalanceEvaluator, start: Rules, dims: { stat: StatKey; grip?: "1h" | "2h" }[], steps: SearchStep[]): Rules {
  let rules = cloneRules(start);
  let best = ev.objective(rules).worst;
  const set = (r: Rules, d: { stat: StatKey; grip?: "1h" | "2h" }, rl: number) => {
    if (d.grip) r.rlByGrip[`${d.stat}|${d.grip}`] = rl;
    else r.rl[d.stat] = rl;
  };
  for (let pass = 0; pass < ev.config.maxPasses; pass++) {
    let changed = false;
    for (const d of dims) {
      const current = d.grip ? rules.rlByGrip[`${d.stat}|${d.grip}`] ?? rules.rl[d.stat] ?? ev.config.referenceRl : rules.rl[d.stat] ?? ev.config.referenceRl;
      let bestRl = current;
      for (const rl of ev.rlGrid()) {
        if (rl === current || !ev.validRl(d.stat, rl, d.grip)) continue;
        const trial = cloneRules(rules);
        set(trial, d, rl);
        const o = ev.objective(trial).worst;
        if (o < best - 1e-9) { best = o; bestRl = rl; }
        else if (Math.abs(o - best) <= 1e-9 && rl !== bestRl) {
          // tie-break by total HTK gap (docs/10)
          const cur = cloneRules(rules); set(cur, d, bestRl);
          if (ev.htkTotal(trial) < ev.htkTotal(cur)) bestRl = rl;
        }
      }
      if (bestRl !== current) {
        const before = ev.objective(rules).worst;
        set(rules, d, bestRl);
        steps.push({ rule: `${d.stat}${d.grip ? ` ${d.grip.toUpperCase()}` : ""} RL ${current} → ${bestRl}`, before, after: ev.objective(rules).worst });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rules;
}

/** Runs the search with the evaluator's objective views, or with `views` for this call only (caches are kept). */
export function searchBalance(ev: BalanceEvaluator, views?: View[]): SearchResult {
  if (views) {
    const saved = ev.config.objective;
    ev.config.objective = views;
    try {
      return searchBalance(ev);
    } finally {
      ev.config.objective = saved;
    }
  }
  const steps: SearchStep[] = [];
  const reference = cloneRules(NO_RULES);
  const stats = [...new Set(ev.variants.map((v) => v.damageStat))];
  const rlOnly = descend(ev, reference, stats.map((stat) => ({ stat })), steps);
  const grips = (s: StatKey) => [...new Set(ev.variants.filter((v) => v.damageStat === s).map((v) => v.rlGrip))];
  const byGrip = descend(ev, rlOnly, stats.flatMap((stat) => grips(stat).map((grip) => ({ stat, grip }))), steps);

  // Greedy outlier bans: add the one that most improves the worst matchup, re-evaluate, repeat.
  const recommended = cloneRules(byGrip);
  const considered: OutlierCandidate[] = [];
  for (let i = 0; i < ev.config.maxBans; i++) {
    const before = ev.objective(recommended).worst;
    const cands = outliers(ev, recommended);
    considered.push(...cands.filter((c) => !considered.some((x) => x.ban.label === c.ban.label && x.cls === c.cls && x.defender === c.defender)));
    let pick: { cand: OutlierCandidate; after: number } | undefined;
    for (const cand of cands) {
      const trial = cloneRules(recommended);
      trial.bans.push(cand.ban);
      const after = ev.objective(trial).worst;
      if (after < before - 1e-9 && (!pick || after < pick.after)) pick = { cand, after };
    }
    if (!pick) break;
    recommended.bans.push(pick.cand.ban);
    steps.push({ rule: `ban ${pick.cand.ban.label}`, before, after: pick.after });
  }

  const sensitivity = stats.map((stat) => {
    const at = (delta: number) => {
      const rl = (recommended.rl[stat] ?? ev.config.referenceRl) + delta;
      if (!ev.validRl(stat, rl)) return null;
      const t = cloneRules(recommended);
      t.rl[stat] = rl;
      for (const g of ["1h", "2h"]) if (t.rlByGrip[`${stat}|${g}`] !== undefined) t.rlByGrip[`${stat}|${g}`]! += delta;
      return ev.objective(t).worst;
    };
    return { stat, minus5: at(-5), plus5: at(5) };
  });

  return {
    reference, rlOnly, byGrip, recommended,
    objectives: { reference: ev.objective(reference).worst, rlOnly: ev.objective(rlOnly).worst, byGrip: ev.objective(byGrip).worst, recommended: ev.objective(recommended).worst },
    steps, outliersConsidered: considered, sensitivity,
  };
}

/** Assumptions a balance result must name loudly (docs/10 report). */
export const LOUD_ASSUMPTIONS: AssumptionId[] = ["A3", "A4", "A8"]; // A10 removed 2026-11-13 (Kick from game data)
export const assumptionLine = (id: AssumptionId) => `${id} — ${ASSUMPTIONS[id].question} (${ASSUMPTIONS[id].status})`;
