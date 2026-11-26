import { ABILITIES, ENEMIES, SLOW_CAP, TICKS_PER_SECOND, type EnemyKind } from '../config/balance';
import { enemyGold } from './economy';
import { MAPS } from '../config/map';
import { pathLength, pointAt } from './path';
import type { Enemy, SimEvent, State } from './types';
import { log10EnemyHp } from './waves';

export function createEnemy(state: State, kind: EnemyKind, dist = 0): Enemy {
  const { x, y } = pointAt(state.map, dist);
  return {
    id: state.nextEnemyId++, kind, dist, prevDist: dist, x, y,
    hp: 1, shield: ENEMIES[kind].shield ?? 0,
    log10MaxHp: log10EnemyHp(state.wave, kind),
    gold: enemyGold(state.wave, kind, state.greed, MAPS[state.map].goldMult),
    slows: [], brittleUntil: -1, stasisTick: -1, marked: false,
  };
}

/** The slow in effect now: the strongest one, capped (Stasis exceeds the cap), then reduced for resistant enemies. */
export function currentSlow(enemy: Enemy, tick: number): number {
  let strongest = 0;
  for (const s of enemy.slows) if (s.untilTick >= tick && s.amount > strongest) strongest = s.amount;
  const slow = enemy.stasisTick >= tick ? ABILITIES.stasis.slow : Math.min(SLOW_CAP, strongest);
  return slow * (ENEMIES[enemy.kind].slowTaken ?? 1);
}

export function addSlow(enemy: Enemy, amount: number, untilTick: number): void {
  const same = enemy.slows.find((s) => s.amount === amount);
  if (same) same.untilTick = Math.max(same.untilTick, untilTick);
  else enemy.slows.push({ amount, untilTick });
}

/** Moves and heals every enemy; enemies that reach the exit leave with hp 0. */
export function moveEnemies(state: State, events: SimEvent[]): void {
  const length = pathLength(state.map);
  for (const e of state.enemies) {
    const def = ENEMIES[e.kind];
    e.prevDist = e.dist;
    e.dist += (def.speed * (1 - currentSlow(e, state.tick))) / TICKS_PER_SECOND;
    if (e.dist >= length) {
      state.lives -= def.leakLives;
      e.hp = 0;
      events.push({ type: 'leak', enemyId: e.id, kind: e.kind });
      continue;
    }
    const at = pointAt(state.map, e.dist);
    e.x = at.x;
    e.y = at.y;
    if (def.regen) e.hp = Math.min(1, e.hp + def.regen / TICKS_PER_SECOND);
  }
  removeDead(state);
}

export function removeDead(state: State): void {
  if (state.enemies.some((e) => e.hp <= 0)) state.enemies = state.enemies.filter((e) => e.hp > 0);
}
