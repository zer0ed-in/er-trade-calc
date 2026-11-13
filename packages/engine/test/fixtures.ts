// Zod schemas + loaders for fixtures/golden. Tests read fixtures only through here,
// so a malformed fixture fails loudly instead of silently producing `undefined` expectations.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const Status = z.enum(["planner", "prototype", "data", "wiki", "stated-by-zer0"]);

export const StatsSchema = z.object({
  vig: z.number().int(),
  mnd: z.number().int(),
  end: z.number().int(),
  str: z.number().int(),
  dex: z.number().int(),
  int: z.number().int(),
  fth: z.number().int(),
  arc: z.number().int(),
});
const DamageStatsSchema = StatsSchema.pick({ str: true, dex: true, int: true, fth: true, arc: true });

const ArmourSchema = z.object({ head: z.string(), body: z.string(), arms: z.string(), legs: z.string() });

export const NeutralBuildSchema = z.object({
  id: z.string(),
  class: z.string(),
  rl: z.number().int(),
  stats: StatsSchema,
  rightHand: z.array(z.object({ weapon: z.string(), infusion: z.string(), upgrade: z.number().int(), ashOfWar: z.string().optional() })),
  armour: ArmourSchema,
  talismans: z.array(z.string()),
  buffs: z.array(z.string()),
});
export type NeutralBuild = z.infer<typeof NeutralBuildSchema>;

export const ArFixtureSchema = z.object({
  description: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      status: Status,
      verifiedOn: z.string().optional(),
      note: z.string().optional(),
      weapon: z.string(),
      infusion: z.string(),
      upgrade: z.number().int(),
      stats: DamageStatsSchema,
      twoHanded: z.boolean(),
      expected: z.object({
        physical: z.number().optional(),
        total: z.number().optional(),
        tolerance: z.number().optional(),
      }),
    }),
  ),
});

export const DamageFixtureSchema = z.object({
  description: z.string(),
  builds: z.record(z.string(), NeutralBuildSchema),
  cases: z.array(
    z.object({
      id: z.string(),
      status: Status,
      verifiedOn: z.string(),
      source: z.string(),
      scenario: z.literal("base"),
      pvp: z.literal(true),
      note: z.string(),
      attacker: z.string(),
      defender: z.string(),
      attack: z.string(),
      grip: z.enum(["1h", "2h"]).optional(),
      /** Multi-hit attacks: the planner displays floor(Σ unrounded hits); the engine floors each hit (in-game popups). */
      plannerTotal: z.literal("floor-of-sum").optional(),
      expected: z.object({
        damage: z.number().int(),
        plannerPhysicalColumn: z.number().optional(),
        mv: z.number().optional(),
        ar: z.number().optional(),
        defenderPhysicalDefence: z.number().int().optional(),
      }),
    }),
  ),
});

const DefenceTypes = z.object({
  physical: z.number().int(),
  magic: z.number().int().optional(),
  fire: z.number().int().optional(),
  lightning: z.number().int().optional(),
  holy: z.number().int().optional(),
});

export const DefencesFixtureSchema = z.object({
  description: z.string(),
  absorption: z.object({
    status: Status,
    verifiedOn: z.string(),
    armour: ArmourSchema,
    expectedPercent: z.object({
      physical: z.number(),
      strike: z.number(),
      slash: z.number(),
      pierce: z.number(),
      magic: z.number(),
      fire: z.number(),
      lightning: z.number(),
      holy: z.number(),
    }),
  }),
  cases: z.array(
    z.object({
      id: z.string(),
      status: Status,
      verifiedOn: z.string(),
      class: z.string(),
      stats: StatsSchema,
      rl: z.number().int(),
      expected: DefenceTypes,
    }),
  ),
});

export const PoiseFixtureSchema = z.object({
  description: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      status: Status,
      verifiedOn: z.string(),
      weapon: z.string(),
      attack: z.string(),
      expected: z.object({
        poiseDamage: z.number(),
        breaksAtOrBelow: z.number(),
        survivesFrom: z.number(),
      }),
    }),
  ),
  ladderMaxPoise: z.object({ value: z.number(), status: Status, note: z.string() }),
});

export const MiscFixtureSchema = z.object({
  description: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      status: Status,
      note: z.string().optional(),
      stats: StatsSchema.partial().optional(),
      armour: ArmourSchema.optional(),
      expected: z.record(z.string(), z.number()),
    }),
  ),
});

const FrameRange = z.tuple([z.number().int(), z.number().int()]);
export const FramesFixtureSchema = z.object({
  description: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      status: Status,
      note: z.string().optional(),
      animation: z.string().optional(),
      attackParam: z.string().optional(),
      spEffect: z.number().optional(),
      name: z.string().optional(),
      expected: z.object({
        dataStartup: z.number().int().optional(),
        plannerDisplay: z.string().optional(),
        damageLevel: z.number().int().optional(),
        poiseDamageFlat: z.number().optional(),
        physAttribute: z.string().optional(),
        activeFrames: z.union([FrameRange, z.array(FrameRange)]).optional(),
        counterFramesSpEffect45: FrameRange.optional(),
        speedGradient: z
          .object({ range: FrameRange, startSpeed: z.number(), endSpeed: z.number() })
          .optional(),
        cancels: z.record(z.string(), FrameRange).optional(),
        hyperArmour: z.object({ id: z.number().int(), range: FrameRange }).optional(),
        superArmour: FrameRange.optional(),
        thrustDamageCutRate: z.number().optional(),
      }),
    }),
  ),
});

const AttackHitSchema = z.object({
  id: z.string(),
  physicalMV: z.number().optional(),
  physicalFlat: z.number().optional(),
  lightningFlat: z.number().optional(),
  holyFlat: z.number().optional(),
  poiseDamageFlat: z.number().optional(),
  damageLevel: z.number().int().optional(),
  physAttribute: z.string().optional(),
  pvpFinalRate: z.number().optional(),
  startup: z.number().int(),
  atkParam: z.record(z.string(), z.number()).optional(),
});

export const AttacksFixtureSchema = z.object({
  description: z.string(),
  cases: z.array(
    z.union([
      z.object({ id: z.string(), status: Status, attack: z.string(), hits: z.array(AttackHitSchema) }),
      z.object({ id: z.literal("buff-values"), status: Status, note: z.string(), values: z.record(z.string(), z.number()) }),
      z.object({
        id: z.literal("skill-scaling-tables"),
        status: Status,
        source: z.string(),
        note: z.string(),
        tables: z.record(
          z.string(),
          z.object({ usedBy: z.string(), scales: z.union([z.record(z.string(), z.number()), z.string()]) }),
        ),
      }),
      z.object({ id: z.literal("aow-no-2h-flag"), status: Status, note: z.string(), rows: z.array(z.number().int()) }),
    ]),
  ),
});

export const EvidencePveFixtureSchema = z.object({
  description: z.string(),
  usableAsTests: z.array(z.string()),
  directionOnly: z.array(z.string()),
  builds: z.record(z.string(), z.unknown()),
  results: z.record(z.string(), z.unknown()),
});

export const RulesetFixtureSchema = z.object({
  name: z.string(),
  platform: z.literal("PC"),
  duel: z.object({ runeLevel: z.number().int(), rules: z.array(z.string()) }).passthrough(),
  bans: z.record(z.string(), z.array(z.string())),
  buffRestrictions: z.object({ description: z.string(), targets: z.array(z.string()) }),
  blacklistedGlitches: z.array(z.string()),
  engineNotes: z.array(z.string()),
  allowedExplicitly: z.array(z.string()),
  rulings: z.object({ by: z.string(), date: z.string(), items: z.array(z.string()) }),
});

export function loadFixture<T extends z.ZodTypeAny>(relativePath: string, schema: T): z.infer<T> {
  const raw: unknown = JSON.parse(readFileSync(REPO_ROOT + relativePath, "utf8"));
  return schema.parse(raw);
}

export const goldenAr = () => loadFixture("fixtures/golden/ar.json", ArFixtureSchema);
export const goldenDamage = () => loadFixture("fixtures/golden/damage.json", DamageFixtureSchema);
export const goldenDefences = () => loadFixture("fixtures/golden/defences.json", DefencesFixtureSchema);
export const goldenPoise = () => loadFixture("fixtures/golden/poise.json", PoiseFixtureSchema);
export const goldenMisc = () => loadFixture("fixtures/golden/misc.json", MiscFixtureSchema);
export const goldenFrames = () => loadFixture("fixtures/golden/frames.json", FramesFixtureSchema);
export const goldenAttacks = () => loadFixture("fixtures/golden/attacks.json", AttacksFixtureSchema);
export const goldenEvidencePve = () => loadFixture("fixtures/golden/evidence-pve.json", EvidencePveFixtureSchema);
export const ladderRuleset = () => loadFixture("fixtures/ruleset/erpvp-ladder.json", RulesetFixtureSchema);
