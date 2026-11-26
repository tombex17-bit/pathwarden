import { DAMAGE, TOWERS, TOWER_KINDS, type SpecChoice, type TowerKind, type TowerStats } from '../config/balance';

type SpecKey = SpecChoice | 'none';

function variants(kind: TowerKind): Record<SpecKey, TowerStats> {
  const { stats, specs } = TOWERS[kind];
  return { none: stats, a: { ...stats, ...specs.a.change }, b: { ...stats, ...specs.b.change } };
}

const TABLE = Object.fromEntries(TOWER_KINDS.map((k) => [k, variants(k)])) as Record<TowerKind, Record<SpecKey, TowerStats>>;

/** A tower's stats including its specialization, before level and permanent bonuses. */
export function towerStats(kind: TowerKind, spec: SpecChoice | null): TowerStats {
  return TABLE[kind][spec ?? 'none'];
}

/** log10 of damage per hit; logs stay finite at any level. */
export function log10Damage(kind: TowerKind, spec: SpecChoice | null, level: number, power: number): number {
  return Math.log10(towerStats(kind, spec).damage)
    + Math.log10(level)
    + Math.floor(level / DAMAGE.milestoneLevels) * Math.log10(DAMAGE.milestoneMult)
    + power * Math.log10(DAMAGE.powerMult);
}
