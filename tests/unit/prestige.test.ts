import Decimal from 'break_infinity.js';
import { describe, expect, it } from 'vitest';
import { ABILITY_KINDS, GOLD, type PermanentKind } from '../../src/config/balance';
import { idleRate } from '../../src/sim/idle';
import { coresFor, headStartWave, permanentCost, startingGold } from '../../src/sim/prestige';
import { createState, step } from '../../src/sim/sim';
import type { Command, SimEvent, State } from '../../src/sim/types';
import { addTower, build, emptyField, place, run } from './helpers';

const PRESTIGE: Command = { type: 'prestige' };
const buy = (upgrade: PermanentKind): Command => ({ type: 'buyPermanent', upgrade });

const near = (value: Decimal, expected: number): void => {
  expect(Math.abs(value.toNumber() / expected - 1)).toBeLessThan(1e-9);
};

/** A run that may prestige: wave 100 cleared, 10 waves this run. */
function ready(): State {
  const s = createState(4, 105);
  s.bestRun = 104;
  s.bestEver = 130;
  s.clearedThisRun = 10;
  s.gold = new Decimal(1e12);
  s.kills = 777;
  addTower(s, 0, 'bolt', { level: 40, spec: 'a' });
  addTower(s, 5, 'frost', { level: 3 });
  s.history = [{ gold: new Decimal(5), ticks: 720 }];
  s.cooldowns.meteor = 500;
  s.zones = [{ kind: 'bounty', x: 1, y: 1, untilTick: 99999 }];
  s.power = 2;
  s.greed = 1;
  s.cores = new Decimal(3);
  s.autoAdvance = false;
  return s;
}

describe('formulas', () => {
  it.each([[100, 10], [101, 10], [110, 17], [150, 184], [300, Math.floor(10 * 1.06 ** 200)]])('best wave %i gives %i Cores', (wave, cores) => {
    expect(coresFor(wave).toNumber()).toBe(cores);
  });

  it('Cores keep working past 1e308', () => {
    expect(coresFor(13_000).log10()).toBeCloseTo(1 + 12_900 * Math.log10(1.06), 6);
  });

  it.each([[0, 1], [1, 1], [3, 1], [130, 65], [131, 65], [5001, 2500]])('best ever %i starts at wave %i', (best, wave) => {
    expect(headStartWave(best)).toBe(wave);
  });

  it('a run starts with 20 x N(s) x baseGold(s) x 1.3^G, except the first', () => {
    expect(startingGold(1, 0, 0).toNumber()).toBe(GOLD.start);
    near(startingGold(65, 0, 1), 20 * 18 * 2 * 1.065 ** 64);
    near(startingGold(65, 3, 7), 20 * 18 * 2 * 1.065 ** 64 * 1.3 ** 3);
    near(startingGold(1, 0, 1), 20 * 12 * 2);
  });

  it.each<[PermanentKind, number, number]>([['power', 0, 5], ['power', 1, 8], ['power', 2, 12], ['power', 10, 289], ['greed', 3, 17], ['autoUpgrade', 0, 5], ['autoCast', 0, 10]])(
    '%s at level %i costs %i Cores', (kind, level, cost) => {
      const s = createState(1);
      s.power = s.greed = level;
      expect(permanentCost(s, kind).toNumber()).toBe(cost);
    },
  );
});

describe('prestige conditions', () => {
  it('needs wave 100 cleared', () => {
    const s = ready();
    s.bestRun = 99;
    expect(step(s, [PRESTIGE]).results).toEqual([{ ok: false, reason: 'Clear wave 100 first' }]);
    expect(s.cores.toNumber()).toBe(3);
  });

  it('needs 10 waves cleared in this run', () => {
    const s = ready();
    s.clearedThisRun = 9;
    expect(step(s, [PRESTIGE]).results).toEqual([{ ok: false, reason: 'Clear 10 waves in this run first' }]);
    s.clearedThisRun = 10;
    expect(step(s, [PRESTIGE]).results).toEqual([{ ok: true }]);
  });

  it('counts cleared waves, not lost ones', () => {
    const s = createState(1);
    for (let i = 0; i < 4; i++) addTower(s, i, 'bolt', { level: 20 });
    s.autoAdvance = false;
    run(s, 720 * 3 + 10);
    expect(s.clearedThisRun).toBe(3);
    const lose = createState(1);
    run(lose, 2000);
    expect(lose.clearedThisRun).toBe(0);
  });
});

describe('prestige', () => {
  // Every state field, sorted into what a prestige keeps and what it resets.
  const KEPT = ['seed', 'tick', 'power', 'greed', 'attempt', 'bestEver', 'autoAdvance', 'nextEnemyId', 'kills', 'owned', 'options', 'holdForTower', 'map', 'nextMap', 'tapTicks',
    'wildSeed', 'walls', 'rallyTicks', 'rallyCooldown', 'nextChallenges'] as const;
  const RESET = [
    'gold', 'wave', 'waveTick', 'lives', 'restartTicks', 'bestRun', 'spawns', 'enemies', 'towers', 'cooldowns', 'zones',
    'waveGold', 'history', 'cores', 'prestiges', 'clearedThisRun', 'layout', 'heroXp', 'heroMoveTicks', 'challenges',
  ] as const;

  it('sorts every state field', () => {
    expect([...KEPT, ...RESET].sort()).toEqual(Object.keys(createState(1)).sort());
  });

  it('keeps and resets exactly the listed items', () => {
    const s = ready();
    s.owned.autoCast = s.options.autoCast = true;
    const before = structuredClone(s);
    const { events } = step(s, [PRESTIGE]);
    for (const k of KEPT) {
      if (k === 'tick') expect(s.tick).toBe(before.tick + 1);
      else if (k === 'attempt') expect(s.attempt).toBe(before.attempt + 1);
      // Ids keep counting up; the new run's first enemy has already taken one.
      else if (k === 'nextEnemyId') expect(s.nextEnemyId).toBe(before.nextEnemyId + 1);
      else expect(s[k]).toEqual(before[k]);
    }
    expect({
      gold: s.gold.toNumber(), wave: s.wave, waveTick: s.waveTick, lives: s.lives, restartTicks: s.restartTicks,
      bestRun: s.bestRun, enemies: s.enemies.length, towers: s.towers, cooldowns: s.cooldowns, zones: s.zones,
      waveGold: s.waveGold.toNumber(), history: s.history, cores: s.cores.toNumber(), prestiges: s.prestiges,
      clearedThisRun: s.clearedThisRun, layout: s.layout,
    }).toEqual({
      gold: expect.closeTo(startingGold(65, 1, 1).toNumber(), 6), wave: 65, waveTick: 1, lives: 10, restartTicks: 0,
      bestRun: 0, enemies: 1, towers: [], cooldowns: { meteor: 0, stasis: 0, bounty: 0, smite: 0 }, zones: [],
      waveGold: 0, history: [], cores: 3 + 12, prestiges: 1,
      clearedThisRun: 0, layout: ['bolt', null, null, null, null, 'frost', null, null, null, null, null, null],
    });
    expect(s.spawns.length).toBeGreaterThan(0);
    expect(idleRate(s).toNumber()).toBe(0);
    expect(events).toContainEqual({ type: 'prestige', cores: coresFor(104), wave: 65 });
  });

  it('keeps ability unlocks, which come from the best wave ever', () => {
    const s = ready();
    step(s, [PRESTIGE]);
    place(s, 'brute', 3);
    expect(step(s, [{ type: 'cast', ability: 'smite', x: 3, y: 1 }]).results).toEqual([{ ok: true }]);
  });

  it('happens during the pause after a loss too', () => {
    const s = ready();
    s.restartTicks = 30;
    step(s, [PRESTIGE]);
    expect(s.restartTicks).toBe(0);
    expect(s.wave).toBe(65);
  });
});

describe('permanent upgrades', () => {
  it('Power raises the damage of standing towers at once', () => {
    const s = emptyField();
    s.cores = new Decimal(100);
    const t = addTower(s, 0, 'bolt');
    step(s, [buy('power'), buy('power')]);
    expect(s.power).toBe(2);
    expect(10 ** t.log10Damage).toBeCloseTo(4 * 1.4 ** 2, 9);
    expect(s.cores.toNumber()).toBe(100 - 5 - 8);
  });

  it('Greed raises the gold of enemies that appear afterwards', () => {
    const s = emptyField();
    s.cores = new Decimal(5);
    step(s, [buy('greed')]);
    expect(place(s, 'grunt', 3).gold.toNumber()).toBeCloseTo(2 * 1.3, 9);
  });

  it('refuses without enough Cores, unknown upgrades, and a second purchase of automation', () => {
    const s = emptyField();
    s.cores = new Decimal(14);
    expect(step(s, [buy('autoCast'), buy('autoCast'), buy('power'), buy('nope' as PermanentKind)]).results).toEqual([
      { ok: true }, { ok: false, reason: 'Already owned' }, { ok: false, reason: 'Not enough Cores' }, { ok: false, reason: 'No such upgrade' },
    ]);
    expect(s.cores.toNumber()).toBe(4);
  });

  it('automation switches on when bought, can be switched off, and cannot be switched on before buying', () => {
    const s = emptyField();
    s.cores = new Decimal(5);
    expect(step(s, [{ type: 'setOption', option: 'autoUpgrade', value: true }]).results).toEqual([{ ok: false, reason: 'Not bought yet' }]);
    step(s, [buy('autoUpgrade')]);
    expect(s.options.autoUpgrade).toBe(true);
    step(s, [{ type: 'setOption', option: 'autoUpgrade', value: false }]);
    expect(s.options.autoUpgrade).toBe(false);
  });
});

describe('layout and auto-upgrade', () => {
  /** After a prestige with towers in slots 0, 3 and 7, plenty of gold, and Auto-upgrade. */
  function rebuilding(): State {
    const s = ready();
    s.towers = [];
    addTower(s, 7, 'tesla');
    addTower(s, 3, 'cannon');
    addTower(s, 0, 'bolt');
    s.cores = new Decimal(5);
    step(s, [buy('autoUpgrade'), PRESTIGE]);
    s.gold = new Decimal(1e6);
    return s;
  }

  it('rebuilds the layout in slot order, one tower per game second, then buys the cheapest level', () => {
    const s = rebuilding();
    const kinds = (): string[] => s.towers.map((t) => `${t.slot}:${t.kind}`);
    run(s, 30 - (s.tick % 30));
    expect(kinds()).toEqual(['0:bolt']);
    run(s, 30);
    expect(kinds()).toEqual(['0:bolt', '3:cannon']);
    run(s, 30);
    expect(kinds()).toEqual(['0:bolt', '3:cannon', '7:tesla']);
    run(s, 30);
    expect(s.towers.map((t) => t.level)).toEqual([2, 1, 1]);
    run(s, 60);
    expect(s.towers.map((t) => t.level)).toEqual([2, 2, 2]);
    expect(s.towers.every((t) => t.spec === null)).toBe(true);
  });

  it('does not rebuild a sold tower, nor build over a tower the player put in that slot', () => {
    const s = rebuilding();
    s.options.autoUpgrade = false;
    step(s, [build(0, 'frost'), build(3), { type: 'sell', slot: 3 }]);
    expect(s.layout).toEqual([null, null, null, null, null, null, null, 'tesla', null, null, null, null]);
    s.options.autoUpgrade = true;
    run(s, 60);
    expect(s.towers.map((t) => `${t.slot}:${t.kind}`)).toEqual(['0:frost', '7:tesla']);
  });

  it('does not rebuild a tower that was rebuilt and then sold', () => {
    const s = rebuilding();
    run(s, 30 - (s.tick % 30));
    expect(s.towers.map((t) => t.slot)).toEqual([0]);
    s.options.autoUpgrade = false;
    step(s, [{ type: 'sell', slot: 0 }]);
    s.options.autoUpgrade = true;
    run(s, 90);
    expect(s.towers.map((t) => t.slot)).toEqual([3, 7]);
  });

  it('buys a level instead when the next tower is unaffordable, and does nothing without gold', () => {
    const s = rebuilding();
    s.options.autoUpgrade = false;
    step(s, [build(0, 'frost')]);
    s.layout[0] = 'bolt';
    s.gold = new Decimal(25);
    s.options.autoUpgrade = true;
    run(s, 30);
    expect(s.towers).toHaveLength(1);
    expect(s.towers[0]!.level).toBe(2);
    run(s, 300);
    expect(s.towers[0]!.level).toBe(2);
  });

  it('does nothing while switched off', () => {
    const s = rebuilding();
    s.options.autoUpgrade = false;
    run(s, 300);
    expect(s.towers).toEqual([]);
  });
});

describe('auto-cast', () => {
  function casting(): State {
    const s = emptyField(40);
    s.bestEver = 99;
    s.owned.autoCast = s.options.autoCast = true;
    return s;
  }

  it('casts Meteor, Stasis and Smite with twice the cooldown, and never Bounty Mark', () => {
    const s = casting();
    place(s, 'boss', 3);
    const events: SimEvent[] = run(s, 1);
    expect(events.filter((e) => e.type === 'cast').map((e) => e.type === 'cast' && e.ability)).toEqual(['meteor', 'stasis', 'smite']);
    expect(s.cooldowns).toEqual({ meteor: 2400, stasis: 3600, bounty: 0, smite: 2700 });
    const later = run(s, 20_000);
    expect(later.some((e) => e.type === 'cast' && e.ability === 'bounty')).toBe(false);
  });

  it('aims at the biggest group, and Smite at the most HP', () => {
    const s = casting();
    place(s, 'grunt', 1);
    const group = [place(s, 'grunt', 8), place(s, 'grunt', 8.5), place(s, 'grunt', 9)];
    const brute = place(s, 'brute', 12);
    const [groupX, bruteX] = [group[0]!.x, brute.x];
    const casts = run(s, 1).filter((e) => e.type === 'cast');
    expect(casts.find((e) => e.ability === 'meteor')).toMatchObject({ x: groupX });
    expect(casts.find((e) => e.ability === 'smite')).toMatchObject({ x: bruteX });
  });

  it('waits for enemies and unlocks, and stops when switched off', () => {
    const s = casting();
    s.bestEver = 5;
    run(s, 10);
    expect(s.cooldowns.meteor).toBe(0);
    place(s, 'brute', 3);
    run(s, 1);
    expect(s.cooldowns).toEqual({ meteor: 2400, stasis: 0, bounty: 0, smite: 0 });
    s.options.autoCast = false;
    s.cooldowns.meteor = 0;
    run(s, 10);
    expect(s.cooldowns.meteor).toBe(0);
  });

  it('a manual cast in the same step goes first, at the normal cooldown', () => {
    const s = casting();
    place(s, 'brute', 3);
    step(s, [{ type: 'cast', ability: 'meteor', x: 3, y: 1 }]);
    expect(s.cooldowns.meteor).toBe(1199);
  });

  it('pauses after a loss', () => {
    const s = casting();
    s.restartTicks = 50;
    place(s, 'brute', 3);
    run(s, 5);
    for (const a of ABILITY_KINDS) expect(s.cooldowns[a]).toBe(0);
  });
});
