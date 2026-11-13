// Balance search, step 1: setups.yaml (already parsed) + ash-compat → every legal concrete setup ("variant").
// Pure: the caller parses the YAML and passes the object in. Every skipped combination is kept with its reason.
import { resolveAttack } from "../attacks/attacks.ts";
import { prepareFighter, type Fighter } from "../duel/fighter.ts";
import type { GameData } from "../game-data.ts";
import { GREASE_INFUSIONS } from "../game-data.ts";
import { checkLegality, type LadderRuleset } from "../legality/ladder.ts";
import { mainDamageStat } from "../sweep/sweep.ts";
import { EngineError, type Build, type StatKey, type Stats, type WeaponSlot } from "../types.ts";

export type Grip = "2h" | "main+offhand" | "powerstance";
export interface HandSpec { weapon: string; infusions: string[]; ashes: string[] }
export interface SetupSpec { name: string; grip: Grip; main: HandSpec; off?: HandSpec; greases?: boolean; note?: string }
export interface SetupsDoc {
  version: number;
  patch: string;
  defaults: {
    class: string;
    armour: Build["armour"];
    talismans: string[];
    tears: string[];
    upgrade: { regular: number; somber: number };
    requirements_rule: string;
    grease_candidates: string[];
  };
  bodies: Record<string, { stats: Stats; note?: string }>;
  setups: Record<string, SetupSpec[]>;
}

/** Weapon-art buffs that are tried when their ash is listed (docs/10 setups: "Ash buffs … are tried when the ash is listed"). */
export const ASH_BUFFS = ["Sacred Blade", "Lightning Slash"] as const;

export interface Variant {
  id: string;
  body: string;
  setup: string;
  grip: Grip;
  /** "1h" for main+offhand and power stance, "2h" for two-handing (the grip a per-grip RL rule applies to). */
  rlGrip: "1h" | "2h";
  /** The body's damage stat that RL changes move (D15: its main damage stat). */
  damageStat: StatKey;
  build: Build;
  /** The listed ash on the main weapon; undefined = normal moveset only (a carrier ash may still be mounted for the infusion). */
  ash?: string;
  carrierAsh?: string;
  infusion: string;
  offInfusion?: string;
  /** Grease or ash buff active on the main weapon. */
  buff?: { name: string; kind: "grease" | "ash-buff" };
}

export type SkipKind = "game" | "ladder" | "requirements" | "equip-load" | "setup";
export interface Skip { where: string; kind: SkipKind; reason: string }

export interface Expansion { variants: Variant[]; skipped: Skip[] }

const REQ_STAT: Record<string, StatKey> = { strength: "str", dexterity: "dex", intelligence: "int", faith: "fth", arcane: "arc" };

export function validateSetupsDoc(doc: unknown): SetupsDoc {
  const d = doc as SetupsDoc;
  const fail = (msg: string): never => { throw new EngineError(`setups file: ${msg}`, "invalid-setups"); };
  if (!d || typeof d !== "object") fail("not an object");
  if (!d.defaults?.class || !d.defaults.armour || !Array.isArray(d.defaults.grease_candidates)) fail("defaults.class / armour / grease_candidates missing");
  if (!/^skip:/.test(d.defaults.requirements_rule ?? "")) fail(`requirements_rule must start with "skip:" (only the skip rule is implemented), got "${d.defaults.requirements_rule}"`);
  if (!d.bodies || !d.setups) fail("bodies / setups missing");
  for (const [body, list] of Object.entries(d.setups)) {
    if (!d.bodies[body]) fail(`setups.${body} has no matching body`);
    for (const s of list) {
      if (!s.name || !["2h", "main+offhand", "powerstance"].includes(s.grip)) fail(`${body}/${s.name}: grip must be 2h, main+offhand or powerstance`);
      if (!s.main?.weapon || !Array.isArray(s.main.infusions) || !Array.isArray(s.main.ashes)) fail(`${body}/${s.name}: main.weapon / infusions / ashes missing`);
      if (s.grip === "main+offhand" && !s.off?.weapon) fail(`${body}/${s.name}: main+offhand needs an off hand`);
    }
  }
  return d;
}

/** Representative attack for grip-dependent legality rules (2H bans, power-stance bans). */
const GRIP_PROBE: Record<Grip, string> = { "2h": "2h R1 1", "main+offhand": "1h R1 1", powerstance: "Paired L1 1" };

export function expandSetups(data: GameData, ruleset: LadderRuleset, doc: SetupsDoc): Expansion {
  const variants: Variant[] = [];
  const skipped: Skip[] = [];
  const compat = data.raw.ashCompat.weapons;
  const carrierCache = new Map<string, (string | undefined)[]>();
  const fits = (weapon: string, ash: string, infusion: string) => !!compat[weapon]?.ashes[ash]?.includes(infusion);

  for (const [bodyName, setups] of Object.entries(doc.setups)) {
    const body = doc.bodies[bodyName]!;
    for (const setup of setups) {
      const where = `${bodyName}/${setup.name}`;
      const weapons = [setup.main.weapon, ...(setup.off ? [setup.off.weapon] : []), ...(setup.grip === "powerstance" ? [setup.main.weapon] : [])];
      const unknown = weapons.filter((w) => !compat[w] || !data.weaponMeta.has(w));
      if (unknown.length) { skipped.push({ where, kind: "setup", reason: `unknown weapon(s): ${unknown.join(", ")}` }); continue; }

      const base: Build = { name: where, class: doc.defaults.class, stats: body.stats, armour: doc.defaults.armour, talismans: doc.defaults.talismans ?? [], tears: doc.defaults.tears ?? [], buffs: [], rightHand: [], leftHand: [] };
      // requirements_rule "skip": one-handed requirements, two-handing counts str × 1.5. Stats include the helm's bonus.
      const stats = prepareFighter(data, base, { scenario: "duel-start" }).stats;
      const unmet: string[] = [];
      for (const w of new Set(weapons)) {
        for (const [req, need] of Object.entries(data.weaponMeta.get(w)!.requirements)) {
          const key = REQ_STAT[req];
          if (!key) continue;
          const have = key === "str" && setup.grip === "2h" ? Math.floor(stats.str * 1.5) : stats[key];
          if (have < need) unmet.push(`${w} needs ${req} ${need}, the body has ${have}${key === "str" && setup.grip === "2h" ? " (2H: str × 1.5)" : ""}`);
        }
      }
      if (unmet.length) { skipped.push({ where, kind: "requirements", reason: `requirements_rule skip — ${unmet.join("; ")}` }); continue; }

      const slotFor = (weapon: string, infusion: string, ash: string | undefined): WeaponSlot => {
        const somber = compat[weapon]!.somber;
        return { weapon, infusion, upgrade: somber ? doc.defaults.upgrade.somber : doc.defaults.upgrade.regular, ...(ash && { ashOfWar: ash }) };
      };
      // Any ash that lets this weapon take this infusion — it only carries the infusion (never used). The first one that is
      // legal to equip on its own is enough (a banned ash would make the whole setup illegal for a reason unrelated to it).
      const carriers = (weapon: string, infusion: string): (string | undefined)[] => {
        if (infusion === "Standard") return [undefined];
        const key = `${weapon}|${infusion}`;
        if (!carrierCache.has(key)) {
          const legal = Object.entries(compat[weapon]!.ashes)
            .filter(([, infs]) => infs.includes(infusion))
            .map(([a]) => a)
            .find((a) => {
              const probe: Build = { ...base, rightHand: [slotFor(weapon, infusion, a)], leftHand: [] };
              return checkLegality(ruleset, { data, fighter: prepareFighter(data, probe, { scenario: "duel-start" }) }).violations.length === 0;
            });
          carrierCache.set(key, legal ? [legal] : []);
        }
        return carrierCache.get(key)!;
      };

      for (const infusion of setup.main.infusions) {
        if (compat[setup.main.weapon]!.somber && infusion !== "Standard") { skipped.push({ where, kind: "game", reason: `${setup.main.weapon} is somber/unique: Standard only, not ${infusion}` }); continue; }
        const mainAshes: (string | undefined)[] = setup.main.ashes.length ? setup.main.ashes : [undefined];
        for (const ash of mainAshes) {
          if (ash && !fits(setup.main.weapon, ash, infusion)) { skipped.push({ where, kind: "game", reason: `${setup.main.weapon}: ${ash} doesn't allow ${infusion} (ash-compat)` }); continue; }
          const offOptions = setup.grip === "main+offhand" ? setup.off!.infusions : setup.grip === "powerstance" ? [infusion] : [undefined];
          for (const offInfusion of offOptions) {
            // Off hand: listed ashes only carry the infusion; [] = any legal carrier. Power stance: same weapon, same infusion.
            const offWeapon = setup.grip === "main+offhand" ? setup.off!.weapon : setup.main.weapon;
            let offCarriers: (string | undefined)[] = [undefined];
            if (offInfusion !== undefined) {
              if (compat[offWeapon]!.somber && offInfusion !== "Standard") { skipped.push({ where, kind: "game", reason: `${offWeapon} is somber/unique: Standard only, not ${offInfusion}` }); continue; }
              const listed = setup.grip === "main+offhand" && setup.off!.ashes.length ? setup.off!.ashes.filter((a) => fits(offWeapon, a, offInfusion)) : null;
              offCarriers = listed?.length ? listed.slice(0, 1) : listed ? [] : carriers(offWeapon, offInfusion);
              if (!offCarriers.length) { skipped.push({ where, kind: "game", reason: `${offWeapon}: no ${listed ? "listed " : ""}ash allows ${offInfusion} (ash-compat)` }); continue; }
            }
            const mainCarriers = ash ? [ash] : carriers(setup.main.weapon, infusion);
            if (!mainCarriers.length) { skipped.push({ where, kind: "game", reason: `${setup.main.weapon}: no legal ash carries ${infusion}` }); continue; }
            const buffs: (Variant["buff"] | undefined)[] = [undefined];
            const meta = data.weaponMeta.get(setup.main.weapon)!;
            if (setup.greases !== false && meta.isBuffable && GREASE_INFUSIONS.includes(infusion)) for (const g of doc.defaults.grease_candidates) buffs.push({ name: g, kind: "grease" });
            if (ash && (ASH_BUFFS as readonly string[]).includes(ash)) buffs.push({ name: ash, kind: "ash-buff" });

            for (const buff of buffs) {
              const label = `${where} ${infusion}${ash ? ` + ${ash}` : ""}${offInfusion !== undefined && setup.grip === "main+offhand" ? ` | off ${offWeapon} ${offInfusion}` : ""}${buff ? ` [${buff.name}]` : ""}`;
              let accepted: { variant: Variant; fighter: Fighter } | undefined;
              let lastViolation = "";
              const mc = mainCarriers[0];
              const oc = offCarriers[0];
              {
                const build: Build = {
                  ...base,
                  name: label,
                  buffs: buff ? [buff.name] : [],
                  rightHand: [slotFor(setup.main.weapon, infusion, mc)],
                  leftHand: offInfusion !== undefined ? [slotFor(offWeapon, offInfusion, oc)] : [],
                };
                const fighter = prepareFighter(data, build, { scenario: "duel-start" });
                let attack;
                try {
                  attack = resolveAttack(data, build, { attack: GRIP_PROBE[setup.grip] });
                } catch {
                  attack = undefined; // no probe attack: build-level rules only
                }
                const report = checkLegality(ruleset, { data, fighter, ...(attack && { attack }) });
                if (report.violations.length) lastViolation = report.violations.map((v) => `${v.rule} (${v.detail})`).join("; ");
                else
                accepted = {
                  fighter,
                  variant: {
                    id: label, body: bodyName, setup: setup.name, grip: setup.grip, rlGrip: setup.grip === "2h" ? "2h" : "1h",
                    damageStat: mainDamageStat({ ...base }), build, infusion,
                    ...(ash && { ash }), ...(!ash && mc && { carrierAsh: mc }),
                    ...(offInfusion !== undefined && setup.grip === "main+offhand" && { offInfusion }), ...(buff && { buff }),
                  },
                };
              }
              if (!accepted) { skipped.push({ where: label, kind: "ladder", reason: lastViolation || "no legal carrier ash" }); continue; }
              const roll = accepted.fighter.equipLoad.roll;
              if (roll !== "Medium") {
                skipped.push({ where: label, kind: "equip-load", reason: `equip load ${accepted.fighter.equipLoad.percent.toFixed(1)}% = ${roll} roll (ladder needs medium: light load is banned, heavy is not a medium roll)` });
                continue;
              }
              variants.push(accepted.variant);
            }
          }
        }
      }
    }
  }
  return { variants, skipped };
}
