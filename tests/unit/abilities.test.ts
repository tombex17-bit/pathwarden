import { describe, expect, it } from 'vitest';
import { ABILITY_KINDS, type AbilityKind } from '../../src/config/balance';
import { log10FormationDps } from '../../src/sim/abilities';
import { currentSlow } from '../../src/sim/enemies';
import { createState, step } from '../../src/sim/sim';
import type { Command, State } from '../../src/sim/types';
import { addTower, dealt, emptyField, place, run, seconds, until } from './helpers';

const castAt = (ability: AbilityKind, x: number, y: number): Command => ({ type: 'cast', ability, x, y });

/** Everything unlocked, nothing spawning. Along the top row, path distance equals x and y is 1. */
function field(wave = 40): State {
  const s = emptyField(wave);
  s.bestEver = 99;
  return s;
}

/** Towers far from the top-left area, so that only abilities deal damage there. */
function addDps(s: State): number {
  addTower(s, 10, 'bolt', { level: 10 });
  return 4 * 10 * 2;
}

describe('formation DPS', () => {
  it('sums damage x rate, counting Split twice and ignoring ramp and splash', () => {
    const s = field();
    addTower(s, 0, 'bolt');
    addTower(s, 1, 'cannon');
    addTower(s, 2, 'beam', { spec: 'b' });
    addTower(s, 3, 'bolt', { spec: 'a' });
    expect(10 ** log10FormationDps(s)).toBeCloseTo(4 * 2 + 9 * 0.5 + 0.8 * 10 * 2 + 4 * 3.2, 6);
  });

  it('is zero without towers and finite at huge levels', () => {
    const s = field();
    expect(10 ** log10FormationDps(s)).toBe(0);
    addTower(s, 0, 'bolt', { level: 100000 });
    expect(Number.isFinite(log10FormationDps(s))).toBe(true);
  });
});

describe('unlocks and cooldowns', () => {
  it.each<[AbilityKind, number]>([['meteor', 0], ['stasis', 10], ['bounty', 20], ['smite', 35]])('%s unlocks after clearing %i', (ability, wave) => {
    const s = emptyField(40);
    place(s, 'brute', 3);
    if (wave > 0) {
      s.bestEver = wave - 1;
      expect(step(s, [castAt(ability, 3, 1)]).results).toEqual([{ ok: false, reason: `Clear wave ${wave} first` }]);
      expect(s.cooldowns[ability]).toBe(0);
    }
    s.bestEver = wave;
    expect(step(s, [castAt(ability, 3, 1)]).results).toEqual([{ ok: true }]);
  });

  it.each<[AbilityKind, number]>([['meteor', 40], ['stasis', 60], ['bounty', 20], ['smite', 45]])('%s is ready again after exactly %i s', (ability, cooldown) => {
    const s = field();
    const castNow = (): boolean => {
      s.enemies = [];
      s.waveTick = 0;
      place(s, 'boss', 3);
      return step(s, [castAt(ability, 3, 1)]).results[0]!.ok;
    };
    expect(castNow()).toBe(true);
    for (let i = 1; i < seconds(cooldown); i++) {
      s.enemies = [];
      s.waveTick = 0;
      step(s);
    }
    expect(s.cooldowns[ability]).toBe(0);
    s.cooldowns[ability] = 1;
    expect(castNow()).toBe(false);
    expect(castNow()).toBe(true);
  });

  it('cool down separately, and keep cooling down after a loss', () => {
    const s = field();
    place(s, 'boss', 43.9);
    step(s, [castAt('meteor', 3, 1)]);
    expect(s.cooldowns).toEqual({ meteor: 1199, stasis: 0, bounty: 0, smite: 0 });
    until(s, 'waveLost');
    const before = s.cooldowns.meteor;
    run(s, 30);
    expect(s.restartTicks).toBeGreaterThan(0);
    expect(s.cooldowns.meteor).toBe(before - 30);
  });
});

describe('invalid casts spend nothing', () => {
  it.each(ABILITY_KINDS.filter((a) => a !== 'bounty'))('%s with no enemies alive', (ability) => {
    const s = field();
    expect(step(s, [castAt(ability, 3, 1)]).results).toEqual([{ ok: false, reason: 'No enemies on the map' }]);
    expect(s.cooldowns[ability]).toBe(0);
    expect(s.zones).toEqual([]);
  });

  it.each([[-0.1, 1], [16.1, 1], [3, -0.1], [3, 9.1], [NaN, 1]])('outside the map at (%f, %f)', (x, y) => {
    const s = field();
    place(s, 'brute', 3);
    for (const a of ABILITY_KINDS) {
      expect(step(s, [castAt(a, x, y)]).results).toEqual([{ ok: false, reason: 'Pick a point on the map' }]);
      expect(s.cooldowns[a]).toBe(0);
    }
  });

  it('unknown abilities', () => {
    const s = field();
    place(s, 'brute', 3);
    expect(step(s, [castAt('nuke' as AbilityKind, 3, 1)]).results).toEqual([{ ok: false, reason: 'No such ability' }]);
  });

  it('a second cast in the same step', () => {
    const s = field();
    place(s, 'boss', 3);
    expect(step(s, [castAt('meteor', 3, 1), castAt('meteor', 3, 1)]).results).toEqual([{ ok: true }, { ok: false, reason: 'Not ready yet' }]);
  });
});

describe('Meteor', () => {
  it('deals 1 s of formation DPS to each enemy within 1.8 cells', () => {
    const s = field(60);
    const dps = addDps(s);
    const [a, b, c] = [place(s, 'grunt', 3), place(s, 'grunt', 1.25), place(s, 'grunt', 1.15)];
    step(s, [castAt('meteor', 3, 1)]);
    expect(dealt(a)).toBeCloseTo(dps, 5);
    expect(dealt(b)).toBeCloseTo(dps, 5);
    expect(dealt(c)).toBe(0);
  });

  it('hits shields first and gets the Brittle bonus', () => {
    const s = field(40);
    const dps = addDps(s);
    const shielded = place(s, 'shielded', 3);
    const brittle = place(s, 'brute', 3.5);
    brittle.brittleUntil = 100;
    step(s, [castAt('meteor', 3, 1)]);
    expect(shielded.hp).toBe(1);
    expect(dealt(shielded, 0.35)).toBeCloseTo(dps, 5);
    expect(dealt(brittle)).toBeCloseTo(dps * 1.2, 5);
  });

  it('kills and pays', () => {
    const s = field(1);
    addDps(s);
    const e = place(s, 'grunt', 3);
    const gold = s.gold;
    s.gold = s.gold.sub(gold);
    const { events } = step(s, [castAt('meteor', 3, 1)]);
    expect(events.filter((x) => x.type === 'death')).toHaveLength(1);
    expect(s.enemies).not.toContain(e);
    expect(s.gold.toNumber()).toBe(2);
  });

  it('may be cast on empty ground while an enemy lives', () => {
    const s = field();
    place(s, 'brute', 3);
    expect(step(s, [castAt('meteor', 15, 8)]).results).toEqual([{ ok: true }]);
    expect(s.cooldowns.meteor).toBeGreaterThan(0);
  });
});

describe('Stasis', () => {
  it('slows 70% inside 2.0 cells for exactly 5 s, beyond the normal cap', () => {
    const s = field();
    const e = place(s, 'grunt', 2);
    step(s, [castAt('stasis', 3, 1)]);
    expect(currentSlow(e, s.tick)).toBe(0.7);
    const start = e.dist;
    run(s, 149);
    expect(e.dist - start).toBeCloseTo(149 * (2 / 30) * 0.3, 6);
    const end = e.dist;
    run(s, 30);
    expect(e.dist - end).toBeCloseTo(2, 6);
    expect(s.zones).toEqual([]);
  });

  it('does not add to other slows, affects bosses half as much, and stops at its edge', () => {
    const s = field();
    const chilled = place(s, 'grunt', 3);
    chilled.slows.push({ amount: 0.45, untilTick: 1000 });
    const boss = place(s, 'boss', 3);
    const outside = place(s, 'grunt', 0.9);
    step(s, [castAt('stasis', 3, 1)]);
    expect(currentSlow(chilled, s.tick)).toBe(0.7);
    expect(currentSlow(boss, s.tick)).toBe(0.35);
    expect(currentSlow(outside, s.tick)).toBe(0);
  });
});

describe('Bounty Mark', () => {
  it('marks enemies that touch it during 8 s; they pay 2.25x even after leaving', () => {
    const s = field(1);
    s.gold = s.gold.sub(s.gold);
    const e = place(s, 'grunt', 3);
    const outside = place(s, 'grunt', 1);
    outside.dist = 0;
    step(s, [castAt('bounty', 3, 1)]);
    expect([e.marked, outside.marked]).toEqual([true, false]);
    run(s, 45);
    expect(outside.marked).toBe(true);
    expect(e.x).toBeGreaterThan(4.2);
    s.enemies = [e];
    e.dist = e.prevDist = 3;
    addTower(s, 0, 'bolt', { level: 50 });
    step(s);
    expect(s.gold.toNumber()).toBeCloseTo(2 * 2.25, 9);
  });

  it('does not stack and ends after 8 s', () => {
    const s = field(1);
    s.gold = s.gold.sub(s.gold);
    const e = place(s, 'brute', 3);
    step(s, [castAt('bounty', 3, 1)]);
    s.cooldowns.bounty = 0;
    step(s, [castAt('bounty', 3, 1)]);
    addTower(s, 0, 'bolt', { level: 50 });
    run(s, 2);
    expect(s.enemies).not.toContain(e);
    expect(s.gold.toNumber()).toBeCloseTo(4 * 2.25, 9);
    s.towers = [];
    run(s, seconds(8));
    s.enemies = [];
    const late = place(s, 'grunt', 3);
    step(s);
    expect(late.marked).toBe(false);
  });

  it('unmarked enemies pay the normal amount', () => {
    const s = field(1);
    s.gold = s.gold.sub(s.gold);
    place(s, 'grunt', 3);
    addTower(s, 0, 'bolt', { level: 50 });
    step(s);
    expect(s.gold.toNumber()).toBe(2);
  });
});

describe('Bounty Mark on an empty field', () => {
  it('can be laid in advance and marks what spawns later', () => {
    const s = field();
    expect(step(s, [castAt('bounty', 1.2, 1)]).results).toEqual([{ ok: true }]);
    expect(s.cooldowns.bounty).toBeGreaterThan(0);
    run(s, 30);
    const e = place(s, 'grunt', 0);
    step(s);
    expect(e.marked).toBe(true);
  });
});

describe('Smite', () => {
  it('kills the nearest enemy below 30% HP, ignoring its shield', () => {
    const s = field();
    const far = place(s, 'shielded', 3.9);
    const near = place(s, 'shielded', 3.1);
    far.hp = near.hp = 0.29;
    step(s, [castAt('smite', 3, 1)]);
    expect(s.enemies).toEqual([far]);
    expect(s.kills).toBe(1);
  });

  it('otherwise deals 3 s of formation DPS, shield first', () => {
    const s = field();
    const dps = addDps(s);
    const e = place(s, 'shielded', 3);
    e.hp = 0.3;
    const before = e.shield;
    step(s, [castAt('smite', 3, 1)]);
    const lost = (0.3 - e.hp + before - e.shield) * 10 ** e.log10MaxHp;
    expect(lost).toBeCloseTo(Math.min(dps * 3, 0.65 * 10 ** e.log10MaxHp), 4);
    expect(e.shield).toBeLessThan(before);
  });

  it('never kills a boss at once', () => {
    const s = field(200);
    addDps(s);
    const boss = place(s, 'boss', 3);
    boss.hp = 0.1;
    step(s, [castAt('smite', 3, 1)]);
    expect(s.enemies).toContain(boss);
    expect(boss.hp).toBeLessThan(0.1);
  });

  it('needs an enemy within 1.0 cell', () => {
    const s = field();
    place(s, 'brute', 4.1);
    expect(step(s, [castAt('smite', 3, 1)]).results).toEqual([{ ok: false, reason: 'No enemy there' }]);
    expect(s.cooldowns.smite).toBe(0);
  });
});

describe('abilities in general', () => {
  it('lost waves clear zones', () => {
    const s = field();
    place(s, 'boss', 43.9);
    step(s, [castAt('bounty', 3, 1)]);
    until(s, 'waveLost');
    expect(s.zones).toEqual([]);
  });

  it('emit a cast event and stay deterministic', () => {
    const play = (): State => {
      const s = createState(9, 30);
      s.bestEver = 99;
      for (let i = 0; i < 5000; i++) step(s, ABILITY_KINDS.map((a) => castAt(a, 3, 1)));
      return s;
    };
    expect(play()).toEqual(play());
    const s = field();
    place(s, 'brute', 3);
    expect(step(s, [castAt('meteor', 5, 2)]).events).toContainEqual({ type: 'cast', ability: 'meteor', x: 5, y: 2 });
  });
});
