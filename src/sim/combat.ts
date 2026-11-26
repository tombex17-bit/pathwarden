import { BEAM_RAMP_PER_SECOND, BOUNTY_MULT, BRITTLE, CHAIN, SLOW_SECONDS, TICKS_PER_SECOND, type TowerStats } from '../config/balance';
import type { Point } from '../config/map';
import { addSlow, removeDead } from './enemies';
import { slotsOf } from './path';
import { creditKill, gainHeroXp } from './towers';
import { towerStats } from './stats';
import type { Enemy, RampLock, SimEvent, State, Tower } from './types';

/** Absorbs rounding so that a hit equal to the remaining HP always kills. */
const HP_EPSILON = 1e-9;

export const distSq = (a: Point, b: Point): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function fireTowers(state: State, events: SimEvent[]): void {
  for (const tower of state.towers) {
    if (tower.cooldown > 0) tower.cooldown--;
    if (tower.cooldown > 0) continue;
    const stats = towerStats(tower.kind, tower.spec);
    const targets = findTargets(state, tower, stats);
    if (targets.length === 0) {
      tower.cooldown = 0;
      tower.locks = [];
      continue;
    }
    tower.cooldown += TICKS_PER_SECOND / stats.hitsPerSecond;
    fire(state, tower, stats, targets, events);
  }
  removeDead(state);
}

function fire(state: State, tower: Tower, stats: TowerStats, targets: Enemy[], events: SimEvent[]): void {
  if (stats.rampCap > 0) tower.locks = targets.map((t) => keepLock(tower, t, state.tick));

  targets.forEach((target, i) => {
    const points: Point[] = [slotsOf(state.map)[tower.slot]!, { x: target.x, y: target.y }];
    events.push({ type: 'shot', slot: tower.slot, kind: tower.kind, points, splash: stats.splash });

    if (stats.splash > 0) {
      const center = { x: target.x, y: target.y };
      for (const e of state.enemies) {
        if (e.hp > 0 && distSq(e, center) <= stats.splash ** 2) hit(state, tower, stats, e, 1, events);
      }
      return;
    }

    const lock = tower.locks[i];
    const ramp = lock ? Math.min(stats.rampCap, (BEAM_RAMP_PER_SECOND * (state.tick - lock.sinceTick)) / TICKS_PER_SECOND) : 0;
    hit(state, tower, stats, target, 1 + ramp, events);

    const chained = [target];
    for (let jump = 1; jump <= stats.jumps; jump++) {
      const next = nearestUnhit(state, chained);
      if (!next) break;
      chained.push(next);
      points.push({ x: next.x, y: next.y });
      hit(state, tower, stats, next, CHAIN.falloff ** jump, events);
    }
  });
}

function keepLock(tower: Tower, target: Enemy, tick: number): RampLock {
  return tower.locks.find((l) => l.enemyId === target.id) ?? { enemyId: target.id, sinceTick: tick };
}

function nearestUnhit(state: State, chained: Enemy[]): Enemy | undefined {
  const from = chained[chained.length - 1]!;
  let best: Enemy | undefined;
  let bestSq = CHAIN.range ** 2;
  for (const e of state.enemies) {
    if (e.hp <= 0 || chained.includes(e)) continue;
    const d = distSq(e, from);
    if (d <= bestSq) {
      best = e;
      bestSq = d;
    }
  }
  return best;
}

function hit(state: State, tower: Tower, stats: TowerStats, enemy: Enemy, mult: number, events: SimEvent[]): void {
  events.push({ type: 'hit', slot: tower.slot, kind: tower.kind, enemyId: enemy.id });
  damage(state, enemy, tower.log10Damage, mult, stats.ignoresShield, events, tower);
  if (stats.slow > 0) addSlow(enemy, stats.slow, state.tick + SLOW_SECONDS * TICKS_PER_SECOND);
  if (stats.brittle) enemy.brittleUntil = state.tick + BRITTLE.seconds * TICKS_PER_SECOND;
}

/** Applies one hit: shield first unless bypassed, then HP. A tower that lands the killing blow gets the credit. */
export function damage(
  state: State, enemy: Enemy, log10Damage: number, mult: number, ignoresShield: boolean, events: SimEvent[], by?: Tower,
): void {
  if (enemy.hp <= 0) return;
  const brittle = enemy.brittleUntil >= state.tick ? BRITTLE.mult : 1;
  let left = 10 ** (log10Damage - enemy.log10MaxHp) * mult * brittle;
  if (!ignoresShield) {
    const absorbed = Math.min(enemy.shield, left);
    enemy.shield -= absorbed;
    left -= absorbed;
  }
  enemy.hp -= Math.min(enemy.hp, left);
  if (enemy.hp > HP_EPSILON) return;
  kill(state, enemy, events);
  if (by) creditKill(state, by, events);
}

/** Kills at once and pays out. */
export function kill(state: State, enemy: Enemy, events: SimEvent[]): void {
  const gold = enemy.marked ? enemy.gold.mul(BOUNTY_MULT) : enemy.gold;
  enemy.hp = 0;
  state.kills++;
  state.gold = state.gold.add(gold);
  state.waveGold = state.waveGold.add(enemy.gold);
  events.push({ type: 'death', enemyId: enemy.id, kind: enemy.kind, x: enemy.x, y: enemy.y, gold });
  gainHeroXp(state, gold, events);
}

/** Living enemies in range, best first, at most as many as the tower can hit. */
function findTargets(state: State, tower: Tower, stats: TowerStats): Enemy[] {
  const at = slotsOf(state.map)[tower.slot]!;
  const rangeSq = stats.range ** 2;
  const better = stats.targeting === 'highestHp' ? hasMoreHp : isFarther;
  const found: Enemy[] = [];
  for (const e of state.enemies) {
    if (e.hp <= 0 || distSq(e, at) > rangeSq) continue;
    let i = found.length;
    while (i > 0 && better(e, found[i - 1]!)) i--;
    if (i >= stats.targets) continue;
    found.splice(i, 0, e);
    if (found.length > stats.targets) found.pop();
  }
  return found;
}

function isFarther(a: Enemy, b: Enemy): boolean {
  return a.dist > b.dist;
}

function hasMoreHp(a: Enemy, b: Enemy): boolean {
  const diff = a.log10MaxHp + Math.log10(a.hp) - b.log10MaxHp - Math.log10(b.hp);
  return Math.abs(diff) > 1e-12 ? diff > 0 : isFarther(a, b);
}
