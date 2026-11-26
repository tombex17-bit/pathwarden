import Decimal from 'break_infinity.js';
import { TICKS_PER_SECOND, type EnemyKind, type SpecChoice, type TowerKind } from '../../src/config/balance';
import { SLOT_COUNT } from '../../src/config/map';
import { createEnemy } from '../../src/sim/enemies';
import { createState, refreshDamage, step } from '../../src/sim/sim';
import type { Command, Enemy, SimEvent, State, Tower } from '../../src/sim/types';

export const build = (slot: number, tower: TowerKind = 'bolt'): Command => ({ type: 'build', slot, tower });
export const buildAll = (): Command[] => Array.from({ length: SLOT_COUNT }, (_, i) => build(i));

export function rich(state: State): State {
  state.gold = new Decimal('1e30');
  return state;
}

/** An empty field on which nothing spawns. */
export function emptyField(wave = 1): State {
  const s = rich(createState(1, wave));
  s.spawns = [];
  return s;
}

export function place(state: State, kind: EnemyKind, dist: number): Enemy {
  const e = createEnemy(state, kind, dist);
  state.enemies.push(e);
  return e;
}

/** Adds a tower directly; `weak` makes it unable to hurt anything noticeably. */
export function addTower(
  state: State, slot: number, kind: TowerKind, options: { spec?: SpecChoice; level?: number; weak?: boolean } = {},
): Tower {
  const t: Tower = {
    slot, kind, level: options.level ?? 1, spec: options.spec ?? null, cooldown: 0, log10Damage: 0,
    locks: [], buildPaid: new Decimal(50), upgradesPaid: new Decimal(0), tier: 1, kills: 0,
  };
  refreshDamage(state, t);
  if (options.weak) t.log10Damage = -99;
  state.towers.push(t);
  return t;
}

export function run(state: State, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(state).events);
  return events;
}

export const seconds = (s: number): number => Math.round(s * TICKS_PER_SECOND);

/** Steps until an event of the given type; returns how many steps it took. */
export function until(state: State, type: SimEvent['type'], limit = 5000): number {
  for (let i = 1; i <= limit; i++) {
    if (step(state).events.some((e) => e.type === type)) return i;
  }
  throw new Error(`No ${type} within ${limit} steps`);
}

/** Damage dealt to an enemy so far, in HP, shield included. */
export function dealt(enemy: Enemy, fullShield = 0): number {
  return (1 - enemy.hp + fullShield - enemy.shield) * 10 ** enemy.log10MaxHp;
}

export const hitIds = (events: SimEvent[]): number[] => events.flatMap((e) => (e.type === 'hit' ? [e.enemyId] : []));
