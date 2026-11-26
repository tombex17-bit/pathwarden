import { describe, expect, it } from 'vitest';
import type { EnemyKind } from '../../src/config/balance';
import { currentSlow } from '../../src/sim/enemies';
import { createState, step } from '../../src/sim/sim';
import { buildSpawns, pickEnemy } from '../../src/sim/waves';
import { addTower, dealt, emptyField, hitIds, place, run, seconds, until } from './helpers';

// Slot 0 is at (3, 2.5). Along the top row, path distance equals x.

describe('towers', () => {
  it('Bolt hits one enemy twice a second', () => {
    const s = emptyField(40);
    place(s, 'grunt', 1);
    place(s, 'grunt', 1.2);
    addTower(s, 0, 'bolt');
    expect(hitIds(run(s, seconds(2)))).toHaveLength(4);
  });

  it('Cannon hits everything within 0.9 at full damage, every 2 s', () => {
    const s = emptyField(40);
    const target = place(s, 'grunt', 3);
    const inside = place(s, 'grunt', 2.15);
    const outside = place(s, 'grunt', 2.05);
    addTower(s, 0, 'cannon');
    step(s);
    expect(dealt(target)).toBeCloseTo(9, 6);
    expect(dealt(inside)).toBeCloseTo(9, 6);
    expect(dealt(outside)).toBe(0);
    expect(hitIds(run(s, 59))).toEqual([]);
    place(s, 'grunt', 3);
    expect(hitIds(run(s, 1))).toHaveLength(1);
  });

  it('Frost hits within 1.0, slows 25% for 2 s, and slows do not add up', () => {
    const s = emptyField(40);
    const e = place(s, 'grunt', 3);
    const other = place(s, 'grunt', 2.1);
    addTower(s, 0, 'frost');
    addTower(s, 1, 'frost');
    step(s);
    s.towers = [];
    expect(dealt(other)).toBeGreaterThan(0);
    const start = e.dist;
    run(s, 60);
    expect(e.dist - start).toBeCloseTo(60 * (2 / 30) * 0.75, 6);
    const later = e.dist;
    run(s, 30);
    expect(e.dist - later).toBeCloseTo(2, 6);
  });

  it('Beam hits 10 times a second, ramping 20% per second up to +100%', () => {
    const s = emptyField(200);
    const e = place(s, 'boss', 1);
    addTower(s, 0, 'beam');
    step(s);
    expect(dealt(e) / 0.8).toBeCloseTo(1, 1);
    s.towers[0]!.locks[0]!.sinceTick = s.tick - seconds(1);
    const perHit = (): number => {
      const before = e.hp;
      let guard = 0;
      while (e.hp === before && guard++ < 10) step(s);
      return (before - e.hp) * 10 ** (e.log10MaxHp);
    };
    const one = perHit();
    s.towers[0]!.locks[0]!.sinceTick = s.tick - seconds(60);
    const capped = perHit();
    expect(one / capped).toBeGreaterThan(0.58);
    expect(one / capped).toBeLessThan(0.63);
  });

  it('Beam starts over on a new target', () => {
    const s = emptyField(200);
    const a = place(s, 'grunt', 1.2);
    const b = place(s, 'grunt', 1);
    const t = addTower(s, 0, 'beam');
    run(s, 30);
    expect(t.locks).toEqual([{ enemyId: a.id, sinceTick: 1 }]);
    s.enemies = [b];
    run(s, 3);
    expect(t.locks).toHaveLength(1);
    expect(t.locks[0]!.enemyId).toBe(b.id);
    expect(t.locks[0]!.sinceTick).toBeGreaterThan(30);
  });

  it('Tesla chains to 2 more enemies within 1.5 cells at 70% per jump', () => {
    const s = emptyField(40);
    const [a, b, c, d] = [3, 2, 1, 0.2].map((x) => place(s, 'grunt', x)) as [never, never, never, never];
    addTower(s, 0, 'tesla');
    step(s);
    expect([a, b, c, d].map((e) => dealt(e))).toEqual([
      expect.closeTo(5, 6), expect.closeTo(3.5, 6), expect.closeTo(2.45, 6), 0,
    ]);
  });

  it('Tesla does not jump farther than 1.5 cells', () => {
    const s = emptyField(40);
    place(s, 'grunt', 3.5);
    place(s, 'grunt', 1.9);
    addTower(s, 0, 'tesla');
    expect(hitIds(step(s).events)).toHaveLength(1);
  });
});

describe('specializations', () => {
  it('Rapid fires 3.2 times a second on average', () => {
    const s = emptyField(40);
    for (let i = 0; i < 6; i++) place(s, 'brute', i * 0.2);
    addTower(s, 0, 'bolt', { spec: 'a', weak: true });
    const hits = hitIds(run(s, seconds(3))).length;
    expect(hits).toBeGreaterThanOrEqual(9);
    expect(hits).toBeLessThanOrEqual(10);
  });

  it('Sniper reaches 4.48 cells and picks the highest HP', () => {
    const s = emptyField(40);
    place(s, 'grunt', 4);
    const brute = place(s, 'brute', 3);
    addTower(s, 0, 'bolt', { spec: 'b' });
    expect(hitIds(step(s).events)).toEqual([brute.id]);
    const far = emptyField(40);
    const x = 3 + Math.sqrt(4.48 ** 2 - 1.5 ** 2);
    place(far, 'grunt', x - 0.1);
    addTower(far, 0, 'bolt', { spec: 'b' });
    expect(hitIds(step(far).events)).toHaveLength(1);
    const tooFar = emptyField(40);
    place(tooFar, 'grunt', x + 0.1);
    addTower(tooFar, 0, 'bolt', { spec: 'b' });
    expect(hitIds(step(tooFar).events)).toHaveLength(0);
  });

  it('Wide reaches 1.44 cells', () => {
    const s = emptyField(40);
    place(s, 'grunt', 3);
    place(s, 'grunt', 1.6);
    place(s, 'grunt', 1.5);
    addTower(s, 0, 'cannon', { spec: 'a' });
    expect(hitIds(step(s).events)).toHaveLength(2);
  });

  it('Heavy deals x1.6', () => {
    const s = emptyField(40);
    const e = place(s, 'grunt', 3);
    addTower(s, 0, 'cannon', { spec: 'b' });
    step(s);
    expect(dealt(e)).toBeCloseTo(14.4, 6);
  });

  it('Deep chill slows 45%, and the strongest slow wins', () => {
    const s = emptyField(40);
    const e = place(s, 'grunt', 4);
    addTower(s, 0, 'frost', { spec: 'a' });
    addTower(s, 1, 'frost');
    step(s);
    expect(e.slows).toHaveLength(2);
    expect(currentSlow(e, s.tick)).toBe(0.45);
  });

  it('Brittle adds 20% for 2 s without stacking', () => {
    const s = emptyField(40);
    const e = place(s, 'brute', 2);
    addTower(s, 0, 'frost', { spec: 'b', weak: true });
    addTower(s, 11, 'frost', { spec: 'b', weak: true });
    step(s);
    s.towers = [];
    addTower(s, 0, 'bolt');
    step(s);
    expect(dealt(e)).toBeCloseTo(4.8, 5);
    s.towers = [];
    run(s, 60);
    addTower(s, 0, 'bolt');
    step(s);
    expect(dealt(e)).toBeCloseTo(8.8, 5);
  });

  it('Focus ramps up to +200%', () => {
    const s = emptyField(200);
    const e = place(s, 'boss', 1);
    const t = addTower(s, 0, 'beam', { spec: 'a', level: 25 });
    step(s);
    t.locks[0]!.sinceTick = -seconds(60);
    const before = e.hp;
    run(s, 3);
    expect(((before - e.hp) * 10 ** e.log10MaxHp) / 10 ** t.log10Damage).toBeCloseTo(3, 3);
  });

  it('Split hits 2 targets, each with its own ramp', () => {
    const s = emptyField(200);
    const a = place(s, 'grunt', 4);
    const b = place(s, 'grunt', 3);
    place(s, 'grunt', 2);
    const t = addTower(s, 0, 'beam', { spec: 'b' });
    expect(hitIds(step(s).events)).toEqual([a.id, b.id]);
    expect(t.locks.map((l) => l.enemyId)).toEqual([a.id, b.id]);
  });

  it('Long chain jumps 5 times', () => {
    const s = emptyField(40);
    for (let i = 0; i < 8; i++) place(s, 'grunt', 4 - i * 0.5);
    addTower(s, 0, 'tesla', { spec: 'a' });
    expect(hitIds(step(s).events)).toHaveLength(6);
  });

  it('Surge deals x1.5', () => {
    const s = emptyField(40);
    const e = place(s, 'grunt', 3);
    addTower(s, 0, 'tesla', { spec: 'b' });
    step(s);
    expect(dealt(e)).toBeCloseTo(7.5, 6);
  });
});

describe('enemies', () => {
  it.each<[EnemyKind, number]>([
    ['grunt', 2], ['runner', 3.2], ['brute', 1.3], ['swarm', 2.2], ['shielded', 1.8], ['regenerator', 1.8], ['boss', 1.3],
  ])('%s moves %f cells per second', (kind, speed) => {
    const s = emptyField(40);
    const e = place(s, kind, 0);
    run(s, 30);
    expect(e.dist).toBeCloseTo(speed, 6);
  });

  it.each<[EnemyKind, number]>([['grunt', 1], ['runner', 4], ['brute', 8], ['swarm', 12], ['shielded', 18], ['regenerator', 25]])(
    '%s first appears in wave %i', (kind, first) => {
      const picks = (wave: number): Set<EnemyKind> => new Set(Array.from({ length: 1000 }, (_, i) => pickEnemy(wave, i / 1000)));
      expect(picks(first).has(kind)).toBe(true);
      if (first > 1) expect(picks(first - 1).has(kind)).toBe(false);
    },
  );

  it('are picked by weight', () => {
    const counts: Partial<Record<EnemyKind, number>> = {};
    for (let i = 0; i < 17000; i++) {
      const k = pickEnemy(100, i / 17000);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual({ grunt: 6000, runner: 3000, brute: 2000, swarm: 2000, shielded: 2000, regenerator: 2000 });
  });

  it('Swarm comes in threes, 0.2 s apart', () => {
    const spawns = buildSpawns(1, 60, 1);
    const swarm = spawns.filter((x) => x.kind === 'swarm').map((x) => x.tick);
    expect(swarm.length).toBeGreaterThan(0);
    expect(swarm.length % 3).toBe(0);
    expect(swarm.slice(0, 3).map((t) => t - swarm[0]!)).toEqual([0, 6, 12]);
  });

  it('Shielded absorbs 0.35 x HP before losing HP', () => {
    const s = emptyField(40);
    const e = place(s, 'shielded', 3);
    const t = addTower(s, 0, 'bolt');
    t.log10Damage = e.log10MaxHp + Math.log10(0.3);
    step(s);
    expect([e.shield, e.hp]).toEqual([expect.closeTo(0.05, 9), 1]);
    run(s, 15);
    expect([e.shield, e.hp]).toEqual([0, expect.closeTo(0.75, 9)]);
  });

  it('Beam damage bypasses a shield', () => {
    const s = emptyField(40);
    const e = place(s, 'shielded', 3);
    addTower(s, 0, 'beam').log10Damage = e.log10MaxHp + Math.log10(0.3);
    step(s);
    expect([e.shield, e.hp]).toEqual([0.35, expect.closeTo(0.7, 9)]);
  });

  it('Regenerator heals 2% per second, never above full', () => {
    const s = emptyField(40);
    const e = place(s, 'regenerator', 0);
    e.hp = 0.5;
    run(s, 60);
    expect(e.hp).toBeCloseTo(0.54, 9);
    e.hp = 0.9999;
    run(s, 30);
    expect(e.hp).toBe(1);
  });

  it('slows are capped at 60%', () => {
    const s = emptyField(40);
    const e = place(s, 'grunt', 0);
    e.slows.push({ amount: 0.9, untilTick: 1000 });
    expect(currentSlow(e, 1)).toBe(0.6);
  });
});

describe('boss', () => {
  it('appears alone, every 10th wave only, at 5 s', () => {
    for (const wave of [1, 9, 11, 25, 99]) expect(buildSpawns(1, wave, 1).some((x) => x.kind === 'boss')).toBe(false);
    for (const wave of [10, 20, 100]) {
      expect(buildSpawns(1, wave, 1).filter((x) => x.kind === 'boss')).toEqual([{ kind: 'boss', tick: 150 }]);
    }
  });

  it('is slowed half as much', () => {
    const s = emptyField(10);
    const e = place(s, 'boss', 3);
    addTower(s, 0, 'frost', { weak: true });
    step(s);
    expect(currentSlow(e, s.tick)).toBe(0.125);
  });

  it('loses the wave when it leaks, even if everything else dies', () => {
    const s = emptyField(20);
    place(s, 'boss', 43.99);
    const { events } = step(s);
    expect(events).toContainEqual({ type: 'waveLost', wave: 20, nextWave: 15 });
    expect(s.wave).toBe(15);
    expect(s.bestRun).toBe(0);
  });

  it('gates every 10th wave', () => {
    const s = createState(3, 10);
    for (let i = 0; i < 12; i++) addTower(s, i, 'bolt', { level: 5 });
    const boss = place(s, 'boss', 0);
    boss.log10MaxHp = 50;
    until(s, 'waveLost');
    expect(s.wave).toBe(5);
  });
});
