// Planner hit ids → the AtkParam_Pc row the game uses for the hit.
// Planner hit ids are BehaviorParam_PC ids (or, for child projectiles, AtkParam ids). The game resolves a behavior by its
// refType: 0 → AtkParam_Pc[refId]; 1 → Bullet[refId].atkId_Bullet → AtkParam_Pc. Reading AtkParam_Pc[hit id] directly
// (the old lookup) misses most rows and, where a same-numbered AtkParam row exists, can read an unrelated one.
type Row = Record<string, unknown>;

export interface ResolvedHitRow {
  atkParamId: number;
  via: "behavior" | "bullet" | "atk";
  behaviorId?: number;
  bulletId?: number;
  row: Row;
}

export interface HitResolver {
  /** The resolved AtkParam_Pc row, or why there is none. */
  resolve(hitId: number): ResolvedHitRow | { unresolved: string };
}

export function hitResolver(atkParam: Row[], behaviorParam: Row[], bullet: Row[]): HitResolver {
  const byId = (rows: Row[]) => new Map(rows.map((r) => [r["Row ID"] as number, r]));
  const atk = byId(atkParam), behaviors = byId(behaviorParam), bullets = byId(bullet);
  return {
    resolve(hitId) {
      const behavior = behaviors.get(hitId);
      if (!behavior) {
        const row = atk.get(hitId);
        return row ? { atkParamId: hitId, via: "atk", row } : { unresolved: `no BehaviorParam_PC or AtkParam_Pc row ${hitId}` };
      }
      const refType = behavior.refType as number, refId = behavior.refId as number;
      if (refType === 0) {
        const row = atk.get(refId);
        return row ? { atkParamId: refId, via: "behavior", behaviorId: hitId, row } : { unresolved: `behavior ${hitId} → AtkParam_Pc ${refId}, not in the copy` };
      }
      if (refType === 1) {
        const b = bullets.get(refId);
        if (!b) return { unresolved: `behavior ${hitId} → Bullet ${refId}, not in the copy` };
        const atkId = b.atkId_Bullet as number;
        const row = atk.get(atkId);
        return row ? { atkParamId: atkId, via: "bullet", behaviorId: hitId, bulletId: refId, row } : { unresolved: `behavior ${hitId} → Bullet ${refId} → AtkParam_Pc ${atkId}, not in the copy` };
      }
      return { unresolved: `behavior ${hitId} has refType ${refType} (neither attack nor bullet)` };
    },
  };
}
