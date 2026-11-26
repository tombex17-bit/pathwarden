import Decimal from 'break_infinity.js';
import { describe, expect, it } from 'vitest';
import type { BuyAmount, EnemyKind, SpecChoice, TowerKind } from '../../src/config/balance';
import { affordableLevels, buildCost, enemyGold, sellValue, upgradeCost } from '../../src/sim/economy';
import { createEnemy } from '../../src/sim/enemies';
import { createState, refreshDamage, step } from '../../src/sim/sim';
import { log10Damage } from '../../src/sim/stats';
import type { Command, State } from '../../src/sim/types';
import { log10EnemyHp } from '../../src/sim/waves';
import { formatNumber } from '../../src/ui/format';
import { addTower, build, dealt, emptyField, place, run } from './helpers';

const upgrade = (slot: number, amount: BuyAmount): Command => ({ type: 'upgrade', slot, amount });
const sell = (slot: number): Command => ({ type: 'sell', slot });
const specialize = (slot: number, choice: SpecChoice): Command => ({ type: 'specialize', slot, choice });

const near = (value: Decimal | number, expected: number): void => {
  const v = typeof value === 'number' ? value : value.toNumber();
  expect(Math.abs(v / expected - 1)).toBeLessThan(1e-9);
};

function withGold(gold: number | string): State {
  const s = emptyField();
  s.gold = new Decimal(gold);
  return s;
}

describe('formulas', () => {
  it.each([[0, 50], [1, 80], [2, 128], [5, 524.288], [11, 50 * 1.6 ** 11]])('build cost with %i towers is %f', (k, cost) => {
    near(buildCost(k), cost);
  });

  it.each([[1, 21.8], [10, 20 * 1.09 ** 10], [100, 20 * 1.09 ** 100]])('upgrade from level %i costs %f', (level, cost) => {
    near(upgradeCost(level), cost);
  });

  it.each([[1, 10], [7, 25], [40, 3]])('from level %i, %i levels cost the sum of single prices', (level, count) => {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += 20 * 1.09 ** (level + i);
    near(upgradeCost(level, count), sum);
  });

  it.each<[TowerKind, SpecChoice | null, number, number, number]>([
    ['bolt', null, 1, 0, 4], ['cannon', null, 1, 0, 9], ['frost', null, 1, 0, 3], ['beam', null, 1, 0, 0.8], ['tesla', null, 1, 0, 5],
    ['bolt', null, 24, 0, 4 * 24], ['bolt', null, 25, 0, 4 * 25 * 2], ['bolt', null, 50, 0, 4 * 50 * 4], ['bolt', null, 130, 3, 4 * 130 * 32 * 1.4 ** 3],
    ['bolt', 'a', 25, 0, 200], ['bolt', 'b', 25, 0, 250], ['cannon', 'a', 25, 0, 450], ['cannon', 'b', 25, 0, 720],
    ['tesla', 'b', 25, 0, 375], ['beam', 'a', 25, 0, 40], ['frost', 'b', 25, 0, 150],
  ])('%s spec %s level %i power %i deals %f', (kind, spec, level, power, expected) => {
    near(10 ** log10Damage(kind, spec, level, power), expected);
  });

  it.each<[EnemyKind, number, number]>([
    ['grunt', 1, 1], ['runner', 0.6, 0.6], ['brute', 2, 2], ['swarm', 0.3, 0.3], ['shielded', 1, 1.3], ['regenerator', 0.8, 1], ['boss', 10, 0.5],
  ])('%s has HP x%f and gold x%f', (kind, hp, gold) => {
    for (const wave of [1, 10, 73]) {
      const n = 12 + Math.min(12, Math.floor(wave / 10));
      near(10 ** log10EnemyHp(wave, kind), 14 * 1.09 ** (wave - 1) * hp);
      near(enemyGold(wave, kind, 0), 2 * 1.065 ** (wave - 1) * gold * (kind === 'boss' ? n : 1));
      near(enemyGold(wave, kind, 4), 2 * 1.065 ** (wave - 1) * gold * (kind === 'boss' ? n : 1) * 1.3 ** 4);
    }
  });
});

describe('buying', () => {
  it('starts with 60 gold and charges 50, 80, 128', () => {
    const s = createState(1);
    expect(s.gold.toNumber()).toBe(60);
    expect(step(s, [build(0), build(1)]).results).toEqual([{ ok: true }, { ok: false, reason: 'Not enough gold' }]);
    expect(s.gold.toNumber()).toBe(10);
    expect(s.towers).toHaveLength(1);
    s.gold = new Decimal(208);
    expect(step(s, [build(1), build(2, 'tesla')]).results).toEqual([{ ok: true }, { ok: true }]);
    expect(s.gold.toNumber()).toBeCloseTo(0, 6);
    expect(s.towers.map((t) => t.buildPaid.toNumber())).toEqual([50, 80, expect.closeTo(128, 6)]);
  });

  it('rejects bad build commands and changes nothing', () => {
    const s = withGold(1e6);
    const bad = { type: 'build', slot: 1, tower: 'laser' } as unknown as Command;
    expect(step(s, [build(0), build(0), build(12), build(-1), bad]).results).toEqual([
      { ok: true },
      { ok: false, reason: 'Slot is taken' },
      { ok: false, reason: 'No such slot' },
      { ok: false, reason: 'No such slot' },
      { ok: false, reason: 'No such tower' },
    ]);
    near(s.gold, 1e6 - 50);
  });

  it.each<[BuyAmount, number]>([[1, 2], [10, 11], [25, 26]])('amount %s raises level 1 to %i', (amount, level) => {
    const s = withGold(1e6);
    const t = addTower(s, 0, 'bolt');
    expect(step(s, [upgrade(0, amount)]).results).toEqual([{ ok: true }]);
    expect(t.level).toBe(level);
    near(s.gold, 1e6 - upgradeCost(1, level - 1).toNumber());
    near(t.upgradesPaid, upgradeCost(1, level - 1).toNumber());
  });

  it('is all or nothing for fixed amounts', () => {
    const s = withGold(100);
    const t = addTower(s, 0, 'bolt');
    expect(step(s, [upgrade(0, 10)]).results).toEqual([{ ok: false, reason: 'Not enough gold' }]);
    expect(t.level).toBe(1);
    expect(s.gold.toNumber()).toBe(100);
  });

  it.each([0, 21, 21.8, 22, 45.5, 1000, 1e6, '1e50', '1e400'])('Max with %s gold buys everything affordable and no more', (gold) => {
    const s = withGold(gold);
    const t = addTower(s, 0, 'bolt');
    const n = affordableLevels(s.gold, 1);
    expect(step(s, [upgrade(0, 'max')]).results[0]!.ok).toBe(n > 0);
    expect(t.level).toBe(1 + n);
    expect(s.gold.gte(0)).toBe(true);
    expect(s.gold.lt(upgradeCost(t.level))).toBe(true);
    if (n > 0) expect(upgradeCost(1, n).mul(1 - 1e-9).lte(gold)).toBe(true);
  });

  it('rejects upgrading, selling or specializing an empty slot', () => {
    const s = withGold(1e6);
    const empty = { ok: false, reason: 'Slot is empty' };
    expect(step(s, [upgrade(0, 1), sell(0), specialize(0, 'a')]).results).toEqual([empty, empty, empty]);
  });

  it('works between waves after a loss', () => {
    const s = createState(1);
    s.restartTicks = 10;
    expect(step(s, [build(3)]).results).toEqual([{ ok: true }]);
  });
});

describe('selling', () => {
  it('refunds the full build price and 70% of upgrades', () => {
    const s = withGold(1e6);
    step(s, [build(0), build(1), upgrade(1, 10)]);
    const tower = s.towers[1]!;
    const expected = 80 + 0.7 * upgradeCost(1, 10).toNumber();
    near(sellValue(tower), expected);
    const before = s.gold.toNumber();
    step(s, [sell(1)]);
    expect(s.gold.toNumber() - before).toBeCloseTo(expected, 6);
    expect(s.towers.map((t) => t.slot)).toEqual([0]);
    expect(step(s, [build(1, 'frost')]).results).toEqual([{ ok: true }]);
  });

  it('never leaves a player with no tower and too little gold', () => {
    const s = createState(1);
    for (let i = 0; i < 5; i++) {
      expect(step(s, [build(0), sell(0)]).results).toEqual([{ ok: true }, { ok: true }]);
      expect(s.gold.toNumber()).toBe(60);
    }
    step(s, [build(0)]);
    s.gold = new Decimal(22);
    step(s, [upgrade(0, 1), sell(0)]);
    expect(step(s, [build(0)]).results).toEqual([{ ok: true }]);
  });

  it('cannot make a profit by selling and rebuilding', () => {
    const s = withGold(1000);
    step(s, [build(0), build(1), build(2)]);
    step(s, [sell(0), build(0), sell(1), build(1), sell(0), sell(1), sell(2)]);
    expect(s.gold.toNumber()).toBeLessThanOrEqual(1000 + 1e-6);
  });
});

describe('specializing', () => {
  it('needs level 25, is free, and can be chosen once', () => {
    const s = withGold(1e6);
    const t = addTower(s, 0, 'bolt', { level: 24 });
    expect(step(s, [specialize(0, 'a')]).results).toEqual([{ ok: false, reason: 'Needs level 25' }]);
    step(s, [upgrade(0, 1)]);
    const gold = s.gold;
    expect(step(s, [specialize(0, 'a'), specialize(0, 'b')]).results).toEqual([
      { ok: true }, { ok: false, reason: 'Already specialized' },
    ]);
    expect(t.spec).toBe('a');
    expect(s.gold.eq(gold)).toBe(true);
  });

  it('is gone after selling', () => {
    const s = withGold(1e6);
    addTower(s, 0, 'bolt', { level: 25, spec: 'a' });
    step(s, [sell(0), build(0)]);
    expect(s.towers[0]).toMatchObject({ spec: null, level: 1 });
  });
});

describe('damage is refreshed', () => {
  const current = (s: State): number => s.towers[0]!.log10Damage;

  it('after building, leveling, specializing, and selling then rebuilding', () => {
    const s = withGold(1e9);
    step(s, [build(0, 'cannon')]);
    near(10 ** current(s), 9);
    step(s, [upgrade(0, 25)]);
    near(10 ** current(s), 9 * 26 * 2);
    step(s, [specialize(0, 'b')]);
    near(10 ** current(s), 9 * 26 * 2 * 1.6);
    step(s, [sell(0), build(0, 'bolt')]);
    near(10 ** current(s), 4);
  });

  it('after a permanent upgrade', () => {
    const s = withGold(1e9);
    step(s, [build(0)]);
    s.power = 2;
    refreshDamage(s, s.towers[0]!);
    near(10 ** current(s), 4 * 1.4 ** 2);
  });

  it('for new enemies when the wave changes', () => {
    const s = emptyField(5);
    near(10 ** createEnemy(s, 'grunt').log10MaxHp, 14 * 1.09 ** 4);
    s.wave = 6;
    near(10 ** createEnemy(s, 'grunt').log10MaxHp, 14 * 1.09 ** 5);
  });
});

describe('wave 10,000', () => {
  it('has HP beyond normal numbers, and hits, kills and gold still work', () => {
    const s = emptyField(10000);
    s.gold = new Decimal(0);
    const e = place(s, 'grunt', 3);
    expect(e.log10MaxHp).toBeGreaterThan(308.3);
    const t = addTower(s, 0, 'bolt');
    t.log10Damage = e.log10MaxHp + Math.log10(0.4);
    run(s, 1);
    expect(e.hp).toBeCloseTo(0.6, 9);
    run(s, 30);
    expect(s.kills).toBe(1);
    expect(s.gold.log10()).toBeCloseTo(Math.log10(2) + 9999 * Math.log10(1.065), 6);
    expect(s.gold.eq(enemyGold(10000, 'grunt', 0))).toBe(true);
  });

  it('survives overwhelming damage, including through a shield', () => {
    const s = emptyField(10000);
    const e = place(s, 'shielded', 3);
    addTower(s, 0, 'bolt').log10Damage = 5000;
    run(s, 1);
    expect(e.hp).toBe(0);
    expect(e.shield).toBe(0);
    expect(s.kills).toBe(1);
  });

  it('can spend gold beyond 1e308', () => {
    const s = withGold('1e500');
    addTower(s, 0, 'bolt');
    step(s, [upgrade(0, 'max')]);
    expect(s.towers[0]!.level).toBeGreaterThan(13000);
    expect(Number.isFinite(s.towers[0]!.log10Damage)).toBe(true);
    const e = place(s, 'grunt', 3);
    run(s, 1);
    expect(dealt(e)).toBeGreaterThan(0);
  });
});

describe('number format', () => {
  it.each([
    [0, '0'], [9.99, '9'], [999, '999'], [1000, '1.00K'], [1234, '1.23K'], [999999, '999.99K'], [1e6, '1.00M'],
    [2.5e9, '2.50B'], [7.77e12, '7.77T'], [999.99e12, '999.99T'], [1e15, '1.00e15'], ['1.234e45', '1.23e45'], ['9.999e400', '9.99e400'],
  ])('%s shows as %s', (value, text) => {
    expect(formatNumber(new Decimal(value))).toBe(text);
  });

  it.each([[21.8, '22'], [50, '50'], [128.00000000000003, '128'], [999.5, '1.00K'], [1234, '1.24K'], [999999, '1.00M'], ['9.999e400', '1.00e401']])(
    '%s rounded up shows as %s', (value, text) => {
      expect(formatNumber(new Decimal(value), 'up')).toBe(text);
    },
  );
});
