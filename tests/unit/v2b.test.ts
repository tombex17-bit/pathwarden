import Decimal from 'break_infinity.js';
import { describe, expect, it } from 'vitest';
import { CHALLENGES, OVERDRIVE, RALLY, TICKS_PER_SECOND } from '../../src/config/balance';
import { GRID_W, MAZE } from '../../src/config/map';
import { enemyGold } from '../../src/sim/economy';
import { cellOf, generateWilds, layoutOf, mazeRoute, wildsGold } from '../../src/sim/path';
import { coresFor, prestigeCores } from '../../src/sim/prestige';
import { canEditWalls, createState, step } from '../../src/sim/sim';
import type { Command, State } from '../../src/sim/types';
import { log10EnemyHp } from '../../src/sim/waves';
import { decode, encode } from '../../src/platform/save';
import { defaultSettings } from '../../src/platform/settings';
import { Session } from '../../src/platform/session';
import { addTower, emptyField, place, run } from './helpers';
import { checkLayout } from './layout-check';

const ok = { ok: true };
const results = (s: State, ...commands: Command[]): unknown[] => step(s, commands).results;

describe('the Wilds: generated roads', () => {
  it('every seed gives a well laid out road with 12 slots', () => {
    for (let seed = 0; seed < 60; seed++) checkLayout(layoutOf({ map: 'wilds', wildSeed: seed, walls: [] }), `seed ${seed}`);
  });

  it('the same seed gives the same road, and other seeds give other roads', () => {
    expect(generateWilds(7)).toEqual(generateWilds(7));
    const roads = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(generateWilds(i).path)));
    expect(roads.size).toBeGreaterThan(15);
  });

  it('shorter roads pay more gold, from x1 at 44 cells up to x1.3', () => {
    expect([60, 44, 30, 23, 10].map(wildsGold)).toEqual([1, 1, 1.2, 1.3, 1.3]);
  });

  it('a new road comes with each switch to the Wilds and each prestige there', () => {
    const s = emptyField();
    s.bestEver = 110;
    step(s, [{ type: 'setMap', map: 'wilds' }]);
    s.waveTick = 24 * TICKS_PER_SECOND;
    step(s);
    expect(s.map).toBe('wilds');
    const first = s.wildSeed;
    Object.assign(s, { bestRun: 104, clearedThisRun: 10 });
    step(s, [{ type: 'prestige' }]);
    expect(s.wildSeed).not.toBe(first);
  });
});

describe('the Maze: walls the player places', () => {
  const maze = (): State => {
    const s = emptyField();
    s.bestEver = 80;
    s.map = s.nextMap = 'maze';
    return s;
  };
  const wall = (s: State, x: number, y: number): unknown => results(s, { type: 'toggleWall', x, y })[0];

  it('without walls, enemies take the shortest way: one row over, past both middle slots', () => {
    const l = layoutOf({ map: 'maze', wildSeed: 0, walls: [] });
    checkLayout(l, 'empty maze', false);
    expect(l.length).toBe(GRID_W + 2);
  });

  it('a wall on the road sends it around; removing the wall brings the road back', () => {
    const s = maze();
    const before = mazeRoute([])!;
    const onRoad = before[8]!;
    const at = { x: (onRoad % GRID_W) + 0.5, y: Math.floor(onRoad / GRID_W) + 0.5 };
    expect(wall(s, at.x, at.y)).toEqual(ok);
    expect(s.walls).toEqual([cellOf(at.x, at.y)]);
    expect(mazeRoute(s.walls)).not.toContain(onRoad);
    expect(layoutOf(s).length).toBeGreaterThanOrEqual(layoutOf({ map: 'maze', wildSeed: 0, walls: [] }).length);
    expect(wall(s, at.x - 0.3, at.y + 0.3)).toEqual(ok);
    expect(s.walls).toEqual([]);
    expect(mazeRoute(s.walls)).toEqual(before);
  });

  it('keeps the entrance, the exit, the slots and a way through open, and stops at 30 walls', () => {
    const s = maze();
    expect(wall(s, 0.5, 4.5)).toEqual({ ok: false, reason: 'That square must stay open' });
    expect(wall(s, 15.5, 4.5)).toEqual({ ok: false, reason: 'That square must stay open' });
    expect(wall(s, 2.5, 2.5)).toEqual({ ok: false, reason: 'That square must stay open' });
    expect(wall(s, -1, 2)).toEqual({ ok: false, reason: 'Outside the field' });
    // A full column except one square, then that square too.
    for (let y = 0; y < 9; y++) if (y !== 4) expect(wall(s, 4.5, y + 0.5)).toEqual(ok);
    expect(wall(s, 4.5, 4.5)).toEqual({ ok: false, reason: 'Enemies need a way through' });
    for (let y = 0; y < 9 && s.walls.length < MAZE.maxWalls; y++) {
      for (const x of [8.5, 12.5]) if (s.walls.length < MAZE.maxWalls && y !== 4) wall(s, x, y + 0.5);
    }
    for (let y = 0; s.walls.length < MAZE.maxWalls; y++) wall(s, 1.5, y + 0.5);
    expect(s.walls).toHaveLength(30);
    expect(wall(s, 14.5, 0.5)).toEqual({ ok: false, reason: 'At most 30 walls' });
    expect(mazeRoute(s.walls)).toBeDefined();
  });

  it('walls change only while the road is empty, or any time while the Maze is only chosen', () => {
    const s = maze();
    place(s, 'grunt', 1);
    expect(canEditWalls(s)).toBe(false);
    expect(wall(s, 3.5, 3.5)).toEqual({ ok: false, reason: 'Walls change only while the road is empty' });
    const planned = emptyField();
    planned.bestEver = 80;
    step(planned, [{ type: 'setMap', map: 'maze' }]);
    place(planned, 'grunt', 1);
    expect(wall(planned, 3.5, 3.5)).toEqual(ok);
  });

  it('enemies walk the road around the walls', () => {
    const s = maze();
    const first = mazeRoute([])![3]!;
    step(s, [{ type: 'toggleWall', x: (first % GRID_W) + 0.5, y: Math.floor(first / GRID_W) + 0.5 }]);
    const l = layoutOf(s);
    for (let d = 0; d < l.length; d += 0.25) {
      const e = place(s, 'grunt', d);
      expect(s.walls).not.toContain(cellOf(Math.min(e.x, GRID_W - 0.01), e.y));
    }
  });
});

describe('Overdrive', () => {
  it('doubles one tower\'s attack speed for 8 seconds, then needs 40 seconds', () => {
    const s = emptyField();
    const t = addTower(s, 0, 'bolt', { weak: true });
    // A Brute walks past slot 0 for about 2 seconds: 1 second plain, then 1 second boosted.
    place(s, 'brute', 2);
    const count = (ticks: number): number => run(s, ticks).filter((e) => e.type === 'shot').length;
    expect(count(TICKS_PER_SECOND)).toBe(2);
    expect(results(s, { type: 'boost', slot: 0 })).toEqual([ok]);
    expect(count(TICKS_PER_SECOND)).toBe(4);
    expect(results(s, { type: 'boost', slot: 0 })).toEqual([{ ok: false, reason: 'Overdrive is not ready' }]);
    run(s, (OVERDRIVE.seconds - 1) * TICKS_PER_SECOND);
    // Just ended: the 40 second wait has started.
    expect(t.boostTicks).toBe(0);
    expect(t.boostCooldown).toBeGreaterThan(OVERDRIVE.cooldownSeconds * TICKS_PER_SECOND - 5);
    run(s, OVERDRIVE.cooldownSeconds * TICKS_PER_SECOND);
    expect(results(s, { type: 'boost', slot: 0 })).toEqual([ok]);
    expect(results(s, { type: 'boost', slot: 5 })).toEqual([{ ok: false, reason: 'Slot is empty' }]);
  });
});

describe('Rally', () => {
  it('needs the Warden, then gives every tower x1.5 damage for 8 seconds, then needs 60 seconds', () => {
    const s = emptyField(40);
    s.bestEver = 40;
    addTower(s, 3, 'bolt', { level: 30 });
    expect(results(s, { type: 'rally' })).toEqual([{ ok: false, reason: 'Place the Warden first' }]);
    step(s, [{ type: 'placeHero', slot: 11 }]);
    const hit = (): number => {
      const e = place(s, 'brute', 9);
      for (let i = 0; i < 60 && e.hp === 1; i++) step(s);
      const dealt = 1 - e.hp;
      s.enemies = [];
      return dealt;
    };
    const plain = hit();
    expect(results(s, { type: 'rally' })).toEqual([ok]);
    expect(hit() / plain).toBeCloseTo(RALLY.damageMult, 6);
    expect(results(s, { type: 'rally' })).toEqual([{ ok: false, reason: 'Rally is not ready' }]);
    run(s, (RALLY.seconds + RALLY.cooldownSeconds) * TICKS_PER_SECOND);
    expect(results(s, { type: 'rally' })).toEqual([ok]);
  });
});

describe('challenges', () => {
  it('are chosen for the next run and take effect at prestige', () => {
    const s = createState(1, 105);
    Object.assign(s, { bestRun: 104, bestEver: 110, clearedThisRun: 10 });
    expect(results(s, { type: 'setChallenge', challenge: 'lean', on: true }, { type: 'setChallenge', challenge: 'swift', on: true })).toEqual([ok, ok]);
    expect(s.nextChallenges).toEqual(['swift', 'lean']);
    expect(s.challenges).toEqual([]);
    expect(prestigeCores(s).eq(coresFor(104))).toBe(true);
    step(s, [{ type: 'prestige' }]);
    expect(s.challenges).toEqual(['swift', 'lean']);
    expect(results(s, { type: 'setChallenge', challenge: 'swift', on: false })).toEqual([ok]);
    expect([s.challenges, s.nextChallenges]).toEqual([['swift', 'lean'], ['lean']]);
  });

  it('change enemies: Swift speed, Armored HP, Lean gold', () => {
    const s = emptyField(30);
    s.challenges = ['swift', 'armored', 'lean'];
    const e = place(s, 'grunt', 0);
    expect(e.log10MaxHp).toBeCloseTo(log10EnemyHp(30, 'grunt') + Math.log10(2), 12);
    expect(e.gold.toNumber()).toBeCloseTo(enemyGold(30, 'grunt', 0).toNumber() * CHALLENGES.lean.goldMult, 9);
    step(s);
    expect(e.dist).toBeCloseTo((2 * CHALLENGES.swift.speedMult) / TICKS_PER_SECOND, 12);
  });

  it('each one adds 50% to the Cores of that run', () => {
    const s = createState(1, 120);
    s.bestRun = 120;
    s.challenges = ['armored', 'lean'];
    expect(prestigeCores(s).toNumber()).toBe(coresFor(120).mul(2).floor().toNumber());
    s.gold = new Decimal(0);
  });
});

describe('saving the new state', () => {
  it('keeps walls, the road seed, challenges, Overdrive and Rally', () => {
    const s = emptyField();
    s.bestEver = 90;
    s.map = s.nextMap = 'maze';
    step(s, [{ type: 'toggleWall', x: 3.5, y: 3.5 }, { type: 'toggleWall', x: 5.5, y: 4.5 }, { type: 'placeHero', slot: 0 }]);
    addTower(s, 1, 'bolt', { level: 30 });
    step(s, [{ type: 'boost', slot: 1 }, { type: 'rally' }]);
    Object.assign(s, { wildSeed: 1234, challenges: ['armored'], nextChallenges: ['swift', 'lean'] });
    const back = decode(encode(s, defaultSettings(), 0));
    expect(back.ok && back.data.state).toEqual(s);
  });

  it('upgrades version 5 saves with nothing new switched on', () => {
    const s = emptyField();
    addTower(s, 1, 'bolt');
    const raw = JSON.parse(encode(s, defaultSettings(), 0));
    raw.v = 5;
    for (const k of ['wildSeed', 'walls', 'rallyTicks', 'rallyCooldown', 'challenges', 'nextChallenges']) delete raw.state[k];
    for (const t of raw.state.towers) {
      delete t.boostTicks;
      delete t.boostCooldown;
    }
    const back = decode(JSON.stringify(raw));
    expect(back.ok && back.data.state).toEqual(s);
  });

  it('refuses walls that block the way or sit on a slot', () => {
    const s = emptyField();
    const raw = JSON.parse(encode(s, defaultSettings(), 0));
    raw.state.walls = Array.from({ length: 9 }, (_, y) => y * GRID_W + 4);
    expect(decode(JSON.stringify(raw))).toEqual({ ok: false, reason: 'corrupt' });
    raw.state.walls = [cellOf(2.5, 2.5)];
    expect(decode(JSON.stringify(raw))).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('pause', () => {
  it('stops time while commands still work', () => {
    const s = createState(1);
    step(s, [{ type: 'setPause', paused: true }]);
    const tick = s.tick;
    const spawns = s.spawns.length;
    expect(results(s, { type: 'build', slot: 0, tower: 'bolt' })).toEqual([ok]);
    run(s, 300);
    expect([s.tick, s.spawns.length, s.enemies.length, s.towers.length]).toEqual([tick, spawns, 0, 1]);
    step(s, [{ type: 'setPause', paused: false }]);
    expect(s.tick).toBe(tick + 1);
  });

  it('is on for brand-new games and new runs', () => {
    const s = createState(1, 105);
    Object.assign(s, { bestRun: 104, bestEver: 110, clearedThisRun: 10 });
    step(s, [{ type: 'prestige' }]);
    expect(s.paused).toBe(true);
  });

  it('earns no offline gold', () => {
    const s = createState(1);
    s.history = [{ gold: new Decimal(240), ticks: 720 }];
    s.paused = true;
    const gold = s.gold.toNumber();
    const session = new Session(s, defaultSettings(), 1e12, 1e12 - 3_600_000);
    expect(session.loadedAway).toBeUndefined();
    expect(s.gold.toNumber()).toBe(gold);
  });
});

describe('giving up a challenge', () => {
  it('ends it for the rest of the run, with its extra Cores', () => {
    const s = createState(1, 120);
    s.bestRun = 120;
    s.challenges = ['swift', 'armored'];
    s.nextChallenges = ['swift'];
    expect(results(s, { type: 'dropChallenge', challenge: 'swift' })).toEqual([ok]);
    expect([s.challenges, s.nextChallenges]).toEqual([['armored'], ['swift']]);
    expect(prestigeCores(s).toNumber()).toBe(coresFor(120).mul(1.5).floor().toNumber());
    expect(results(s, { type: 'dropChallenge', challenge: 'lean' })).toEqual([{ ok: false, reason: 'That challenge is not on this run' }]);
  });
});
