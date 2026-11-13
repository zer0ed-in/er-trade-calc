// ERPvP ladder legality (fixtures/ruleset/erpvp-ladder.json is the human-readable source of truth).
// Every rule line in that file maps to a check here or to an explicit "not checkable" reason — a test enforces this,
// so editing the ruleset without updating this table fails loudly (engineNotes: "Unmapped names must be reported").
import { weaponAr } from "../ar/weapon-ar.ts";
import type { ResolvedAttack } from "../attacks/attacks.ts";
import type { Fighter } from "../duel/fighter.ts";
import type { GameData } from "../game-data.ts";
import type { WeaponSlot } from "../types.ts";

export interface LadderRuleset {
  name: string;
  duel: { runeLevel: number };
  bans: Record<string, string[]>;
  buffRestrictions: { description: string; targets: string[] };
}

export interface LegalityContext {
  data: GameData;
  fighter: Fighter;
  /** When given, grip/hand-dependent rules (2H, off-hand) are checked for this attack too. */
  attack?: ResolvedAttack;
}

export interface Violation {
  rule: string;
  section: string;
  detail: string;
}

export interface LegalityReport {
  legal: boolean;
  ruleset: string;
  runeLevel: { required: number; actual: number; ok: boolean };
  violations: Violation[];
  notChecked: { rule: string; section: string; reason: string }[];
}

type Check = (ctx: LegalityContext) => string[];
type RuleEntry = { check: Check } | { notCheckable: string };

// ---- helpers ---------------------------------------------------------------------------------------
const slots = (ctx: LegalityContext, hand: "right" | "left" | "any") => {
  const r = ctx.fighter.build.rightHand.filter((s): s is WeaponSlot => !!s).map((s) => ({ s, hand: "right" as const }));
  const l = (ctx.fighter.build.leftHand ?? []).filter((s): s is WeaponSlot => !!s).map((s) => ({ s, hand: "left" as const }));
  return hand === "right" ? r : hand === "left" ? l : [...r, ...l];
};
const category = (ctx: LegalityContext, weapon: string) => ctx.data.weaponMeta.get(weapon)?.category;
const buffNames = (ctx: LegalityContext) => ctx.fighter.equipped.buffs;
const twoHanding = (ctx: LegalityContext, pred: (s: WeaponSlot) => boolean) => !!ctx.attack && ctx.attack.twoHanded && pred(ctx.attack.slot);
const attackHand = (ctx: LegalityContext) => ctx.attack?.hand;

const hasTalisman = (...names: string[]): Check => (ctx) => ctx.fighter.equipped.talismans.filter((t) => names.includes(t)).map((t) => `talisman ${t} equipped`);
const hasTear = (...names: string[]): Check => (ctx) => ctx.fighter.equipped.tears.filter((t) => names.includes(t)).map((t) => `crystal tear ${t} equipped`);
const hasAsh = (...names: string[]): Check => (ctx) => slots(ctx, "any").filter(({ s }) => s.ashOfWar && names.includes(s.ashOfWar)).map(({ s }) => `ash of war ${s.ashOfWar} on ${s.weapon}`);
const hasWeapon = (pred: (s: WeaponSlot, cat: string | undefined) => boolean, hand: "right" | "left" | "any", label: string): Check => (ctx) =>
  slots(ctx, hand).filter(({ s }) => pred(s, category(ctx, s.weapon))).map(({ s, hand: h }) => `${s.weapon} in the ${h} hand (${label})`);
const twoHandedAttack = (pred: (s: WeaponSlot, cat: string | undefined) => boolean, label: string): Check => (ctx) =>
  twoHanding(ctx, (s) => pred(s, category(ctx, s.weapon))) ? [`two-handing ${ctx.attack!.slot.weapon} (${label})`] : [];
const hasArmour = (re: RegExp): Check => (ctx) => Object.values(ctx.fighter.build.armour).filter((n): n is string => !!n && re.test(n)).map((n) => `armour ${n}`);
const hasBuff = (...names: string[]): Check => (ctx) => buffNames(ctx).filter((b) => names.includes(b)).map((b) => `buff/grease ${b}`);
const all = (...checks: Check[]): Check => (ctx) => checks.flatMap((c) => c(ctx));
const NOT_MODELLED = (what: string) => ({ notCheckable: `${what} — not part of a calculator build` });
const SHIELD_CLASSES = ["Small Shield", "Medium Shield", "Greatshield", "Thrusting Shield"];
const POISON_GREASES = ["Poison Grease", "Drawstring Poison Grease"];
const SLEEP_GREASES = ["Soporific Grease", "Drawstring Soporific Grease", "Eternal Sleep Grease", "Drawstring Eternal Sleep Grease"];

// "Status application" on a weapon: status buildup from the infusion (weapon data) or from an active grease/buff ("… Buildup" effect).
const statusFromInfusion = (ctx: LegalityContext, slot: WeaponSlot) =>
  Object.keys(weaponAr(ctx.data, slot, ctx.fighter.stats, { twoHanded: false, disableTwoHandBonus: false }).status);
const statusBuffs = (ctx: LegalityContext) => [...new Set(ctx.fighter.buffs.filter((b) => b.effect.attribute.endsWith("Buildup")).map((b) => b.source))];

// Tick-based HP regen: any equipped talisman/armour/tear effect restoring HP over time ("Health Points", additive).
const tickRegen: Check = (ctx) =>
  ctx.fighter.effects
    .filter((e) => e.kind !== "buff" && e.effect.attribute === "Health Points" && e.effect.model === "additive")
    .map((e) => `${e.source} restores HP over time`);

/** Buff restriction targets: any active buff/grease is banned when the buffed (right-hand) weapon matches. */
const buffTarget = (pred: (ctx: LegalityContext, s: WeaponSlot, cat: string | undefined, hand: "right" | "left") => boolean, label: string): RuleEntry => ({
  check: (ctx) => {
    const buffs = buffNames(ctx);
    if (!buffs.length) return [];
    return slots(ctx, "any").filter(({ s, hand }) => pred(ctx, s, category(ctx, s.weapon), hand)).map(({ s }) => `${buffs.join(", ")} on a buff-restricted setup: ${s.weapon} (${label})`);
  },
});

// ---- the table: ruleset text → check --------------------------------------------------------------
export const LADDER_RULE_TABLE: Record<string, RuleEntry> = {
  // general
  "Player buffs that stay regardless of equipped weapon (excludes crystal tears, talismans, equipment, armour)": NOT_MODELLED("body buffs/spells"),
  "Tick-based (passive) HP regen via armour/talismans/shields/ashes": { check: tickRegen },
  "HP healing: Flask of Crimson Tears, healing incantations (Urgent Heal, Heal, Great Heal, Erdtree Heal, Lord's Heal, Blessing's Boon, Blessing of the Erdtree, Bestial Vitality, Heal from Afar), healing consumables (Raw Meat Dumpling, Warming Stone, Frenzyflame Stone, Baldachin's Blessing, Radiant Baldachin's Blessing)": NOT_MODELLED("healing items/spells"),
  "Rune Arc and PvP Great Runes: allowed in Better Multiplayer / Seamless; banned in vanilla": NOT_MODELLED("great runes"),
  "Spectral Steed Whistle and Spirit Ashes": NOT_MODELLED("items"),
  "Blue flasks limited to 2": NOT_MODELLED("flask counts"),
  "Fan Daggers": NOT_MODELLED("throwing consumables"),
  "Blocking with shields above 90% physical absorption": { notCheckable: "blocking is not modelled in phase 1" },
  "Consumables: Ironjar Aromatic, Sacred Bloody Flesh, all Livers (Fireproof/Lightningproof/Spellproof/Holyproof Dried & Pickled Liver, Opaline Pickled Liver), Ancient Dragon's Blessing, Boiled Crab, Boiled Prawn, Exalted Flesh": NOT_MODELLED("consumables"),
  // greases
  "Rot Grease, Drawstring Rot Grease (everywhere)": { check: hasBuff("Rot Grease", "Drawstring Rot Grease") },
  "Sleep greases (Soporific, Drawstring Soporific, Eternal Sleep, Drawstring Eternal Sleep) on Ripple weapons (Ripple Blade, Ripple Crescent Halberd)": {
    check: (ctx) => (slots(ctx, "any").some(({ s }) => ["Ripple Blade", "Ripple Crescent Halberd"].includes(s.weapon)) ? hasBuff(...SLEEP_GREASES)(ctx).map((v) => `${v} on a Ripple weapon`) : []),
  },
  "Poison greases on 2H Shamshir": { check: (ctx) => (twoHanding(ctx, (s) => s.weapon === "Shamshir") ? hasBuff(...POISON_GREASES)(ctx).map((v) => `${v} while two-handing Shamshir`) : []) },
  "All greases on the buff-restricted setups (buffRestrictions)": { notCheckable: "covered by the buffRestrictions entries below" },
  "All other damage greases (incl. DLC and Drawstring) are ALLOWED": { notCheckable: "permission, not a ban" },
  // crystal tears
  "All stat-boosting tears (Strength-/Dexterity-/Intelligence-/Faith-knot)": { check: hasTear("Strength-knot Crystal Tear", "Dexterity-knot Crystal Tear", "Intelligence-knot Crystal Tear", "Faith-knot Crystal Tear") },
  "All damage-boosting tears (Flame-/Magic-/Lightning-/Holy-Shrouding, Thorny, Spiked)": { check: hasTear("Flame-Shrouding Cracked Tear", "Magic-Shrouding Cracked Tear", "Lightning-Shrouding Cracked Tear", "Holy-Shrouding Cracked Tear", "Thorny Cracked Tear", "Spiked Cracked Tear") },
  "Deflecting Hardtear": { check: hasTear("Deflecting Hardtear") },
  "Leaden Hardtear": { check: hasTear("Leaden Hardtear") },
  "Winged Crystal Tear": { check: hasTear("Winged Crystal Tear") },
  "Windy Crystal Tear": { check: hasTear("Windy Crystal Tear") },
  "Stonebarb Cracked Tear": { check: hasTear("Stonebarb Cracked Tear") },
  "Crimson Crystal Tear": { check: hasTear("Crimson Crystal Tear") },
  "Crimsonwhorl Bubbletear": { check: hasTear("Crimsonwhorl Bubbletear") },
  "Golden Vow (tear)": { check: hasTear("Golden Vow") },
  // weapons
  "Thrusting Shields (class) — incl. Carian Thrusting Shield; Dueling Shield 2H": {
    check: all(hasWeapon((s, c) => c === "Thrusting Shield" && s.weapon !== "Dueling Shield", "any", "thrusting shield class"), twoHandedAttack((s) => s.weapon === "Dueling Shield", "Dueling Shield 2H")),
  },
  // Class ban: covers the Reverse-Bladed Sword too (planner category Backhand Blade).
  "Power-stanced Backhand Blades (class, incl. Reverse-Bladed Sword)": {
    check: (ctx) => {
      const r = slots(ctx, "right").filter(({ s }) => category(ctx, s.weapon) === "Backhand Blade");
      const l = slots(ctx, "left").filter(({ s }) => category(ctx, s.weapon) === "Backhand Blade");
      return r.length && l.length && ctx.attack && /^Paired/.test(ctx.attack.name) ? ["power-stancing backhand blades"] : [];
    },
  },
  // Weapon only, not the class (Zer0, 2026-11-12): Reverse-Bladed Sword and the Cirques share the category.
  "2H Backhand Blade (weapon only)": { check: twoHandedAttack((s) => s.weapon === "Backhand Blade", "2H Backhand Blade") },
  "Smithscript Cirque": { check: hasWeapon((s) => s.weapon === "Smithscript Cirque", "any", "banned weapon") },
  // "Reverse Blades" = the weapon Reverse-Bladed Sword (id 64530000), matched by name (Zer0, 2026-11-12).
  "Lightning-infused 2H Reverse-Bladed Sword": { check: twoHandedAttack((s) => s.weapon === "Reverse-Bladed Sword" && s.infusion === "Lightning", "Lightning 2H Reverse-Bladed Sword") },
  "2H Cleanrot Knight's Sword": { check: twoHandedAttack((s) => s.weapon === "Cleanrot Knight's Sword", "2H Cleanrot Knight's Sword") },
  "Pata: allowed ONLY in the off hand": { check: hasWeapon((s) => s.weapon === "Pata", "right", "Pata main hand") },
  "Claws of Night": { check: hasWeapon((s) => s.weapon === "Claws of Night", "any", "banned weapon") },
  "Smithscript Shield": { check: hasWeapon((s) => s.weapon === "Smithscript Shield", "any", "banned weapon") },
  "Spread Crossbow": { check: hasWeapon((s) => s.weapon === "Spread Crossbow", "any", "banned weapon") },
  "Smithscript Dagger": { check: hasWeapon((s) => s.weapon === "Smithscript Dagger", "any", "banned weapon") },
  Milady: { check: hasWeapon((s) => s.weapon === "Milady", "any", "banned weapon") },
  "2H Stone Club/Club with any status application (status infusion or status grease)": {
    check: (ctx) => {
      if (!twoHanding(ctx, (s) => ["Stone Club", "Club"].includes(s.weapon))) return [];
      const slot = ctx.attack!.slot;
      return [
        ...statusFromInfusion(ctx, slot).map((st) => `two-handing ${slot.infusion} ${slot.weapon} (${st} from the infusion)`),
        ...statusBuffs(ctx).map((b) => `two-handing ${slot.weapon} with ${b} (status grease)`),
      ];
    },
  },

  "Lightning-infused Raptor's Talons (2H)": { check: twoHandedAttack((s) => s.weapon === "Raptor Talons" && s.infusion === "Lightning", "Lightning Raptor Talons 2H") },
  "Off-hand Rakshasa's Great Katana": { check: hasWeapon((s) => s.weapon === "Rakshasa's Great Katana", "left", "off-hand") },
  // ashes of war
  "Bloodhound's Step": { check: hasAsh("Bloodhound's Step") },
  Quickstep: { check: hasAsh("Quickstep") },
  "Raptor of the Mists": { check: hasAsh("Raptor of the Mists") },
  "All parries": { check: hasAsh("Parry", "Buckler Parry", "Carian Retaliation", "Golden Parry", "Golden Retaliation") },
  Endure: { check: hasAsh("Endure") },
  "Oath of Vengeance": { check: hasAsh("Oath of Vengeance") },
  "Royal Knight's Resolve": { check: hasAsh("Royal Knight's Resolve") },
  Determination: { check: hasAsh("Determination") },
  "Flaming Strike": { check: hasAsh("Flaming Strike") },
  "Storm Stomp": { check: hasAsh("Storm Stomp") },
  "Storm Assault": { check: hasAsh("Storm Assault") },
  Stormcaller: { check: hasAsh("Stormcaller") },
  "Swift Slash": { check: hasAsh("Swift Slash") },
  "Blind Spot": { check: hasAsh("Blind Spot") },
  "Needle Piercer": { check: hasAsh("Needle Piercer") },
  "Red Bear Hunt": { check: hasAsh("Red Bear Hunt") },
  "Fast Sword Dance": { check: hasAsh("Fast Sword Dance") },
  "Barbaric Roar": { check: hasAsh("Barbaric Roar") },
  "Shriek of Sorrow": { check: hasAsh("Shriek of Sorrow") },
  "Painful Strikes": { check: hasAsh("Painful Strikes") },
  "Savage Claws": { check: hasAsh("Savage Claws") },
  "Chilling Mist applied on cold-infused weapons": { check: (ctx) => slots(ctx, "any").filter(({ s }) => s.ashOfWar === "Chilling Mist" && s.infusion === "Cold").map(({ s }) => `Chilling Mist on Cold ${s.weapon}`) },
  "Spinning Slash on Light Greatswords": { check: (ctx) => slots(ctx, "any").filter(({ s }) => s.ashOfWar === "Spinning Slash" && category(ctx, s.weapon) === "Light Greatsword").map(({ s }) => `Spinning Slash on ${s.weapon}`) },
  Muleta: { check: hasAsh("Muleta") },
  "Ash-of-war damage-boosting talismans": { check: hasTalisman("Shard of Alexander", "Warrior Jar Shard") },
  // talismans
  "All i-frame-affecting talismans (Crucible Feather, Fine Crucible Feather, Talisman of All Crucibles)": { check: hasTalisman("Crucible Feather Talisman", "Fine Crucible Feather Talisman", "Talisman of All Crucibles") },
  "Red-Feathered Branchsword": { check: hasTalisman("Red-Feathered Branchsword") },
  "Two-Handed Sword Talisman": { check: hasTalisman("Two-Handed Sword Talisman") },
  "Spear Talisman with Sword Lance": { check: (ctx) => (ctx.fighter.equipped.talismans.includes("Spear Talisman") && slots(ctx, "any").some(({ s }) => s.weapon === "Sword Lance") ? ["Spear Talisman with Sword Lance"] : []) },
  "Ash-of-war damage talismans: Shard of Alexander, Warrior Jar Shard": { check: hasTalisman("Shard of Alexander", "Warrior Jar Shard") },
  "Dagger Talisman": { check: hasTalisman("Dagger Talisman") },
  "Blessed Dew Talisman": { check: hasTalisman("Blessed Dew Talisman") },
  // spells (builds carry no spells in phase 1)
  "Healing incantations (see general)": NOT_MODELLED("spells"),
  "Placidusax's Ruin": NOT_MODELLED("spells"),
  "Gravitational Missile": NOT_MODELLED("spells"),
  "Night Maiden's Mist": NOT_MODELLED("spells"),
  "Roar of Rugalea": NOT_MODELLED("spells"),
  "Absorption-increasing incantations: Golden Vow, Flame, Grant Me Strength, Protection of the Erdtree": NOT_MODELLED("spells"),
  "Dragonbolt Blessing": NOT_MODELLED("spells"),
  "Mantle of Thorns": NOT_MODELLED("spells"),
  // equipment
  "Light load (≤ 30% equip load)": { check: (ctx) => (ctx.fighter.equipLoad.percent <= 30 ? [`light load (${ctx.fighter.equipLoad.percent.toFixed(1)}%)`] : []) },
  "Briar armour (all pieces incl. Altered)": { check: hasArmour(/^Briar /) },
  "Royal Remains armour": { check: hasArmour(/^Royal Remains /) },
  "Rakshasa armour": { check: hasArmour(/^Rakshasa /) },
};

export const BUFF_RESTRICTION_TABLE: Record<string, RuleEntry> = {
  "2H Thrusting Sword (class)": buffTarget((ctx, s, c) => c === "Thrusting Sword" && twoHanding(ctx, (x) => x === s), "2H thrusting sword"),
  "2H Stone Club/Club": buffTarget((ctx, s) => ["Stone Club", "Club"].includes(s.weapon) && twoHanding(ctx, (x) => x === s), "2H club"),
  "2H Sword Lance": buffTarget((ctx, s) => s.weapon === "Sword Lance" && twoHanding(ctx, (x) => x === s), "2H Sword Lance"),
  "2H Raptor's Talons": buffTarget((ctx, s) => s.weapon === "Raptor Talons" && twoHanding(ctx, (x) => x === s), "2H Raptor Talons"),
  "Off-hand Daggers (class)": buffTarget((ctx, _s, c, hand) => c === "Dagger" && hand === "left" && attackHand(ctx) !== "right", "off-hand dagger"),
  "Off-hand Hatchets = the whole Axe class": buffTarget((ctx, _s, c, hand) => c === "Axe" && hand === "left" && attackHand(ctx) !== "right", "off-hand axe"),
  "Main-hand 1H Wakizashi": buffTarget((ctx, s, _c, hand) => s.weapon === "Wakizashi" && hand === "right" && !(ctx.attack?.twoHanded ?? false), "main-hand 1H Wakizashi"),
  "2H Great Spears (class) except Mohgwyn's Sacred Spear": buffTarget((ctx, s, c) => c === "Great Spear" && s.weapon !== "Mohgwyn's Sacred Spear" && twoHanding(ctx, (x) => x === s), "2H great spear"),
  "Shields (all classes)": buffTarget((_ctx, _s, c) => !!c && SHIELD_CLASSES.includes(c), "shield"),
  "2H Star Fists": buffTarget((ctx, s) => s.weapon === "Star Fist" && twoHanding(ctx, (x) => x === s), "2H Star Fist"),
  "2H Twinblades (class)": buffTarget((ctx, _s, c) => c === "Twinblade" && !!ctx.attack?.twoHanded, "2H twinblade"),
  "2H Reverse-Bladed Sword": buffTarget((ctx, s) => s.weapon === "Reverse-Bladed Sword" && twoHanding(ctx, (x) => x === s), "2H Reverse-Bladed Sword"),
  "Idus Sword": buffTarget((_ctx, s) => s.weapon === "Idus Sword", "Idus Sword"),
};

export function checkLegality(ruleset: LadderRuleset, ctx: LegalityContext): LegalityReport {
  const violations: Violation[] = [];
  const notChecked: LegalityReport["notChecked"] = [];
  const run = (section: string, rule: string, entry: RuleEntry | undefined) => {
    if (!entry) {
      notChecked.push({ rule, section, reason: "UNMAPPED rule — add it to LADDER_RULE_TABLE" });
      return;
    }
    if ("notCheckable" in entry) notChecked.push({ rule, section, reason: entry.notCheckable });
    else for (const detail of entry.check(ctx)) violations.push({ rule, section, detail });
  };
  for (const [section, rules] of Object.entries(ruleset.bans)) for (const rule of rules) run(`bans.${section}`, rule, LADDER_RULE_TABLE[rule]);
  for (const rule of ruleset.buffRestrictions.targets) run("buffRestrictions", rule, BUFF_RESTRICTION_TABLE[rule]);
  const rl = { required: ruleset.duel.runeLevel, actual: ctx.fighter.rl, ok: ctx.fighter.rl === ruleset.duel.runeLevel };
  return { legal: violations.length === 0 && rl.ok, ruleset: ruleset.name, runeLevel: rl, violations, notChecked };
}
