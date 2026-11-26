import Decimal from 'break_infinity.js';
import { describe, expect, it } from 'vitest';
import { HERO, MERGE, RANKS, TAP, TICKS_PER_SECOND } from '../../src/config/balance';
import { GRID_H, GRID_W, MAPS, MAP_IDS, PATH_WIDTH, SLOT_COUNT, SLOT_RADIUS, type Point } from '../../src/config/map';
import { log10FormationDps } from '../../src/sim/abilities';
import { buildCost, enemyGold } from '../../src/sim/economy';
import { pathLength, pointAt } from '../../src/sim/path';
import { canCallWave, createState, step } from '../../src/sim/sim';
import { log10Damage, rankOf } from '../../src/sim/stats';
import { heroOf } from '../../src/sim/towers';
import type { Command, SimEvent, State } from '../../src/sim/types';
import { addTower, emptyField, place, run } from './helpers';

const ok = { ok: true };
const results = (s: State, ...commands: Command[]): unknown[] => step(s, commands).results;
const events = (s: State, ...commands: Command[]): SimEvent[] => step(s, commands).events;

/** Distance from a point to the nearest point of a map's path. */
function toPath(map: (typeof MAP_IDS)[number], p: Point): number {
  let best = Infinity;
  for (let d = 0; d <= pathLength(map); d += 0.05) {
    const q = pointAt(map, d);
    best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return best;
}

describe('maps', () => {
  it.each(MAP_IDS)('%s: a path across the grid, and 12 slots clear of it, apart, and in reach', (map) => {
    const { path, slots } = MAPS[map];
    expect(path[0]!.x).toBe(0);
    expect(path[path.length - 1]!.x).toBe(GRID_W);
    for (let i = 1; i < path.length; i++) expect(path[i]!.x === path[i - 1]!.x || path[i]!.y === path[i - 1]!.y).toBe(true);
    expect(slots).toHaveLength(SLOT_COUNT);
    for (const [i, s] of slots.entries()) {
      expect(s.x - SLOT_RADIUS, `slot ${i}`).toBeGreaterThanOrEqual(0);
      expect(s.x + SLOT_RADIUS, `slot ${i}`).toBeLessThanOrEqual(GRID_W);
      expect(s.y - SLOT_RADIUS, `slot ${i}`).toBeGreaterThanOrEqual(0);
      expect(s.y + SLOT_RADIUS, `slot ${i}`).toBeLessThanOrEqual(GRID_H);
      const gap = toPath(map, s);
      expect(gap, `slot ${i} clear of the path`).toBeGreaterThanOrEqual(PATH_WIDTH / 2 + SLOT_RADIUS);
      // Every tower kind reaches the path from every slot (the shortest range is 2.4).
      expect(gap, `slot ${i} in reach`).toBeLessThanOrEqual(2);
      for (const [j, o] of slots.entries()) if (j > i) expect(Math.hypot(s.x - o.x, s.y - o.y), `slots ${i}, ${j}`).toBeGreaterThan(1.2);
    }
  });

  it('unlock in order, with more gold for harder maps', () => {
    expect(MAP_IDS.map((m) => [MAPS[m].unlockWave, MAPS[m].goldMult, pathLength(m)])).toEqual([[0, 1, 44], [25, 1.15, 34], [50, 1.3, 24]]);
  });

  it('changes only when the next wave starts, and towers keep their slots', () => {
    const s = emptyField();
    addTower(s, 3, 'bolt');
    expect(results(s, { type: 'setMap', map: 'crossroads' })).toEqual([{ ok: false, reason: 'Clear wave 25 first' }]);
    s.bestEver = 25;
    expect(results(s, { type: 'setMap', map: 'crossroads' })).toEqual([ok]);
    expect(s.map).toBe('switchback');
    s.waveTick = 24 * TICKS_PER_SECOND;
    const e = events(s);
    expect(e).toContainEqual({ type: 'mapChange', map: 'crossroads' });
    expect(s.map).toBe('crossroads');
    expect(s.towers.map((t) => t.slot)).toEqual([3]);
    expect(results(s, { type: 'setMap', map: 'nowhere' as never })).toEqual([{ ok: false, reason: 'No such map' }]);
  });

  it('enemies follow the map and pay its gold', () => {
    const s = createState(1);
    s.map = s.nextMap = 'shortcut';
    const e = place(s, 'grunt', 5);
    expect([e.x, e.y]).toEqual([5, 6]);
    expect(e.gold.toNumber()).toBeCloseTo(enemyGold(1, 'grunt', 0).toNumber() * 1.3, 9);
    e.dist = 23.99;
    run(s, 2);
    expect(s.lives).toBe(9);
  });
});

describe('the Warden', () => {
  const unlocked = (): State => {
    const s = emptyField();
    s.bestEver = HERO.unlockWave;
    return s;
  };

  it('unlocks after wave 5 and is placed for free on an empty slot', () => {
    const s = emptyField();
    const gold = s.gold;
    expect(results(s, { type: 'placeHero', slot: 0 })).toEqual([{ ok: false, reason: 'Clear wave 5 first' }]);
    s.bestEver = 5;
    expect(results(s, { type: 'placeHero', slot: 0 })).toEqual([ok]);
    expect(heroOf(s)).toMatchObject({ slot: 0, kind: 'warden', level: 1 });
    expect(s.gold.eq(gold)).toBe(true);
    expect(results(s, { type: 'build', slot: 0, tower: 'bolt' }, { type: 'build', slot: 1, tower: 'warden' })).toEqual([
      { ok: false, reason: 'Slot is taken' }, { ok: false, reason: 'No such tower' },
    ]);
  });

  it('does not count toward build prices and cannot be upgraded, specialized, sold or merged', () => {
    const s = unlocked();
    step(s, [{ type: 'placeHero', slot: 0 }]);
    s.gold = new Decimal(100);
    const gold = s.gold;
    step(s, [{ type: 'build', slot: 1, tower: 'bolt' }]);
    expect(gold.sub(s.gold).eq(buildCost(0))).toBe(true);
    const refused = { ok: false, reason: 'The Warden levels up by itself and cannot be sold' };
    expect(results(s, { type: 'upgrade', slot: 0, amount: 1 }, { type: 'sell', slot: 0 }, { type: 'merge', slot: 0, from: 1 })).toEqual([refused, refused, refused]);
  });

  it('moves to another empty slot, then waits 10 seconds before moving again', () => {
    const s = unlocked();
    addTower(s, 1, 'bolt');
    step(s, [{ type: 'placeHero', slot: 0 }]);
    expect(results(s, { type: 'placeHero', slot: 1 }, { type: 'placeHero', slot: 0 })).toEqual([
      { ok: false, reason: 'Slot is taken' }, { ok: false, reason: 'The Warden is already there' },
    ]);
    expect(results(s, { type: 'placeHero', slot: 5 })).toEqual([ok]);
    expect(heroOf(s)!.slot).toBe(5);
    expect(results(s, { type: 'placeHero', slot: 6 })).toEqual([{ ok: false, reason: 'The Warden is still on the move' }]);
    run(s, HERO.moveSeconds * TICKS_PER_SECOND);
    expect(results(s, { type: 'placeHero', slot: 6 })).toEqual([ok]);
    expect(s.towers.filter((t) => t.kind === 'warden')).toHaveLength(1);
  });

  it('boosts towers within 2.6 cells (the next slot over) by 15%, and only those', () => {
    const s = unlocked();
    const near = addTower(s, 1, 'bolt');
    const far = addTower(s, 3, 'bolt');
    const base = near.log10Damage;
    // Slots 0 and 1 are 2.5 cells apart on the first map; slot 3 is 7.5 cells away.
    step(s, [{ type: 'placeHero', slot: 0 }]);
    expect(10 ** (near.log10Damage - base)).toBeCloseTo(HERO.auraMult, 9);
    expect(far.log10Damage).toBeCloseTo(base, 12);
    // Moving away takes the boost along.
    run(s, HERO.moveSeconds * TICKS_PER_SECOND);
    step(s, [{ type: 'placeHero', slot: 10 }]);
    expect(near.log10Damage).toBeCloseTo(base, 12);
  });

  it('gains half of all kill gold as experience and buys levels at upgrade prices', () => {
    const s = unlocked();
    step(s, [{ type: 'placeHero', slot: 0 }]);
    s.heroXp = new Decimal(0);
    const e = place(s, 'grunt', 5);
    e.gold = new Decimal(100);
    addTower(s, 1, 'bolt', { level: 500 });
    const all = run(s, 3);
    // 50 experience buys level 2 (20 x 1.09 = 21.8) and level 3 (23.76), leaving 4.44.
    expect(heroOf(s)!.level).toBe(3);
    expect(s.heroXp.toNumber()).toBeCloseTo(50 - 21.8 - 23.762, 6);
    expect(all).toContainEqual({ type: 'heroLevel', level: 3 });
  });

  it('stays in its slot through a prestige, back at level 1', () => {
    const s = unlocked();
    step(s, [{ type: 'placeHero', slot: 7 }]);
    heroOf(s)!.level = 80;
    s.heroXp = new Decimal(5);
    Object.assign(s, { bestRun: 104, bestEver: 110, clearedThisRun: 10 });
    step(s, [{ type: 'prestige' }]);
    expect(s.towers).toHaveLength(1);
    expect(heroOf(s)).toMatchObject({ slot: 7, level: 1 });
    expect(s.heroXp.toNumber()).toBe(0);
    expect(s.layout[7]).toBeNull();
  });
});

describe('tapping enemies', () => {
  it('hits the nearest enemy within reach for a tenth of a second of formation damage, at most 5 times a second', () => {
    // Wave 40 enemies survive the tap, so the damage can be measured.
    const s = emptyField(40);
    addTower(s, 11, 'bolt', { weak: false, level: 40 });
    const a = place(s, 'brute', 3);
    place(s, 'brute', 4);
    const tapAt = (x: number): unknown => results(s, { type: 'tap', x, y: 1 })[0];
    expect(tapAt(3.4)).toEqual(ok);
    const expected = 10 ** (log10FormationDps(s) + Math.log10(TAP.dpsSeconds) - a.log10MaxHp);
    expect(1 - a.hp).toBeCloseTo(expected, 9);
    expect(tapAt(3)).toEqual({ ok: false, reason: 'Too fast' });
    run(s, 5);
    expect(tapAt(3)).toEqual(ok);
    expect(tapAt(9)).toEqual({ ok: false, reason: 'Too fast' });
    run(s, 6);
    expect(tapAt(9)).toEqual({ ok: false, reason: 'Nothing to hit' });
  });

  it('deals at least 4 damage, and its kills pay gold but give no tower credit', () => {
    const s = emptyField();
    s.gold = new Decimal(0);
    const e = place(s, 'grunt', 3);
    let all: SimEvent[] = [];
    for (let i = 0; i < 4; i++) {
      all = all.concat(events(s, { type: 'tap', x: e.x, y: e.y }));
      run(s, 6);
    }
    expect(all.filter((x) => x.type === 'tap')).toHaveLength(4);
    expect(s.enemies).toHaveLength(0);
    expect(s.gold.toNumber()).toBe(2);
  });
});

describe('calling the next wave', () => {
  it('is possible once the field is clear, before the 24 second minimum, and records the shorter wave', () => {
    const s = createState(1);
    expect(results(s, { type: 'callWave' })).toEqual([{ ok: false, reason: 'The wave is still running' }]);
    s.spawns = [];
    s.enemies = [];
    s.waveTick = 300;
    expect(canCallWave(s)).toBe(true);
    const e = events(s, { type: 'callWave' });
    expect(e).toContainEqual({ type: 'waveClear', wave: 1 });
    expect(s.wave).toBe(2);
    expect(s.history[0]!.ticks).toBe(300);
    expect(s.spawns.length).toBeGreaterThan(0);
  });

  it('is not possible while a brand-new game waits, or after a loss', () => {
    const s = createState(1);
    s.spawns = [];
    s.holdForTower = true;
    expect(canCallWave(s)).toBe(false);
    s.holdForTower = false;
    s.restartTicks = 10;
    expect(canCallWave(s)).toBe(false);
  });
});

describe('merging', () => {
  const two = (level = 20): State => {
    const s = emptyField();
    addTower(s, 0, 'bolt', { level });
    addTower(s, 1, 'bolt', { level: level + 5 });
    s.towers[0]!.kills = 30;
    s.towers[1]!.kills = 40;
    return s;
  };

  it('needs the same kind, specialization and tier, and level 10 on both', () => {
    const s = emptyField();
    addTower(s, 0, 'bolt', { level: 30 });
    addTower(s, 1, 'cannon', { level: 30 });
    addTower(s, 2, 'bolt', { level: 30, spec: 'a' });
    addTower(s, 3, 'bolt', { level: 9 });
    const merge = (from: number): unknown => results(s, { type: 'merge', slot: 0, from })[0];
    expect(merge(0)).toEqual({ ok: false, reason: 'Pick another tower to merge' });
    expect(merge(5)).toEqual({ ok: false, reason: 'Pick another tower to merge' });
    expect(merge(1)).toEqual({ ok: false, reason: 'Only towers of the same kind merge' });
    expect(merge(2)).toEqual({ ok: false, reason: 'Both need the same specialization' });
    expect(merge(3)).toEqual({ ok: false, reason: `Both need level ${MERGE.minLevel}` });
    expect(s.towers).toHaveLength(4);
  });

  it('makes the next tier: x2.5 damage, the higher level, both towers\' kills and prices, and frees the other slot', () => {
    const s = two();
    const [a, b] = s.towers as [State['towers'][number], State['towers'][number]];
    const paid = a.buildPaid.add(b.buildPaid);
    const e = events(s, { type: 'merge', slot: 0, from: 1 });
    expect(e).toContainEqual({ type: 'merge', slot: 0, kind: 'bolt', tier: 2 });
    expect(s.towers).toEqual([a]);
    expect([a.tier, a.level, a.kills]).toEqual([2, 25, 70]);
    expect(a.buildPaid.eq(paid)).toBe(true);
    expect(a.log10Damage).toBeCloseTo(log10Damage('bolt', null, 25, 0, 2, rankOf(70)), 12);
    expect(10 ** (log10Damage('bolt', null, 25, 0, 2) - log10Damage('bolt', null, 25, 0, 1))).toBeCloseTo(MERGE.tierMult, 9);
    // One tower fewer, so the next build is cheaper.
    expect(s.towers.length).toBe(1);
    expect(buildCost(1).toNumber()).toBe(80);
  });

  it('stops at tier 3', () => {
    const s = two();
    step(s, [{ type: 'merge', slot: 0, from: 1 }]);
    addTower(s, 2, 'bolt', { level: 20 });
    s.towers[1]!.tier = 2;
    expect(results(s, { type: 'merge', slot: 0, from: 2 })).toEqual([ok]);
    expect(s.towers[0]!.tier).toBe(3);
    addTower(s, 3, 'bolt', { level: 20 });
    s.towers[1]!.tier = 3;
    expect(results(s, { type: 'merge', slot: 0, from: 3 })).toEqual([{ ok: false, reason: 'Already at the highest tier' }]);
  });
});

describe('ranks', () => {
  it('rise at 10, 50, 250, 1000 and 5000 kills, each worth x1.1 damage', () => {
    expect([0, 9, 10, 49, 50, 250, 999, 1000, 5000, 1e9].map(rankOf)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 5, 5]);
    expect(RANKS.kills).toHaveLength(5);
    expect(10 ** (log10Damage('bolt', null, 1, 0, 1, 3) - log10Damage('bolt', null, 1, 0))).toBeCloseTo(1.1 ** 3, 9);
  });

  it('come from finishing enemies off, and raise damage at once', () => {
    const s = emptyField();
    const t = addTower(s, 0, 'bolt', { level: 300 });
    t.kills = 9;
    const before = t.log10Damage;
    place(s, 'grunt', 3);
    const e = run(s, 2);
    expect(t.kills).toBe(10);
    expect(e).toContainEqual({ type: 'rankUp', slot: 0, kind: 'bolt', rank: 1 });
    expect(t.log10Damage - before).toBeCloseTo(Math.log10(RANKS.mult), 12);
  });
});
