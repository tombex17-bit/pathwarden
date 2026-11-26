import Decimal from 'break_infinity.js';
import { describe, expect, it } from 'vitest';
import { AWAY_GAP_MS, Session, deservesSummary } from '../../src/platform/session';
import { defaultSettings, type Speed } from '../../src/platform/settings';
import { idleRate } from '../../src/sim/idle';
import { createState, step } from '../../src/sim/sim';
import type { State } from '../../src/sim/types';
import { formatDuration } from '../../src/ui/format';
import { addTower, emptyField, place, run, until } from './helpers';

const HOUR = 3600_000;
const T0 = 1_800_000_000_000;
const STEP_MS = 1000 / 30;

/** A state that earns exactly 10 base gold per game second. */
function earning(): State {
  const s = createState(1);
  s.gold = new Decimal(0);
  s.history = [{ gold: new Decimal(240), ticks: 720 }];
  return s;
}

const session = (s: State, savedAt = T0, speed: Speed = 1): Session => new Session(s, { ...defaultSettings(), speed }, T0, savedAt);

describe('offline gold after loading', () => {
  it.each([
    ['0 s', 0, 0], ['59 s', 59_000, 295], ['60 s', 60_000, 300], ['8 h', 8 * HOUR, 144_000], ['9 h', 9 * HOUR, 144_000], ['negative', -HOUR, 0],
  ])('%s', (_, ms, gold) => {
    const s = earning();
    const run = session(s, T0 - ms);
    expect(s.gold.toNumber()).toBeCloseTo(gold, 6);
    expect(deservesSummary(run.loadedAway)).toBe(ms >= 60_000);
    expect(s.wave).toBe(1);
    expect(s.waveTick).toBe(0);
  });

  it('pays nothing before the first finished wave', () => {
    const s = createState(1);
    session(s, T0 - 8 * HOUR);
    expect(s.gold.toNumber()).toBe(60);
  });

  it.each<Speed>([1, 2, 3])('ignores speed %ix', (speed) => {
    const s = earning();
    session(s, T0 - HOUR, speed);
    expect(s.gold.toNumber()).toBeCloseTo(18_000, 6);
  });
});

describe('frame gaps without a hidden event', () => {
  it('4 s is played, up to 12 steps', () => {
    const s = earning();
    const { away } = session(s).frame(4000, T0 + 4000);
    expect(away).toBeUndefined();
    expect(s.tick).toBe(12);
    expect(s.gold.toNumber()).toBe(0);
  });

  it('exactly 5 s is still played; more is away', () => {
    expect(session(earning()).frame(AWAY_GAP_MS, T0 + AWAY_GAP_MS).away).toBeUndefined();
    expect(session(earning()).frame(AWAY_GAP_MS, T0 + AWAY_GAP_MS + 1).away).toBeDefined();
  });

  it('8 h pays offline gold and runs no steps', () => {
    const s = earning();
    const run = session(s);
    const { away } = run.frame(8 * HOUR, T0 + 8 * HOUR);
    expect(away!.seconds).toBe(8 * 3600);
    expect(s.gold.toNumber()).toBeCloseTo(144_000, 6);
    expect(s.tick).toBe(0);
    // The next ordinary frame plays on, without paying twice.
    run.frame(34, T0 + 8 * HOUR + 34);
    expect(s.tick).toBe(1);
    expect(s.gold.toNumber()).toBeCloseTo(144_000, 6);
  });

  it('a clock moved back pays nothing and play continues', () => {
    const s = earning();
    const run = session(s);
    expect(run.frame(34, T0 - HOUR).away).toBeUndefined();
    expect(s.tick).toBe(1);
    expect(run.frame(34, T0 - HOUR + 34).away).toBeUndefined();
    expect(s.gold.toNumber()).toBe(0);
  });
});

describe('hidden tab', () => {
  it('freezes the wave and cooldowns, then pays the same as offline', () => {
    const s = emptyField();
    s.gold = new Decimal(0);
    s.history = [{ gold: new Decimal(240), ticks: 720 }];
    place(s, 'brute', 3);
    const run = session(s);
    run.send({ type: 'cast', ability: 'meteor', x: 3, y: 1 });
    run.frame(40, T0 + 40);
    const before = { tick: s.tick, waveTick: s.waveTick, cooldown: s.cooldowns.meteor, dist: s.enemies[0]!.dist };
    run.hide(T0 + 1000);
    run.frame(60_000, T0 + 30_000);
    const away = run.show(T0 + 1000 + HOUR);
    expect({ tick: s.tick, waveTick: s.waveTick, cooldown: s.cooldowns.meteor, dist: s.enemies[0]!.dist }).toEqual(before);
    expect(away!.seconds).toBe(3600);
    expect(s.gold.toNumber()).toBeCloseTo(18_000, 6);
    run.frame(34, T0 + 1034 + HOUR);
    expect(s.tick).toBe(before.tick + 1);
  });

  it('pays once, even if events repeat', () => {
    const s = earning();
    const run = session(s);
    run.hide(T0);
    run.hide(T0 + 5000);
    run.show(T0 + 10_000);
    expect(run.show(T0 + 20_000)).toBeUndefined();
    expect(s.gold.toNumber()).toBeCloseTo(50, 6);
  });

  it('a save can apply waiting commands at once', () => {
    const s = createState(1);
    const run = session(s);
    let answered = false;
    run.send({ type: 'setOption', option: 'autoAdvance', value: false }, () => { answered = true; });
    run.flush();
    expect([s.autoAdvance, answered, s.tick]).toEqual([false, true, 1]);
    run.flush();
    expect(s.tick).toBe(1);
  });

  it('keeps commands given before hiding', () => {
    const s = createState(1);
    const run = session(s);
    run.send({ type: 'build', slot: 0, tower: 'bolt' });
    run.hide(T0);
    run.show(T0 + 100);
    run.frame(40, T0 + 140);
    expect(s.towers).toHaveLength(1);
  });
});

describe('speed', () => {
  it.each<Speed>([2, 3])('%ix reaches the same state as 1x after the same steps', (speed) => {
    const play = (v: Speed): State => {
      const s = createState(7);
      const run = new Session(s, { ...defaultSettings(), speed: v }, T0);
      let wall = T0;
      run.send({ type: 'build', slot: 0, tower: 'bolt' });
      while (s.tick < 3000) {
        wall += STEP_MS;
        run.frame(STEP_MS, wall);
      }
      return s;
    };
    const [a, b] = [play(1), play(speed)];
    expect(b.tick).toBe(a.tick);
    expect(b).toEqual(a);
  });

  it('3x runs 90 steps per real second', () => {
    const s = createState(1);
    const run = new Session(s, { ...defaultSettings(), speed: 3 }, T0);
    for (let i = 1; i <= 60; i++) run.frame(1000 / 60, T0 + (i * 1000) / 60);
    expect(Math.abs(s.tick - 90)).toBeLessThanOrEqual(1);
  });
});

describe('idleRate', () => {
  it('is 0 before the first wave finishes', () => {
    const s = createState(1);
    addTower(s, 0, 'bolt', { level: 20 });
    run(s, 300);
    expect(s.kills).toBeGreaterThan(0);
    expect(idleRate(s).toNumber()).toBe(0);
  });

  it('is base gold over game seconds of finished waves', () => {
    const s = createState(1);
    for (let i = 0; i < 4; i++) addTower(s, i, 'bolt', { level: 20 });
    until(s, 'waveClear');
    expect(s.history).toHaveLength(1);
    expect(idleRate(s).toNumber()).toBeCloseTo((12 * 2) / 24, 6);
  });

  it('uses only the last 20 waves', () => {
    const s = emptyField();
    s.history = Array.from({ length: 20 }, (_, i) => ({ gold: new Decimal(i === 0 ? 1e6 : 24), ticks: 720 }));
    s.waveTick = 719;
    s.waveGold = new Decimal(24);
    step(s);
    expect(s.history).toHaveLength(20);
    expect(idleRate(s).toNumber()).toBeCloseTo(1, 9);
  });

  it('counts lost waves, including the pause', () => {
    const s = createState(1);
    const ticks = until(s, 'waveLost');
    expect(s.history).toEqual([{ gold: new Decimal(0), ticks: ticks + 60 }]);
    expect(until(s, 'waveStart')).toBe(60);
  });

  it('excludes bounties', () => {
    const s = emptyField();
    s.gold = new Decimal(0);
    const e = place(s, 'grunt', 3);
    e.marked = true;
    addTower(s, 0, 'bolt', { level: 50 });
    step(s);
    expect(s.gold.toNumber()).toBe(4.5);
    expect(s.waveGold.toNumber()).toBe(2);
  });

  it('starts each wave at zero', () => {
    const s = emptyField();
    s.waveGold = new Decimal(99);
    s.waveTick = 719;
    step(s);
    expect(s.waveGold.toNumber()).toBe(0);
  });
});

it.each([[0, '0 s'], [59.9, '59 s'], [60, '1 min 0 s'], [125, '2 min 5 s'], [3600, '1 h 0 min'], [11_400, '3 h 10 min']])('%f s reads "%s"', (s, text) => {
  expect(formatDuration(s)).toBe(text);
});

it('new games run at 1x', () => {
  expect(defaultSettings()).toEqual({ speed: 1, volume: 0.6, muted: false });
});
