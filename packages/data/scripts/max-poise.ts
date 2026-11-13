// Q4 check: highest poise reachable at medium load for the D16 template (Heavy Knight, 40 end), excluding ladder-banned armour.
// Usage: pnpm exec tsx packages/data/scripts/max-poise.ts [carriedWeight=4.0] [endurance=40]
import { loadGameData } from "../src/index.ts";
const data = loadGameData();
const carried = Number(process.argv[2] ?? 4.0); // Shamshir 3.5 + Bull-Goat's Talisman 0.5
const endurance = Number(process.argv[3] ?? 40); // reference builds: dextra 40, strenuous 42
const maxLoad = data.raw.statTables.maxEquipLoadByEndurance[endurance]!;
const budget = maxLoad * 0.7 - carried - 1e-9; // medium roll: < 70%
const banned = /^(Briar|Royal Remains|Rakshasa) /;
const bullGoat = data.talismans.get("Bull-Goat's Talisman")!.effects.find((e) => e.attribute === "Poise")!.value;
type P = { name: string; weight: number; poise: number };
const bySlot = (slot: string): P[] => [{ name: "(none)", weight: 0, poise: 0 }, ...data.raw.armour.filter((a) => a.slot === slot && !banned.test(a.name))];
const pareto = (xs: P[][]) => {
  const combos = xs[0]!.flatMap((a) => xs[1]!.map((b) => ({ parts: [a, b], weight: a.weight + b.weight, poise: a.poise + b.poise })));
  combos.sort((p, q) => p.weight - q.weight || q.poise - p.poise);
  const front: typeof combos = [];
  for (const c of combos) if (!front.length || c.poise > front[front.length - 1]!.poise) front.push(c);
  return front;
};
const hb = pareto([bySlot("head"), bySlot("body")]);
const al = pareto([bySlot("arms"), bySlot("legs")]);
let best = { poise: -1, weight: 0, parts: [] as P[] };
for (const x of hb) for (const y of al) {
  const w = x.weight + y.weight;
  if (w <= budget && x.poise + y.poise > best.poise) best = { poise: x.poise + y.poise, weight: w, parts: [...x.parts, ...y.parts] };
}
console.log(`max load ${maxLoad.toFixed(2)}, armour budget < ${budget.toFixed(2)} (carrying ${carried})`);
console.log(`best armour poise ${best.poise} (weight ${best.weight.toFixed(1)}): ${best.parts.map((p) => p.name).join(", ")}`);
console.log(`with Bull-Goat's Talisman ×${bullGoat}: ${(best.poise * bullGoat).toFixed(2)} (floor ${Math.floor(best.poise * bullGoat)})`);
