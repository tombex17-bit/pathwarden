import { describe, expect, it } from 'vitest';
import { GOLD } from '../../src/config/balance';
import { layoutOf, pointAt } from '../../src/sim/path';

const SWITCHBACK = layoutOf({ map: 'switchback', wildSeed: 0, walls: [] });
import { createNewGame, createState, step } from '../../src/sim/sim';
import type { SimEvent, State } from '../../src/sim/types';
import { buildSpawns, log10EnemyHp, slotCount } from '../../src/sim/waves';
import { addTower, build, buildAll, emptyField, hitIds, place, rich, run, until } from './helpers';

describe('path', () => {
  it('is 44 cells long and follows its corners', () => {
    expect(SWITCHBACK.length).toBe(44);
    expect(pointAt(SWITCHBACK, 0)).toEqual({ x: 0, y: 1 });
    expect(pointAt(SWITCHBACK, 14.5)).toEqual({ x: 13, y: 2.5 });
    expect(pointAt(SWITCHBACK, 44)).toEqual({ x: 16, y: 7 });
  });
});

describe('wave contents', () => {
  it('follows N(w)', () => {
    expect([1, 9, 10, 55, 120, 10000].map(slotCount)).toEqual([12, 12, 13, 17, 24, 24]);
  });

  it('spreads spawns evenly over 10 seconds', () => {
    const ticks = buildSpawns(1, 1, 1).map((s) => s.tick);
    expect(ticks).toHaveLength(12);
    expect(ticks).toEqual(ticks.map((_, i) => Math.round((300 * i) / 11)));
  });

  it('follows the HP formula and stays finite at wave 10,000', () => {
    expect(10 ** log10EnemyHp(1, 'grunt')).toBeCloseTo(14, 9);
    expect(10 ** log10EnemyHp(20, 'grunt')).toBeCloseTo(14 * 1.095 ** 19, 6);
    expect(log10EnemyHp(10000, 'grunt')).toBeGreaterThan(308);
    expect(log10EnemyHp(10000, 'grunt')).toBeLessThan(400);
  });
});

describe('waves', () => {
  it('start by themselves and never end before 24 s', () => {
    const s = rich(createState(1));
    step(s, buildAll());
    expect(until(s, 'waveClear') + 1).toBe(720);
    expect(s.wave).toBe(2);
    expect(s.bestRun).toBe(1);
    expect(s.bestEver).toBe(1);
    expect(until(s, 'waveClear')).toBe(720);
  });

  it('stay open past 24 s while an enemy lives', () => {
    const s = emptyField();
    place(s, 'grunt', 0);
    s.waveTick = 719;
    expect(run(s, 5).some((e) => e.type === 'waveClear')).toBe(false);
    s.enemies = [];
    expect(step(s).events.some((e) => e.type === 'waveClear')).toBe(true);
  });

  it('repeat the same wave when auto-advance is off', () => {
    const s = rich(createState(1));
    step(s, [...buildAll(), { type: 'setOption', option: 'autoAdvance', value: false }]);
    until(s, 'waveClear');
    expect(s.wave).toBe(1);
    expect(s.bestRun).toBe(1);
  });

  it('refill lives at each wave start', () => {
    const s = emptyField();
    s.lives = 3;
    s.waveTick = 719;
    step(s);
    expect(s.wave).toBe(2);
    expect(s.lives).toBe(10);
  });
});

describe('enemies', () => {
  it('remember their previous position', () => {
    const s = emptyField();
    const e = place(s, 'grunt', 0);
    run(s, 30);
    expect(e.dist).toBeCloseTo(2, 9);
    expect(e.dist - e.prevDist).toBeCloseTo(2 / 30, 9);
  });

  it('cost one life when they reach the exit and pay nothing', () => {
    const s = emptyField();
    place(s, 'grunt', 43.99);
    const gold = s.gold;
    expect(step(s).events.some((e) => e.type === 'leak')).toBe(true);
    expect(s.lives).toBe(9);
    expect(s.enemies).toHaveLength(0);
    expect(s.kills).toBe(0);
    expect(s.gold.eq(gold)).toBe(true);
  });
});

describe('losing', () => {
  it.each([[1, 1], [3, 1], [5, 1], [6, 1], [7, 2], [40, 35]])('from wave %i goes to wave %i', (from, to) => {
    const s = createState(1, from);
    const tower = addTower(s, 0, 'bolt', { weak: true, level: 7 });
    until(s, 'waveLost');
    expect(s.wave).toBe(to);
    expect(s.enemies).toHaveLength(0);
    expect(s.spawns).toHaveLength(0);
    expect(s.bestRun).toBe(0);
    expect(s.towers).toEqual([tower]);
    expect(s.gold.toNumber()).toBe(GOLD.start);
    expect(until(s, 'waveStart')).toBe(60);
    expect(s.lives).toBe(10);
    expect(s.wave).toBe(to);
  });

  it('needs ten leaks', () => {
    const s = createState(1);
    let leaks = 0;
    for (let i = 0; i < 2000 && s.restartTicks === 0; i++) {
      leaks += step(s).events.filter((e) => e.type === 'leak').length;
    }
    expect(leaks).toBe(10);
  });
});

describe('bolt', () => {
  it('kills a 14 HP grunt with four hits of 4, 15 steps apart', () => {
    const s = emptyField();
    place(s, 'grunt', 2);
    const events: [number, SimEvent][] = [];
    for (let i = 0; i < 80; i++) {
      for (const e of step(s, i === 0 ? [build(0)] : []).events) events.push([i, e]);
    }
    expect(events.filter(([, e]) => e.type === 'hit').map(([i]) => i)).toEqual([0, 15, 30, 45]);
    expect(events.filter(([, e]) => e.type === 'death').map(([i]) => i)).toEqual([45]);
    expect(s.kills).toBe(1);
    expect(s.enemies).toHaveLength(0);
  });

  it('does not hit beyond 2.8 cells', () => {
    const edge = 3 + Math.sqrt(2.8 ** 2 - 1.5 ** 2);
    for (const [dist, hits] of [[edge - 0.1, 1], [edge + 0.1, 0]] as const) {
      const s = emptyField();
      place(s, 'grunt', dist);
      expect(hitIds(step(s, [build(0)]).events)).toHaveLength(hits);
    }
  });

  it('targets the enemy farthest along the path', () => {
    const s = emptyField();
    place(s, 'grunt', 2);
    const first = place(s, 'grunt', 4);
    place(s, 'grunt', 3);
    expect(hitIds(step(s, [build(0)]).events)).toEqual([first.id]);
  });
});

describe('determinism', () => {
  it('gives the same state for the same seed and commands', () => {
    const play = (): State => {
      const s = createState(42);
      for (let i = 0; i < 30000; i++) {
        step(s, i % 900 === 0 ? [build((i / 900) % 12), { type: 'upgrade', slot: 0, amount: 'max' }] : []);
      }
      return s;
    };
    const a = play();
    expect(a).toEqual(play());
    expect(a.bestRun).toBeGreaterThan(10);
  });

  it('gives a different wave for a different seed or attempt', () => {
    const kinds = (seed: number, attempt: number): string => buildSpawns(seed, 60, attempt).map((x) => x.kind).join();
    expect(kinds(1, 1)).toBe(kinds(1, 1));
    expect(kinds(2, 1)).not.toBe(kinds(1, 1));
    expect(kinds(1, 2)).not.toBe(kinds(1, 1));
  });
});

describe('a brand-new game', () => {
  it('holds wave 1 until the first tower is built', () => {
    const s = createNewGame(1);
    const spawns = s.spawns.length;
    expect(run(s, 30 * 60)).toEqual([]);
    expect([s.waveTick, s.enemies.length, s.spawns.length, s.lives, s.gold.toNumber()]).toEqual([0, 0, spawns, 10, GOLD.start]);
    // Abilities still cool down, and commands still work.
    step(s, [build(5)]);
    expect(s.holdForTower).toBe(false);
    expect(s.waveTick).toBe(1);
    expect(s.enemies).toHaveLength(1);
  });

  it('does not hold again after the tower is sold', () => {
    const s = createNewGame(1);
    step(s, [build(5)]);
    step(s, [{ type: 'sell', slot: 5 }]);
    run(s, 30);
    expect(s.waveTick).toBe(32);
  });

  it('other new states start at once', () => {
    expect(createState(1).holdForTower).toBe(false);
  });
});
