import { describe, expect, it } from "vitest";
import { computeAttack, NEUTRAL_SITUATION, prepareFighter, resolveAttack, type Build } from "@ertc/engine";
import { data } from "./data.ts";
import { goldenInGame, type NeutralBuild } from "./fixtures.ts";

// In-game numbers (fixtures/golden/in-game.json). "in-game" cases must match exactly; "open" cases document known gaps
// (docs/09) and only check that the engine still gives the recorded value, so a fix shows up as a failing test to promote.
const fx = goldenInGame();
const asBuild = (b: NeutralBuild, weapon?: NeutralBuild["rightHand"][number]): Build => ({ ...b, rightHand: weapon ? [weapon] : b.rightHand, leftHand: [] });

function landed(c: (typeof fx.cases)[number]) {
  const attacker = prepareFighter(data, asBuild(fx.builds[c.attacker]!, c.weapon), { scenario: "base", extraBuffs: c.buffs ?? [] });
  const defender = prepareFighter(data, asBuild(fx.builds[c.defender]!), { scenario: "base" });
  const attack = resolveAttack(data, attacker.build, { attack: c.attack, hits: c.hits, ...(c.grip && { grip: c.grip }) });
  return computeAttack(data, attacker, attack, defender, NEUTRAL_SITUATION).hits.map((h) => h.damage);
}

describe("in-game damage — exact (fixtures/golden/in-game.json)", () => {
  for (const c of fx.cases.filter((x) => x.status === "in-game")) {
    it(`${c.id}${c.test ? ` (test ${c.test})` : ""}: ${c.expected.join(", ")}`, () => {
      expect(landed(c)).toEqual(c.expected);
    });
  }
});

describe("in-game damage — open gaps, documented in docs/09", () => {
  for (const c of fx.cases.filter((x) => x.status === "open")) {
    it(`${c.id}: game ${c.expected.join(", ")}, engine ${c.engineNow!.join(", ")}`, () => {
      expect(c.engineNow).toBeDefined();
      expect(landed(c)).toEqual(c.engineNow);
      expect(landed(c)).not.toEqual(c.expected);
    });
  }
});
