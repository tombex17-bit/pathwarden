import Decimal from 'break_infinity.js';
import { describe, expect, it, vi } from 'vitest';
import { SAVE_VERSION, decode, encode, exportText, importText, type SaveData } from '../../src/platform/save';
import { BACKUP_KEY, DAMAGED_KEY, MAIN_KEY, SaveStore, type StorageLike } from '../../src/platform/save-store';
import { Session } from '../../src/platform/session';
import type { Settings } from '../../src/platform/settings';
import { claimTab, type LocksLike } from '../../src/platform/tab-lock';
import { createState, step } from '../../src/sim/sim';
import type { Command, State } from '../../src/sim/types';
import { addTower, run, until } from './helpers';

const NOW = 1_800_000_000_000;
const SETTINGS: Settings = { speed: 2, volume: 0.35, muted: true, guide: 3 };

/** A busy game in the middle of a wave, with every kind of content in play. */
function busy(): State {
  const s = createState(5, 60);
  s.bestEver = s.bestRun = 59;
  s.gold = new Decimal('1.2345e400');
  const kinds = ['bolt', 'cannon', 'frost', 'beam', 'tesla'] as const;
  step(s, kinds.map((tower, slot): Command => ({ type: 'build', slot, tower })));
  step(s, kinds.map((_, slot): Command => ({ type: 'upgrade', slot, amount: 25 })));
  step(s, [{ type: 'specialize', slot: 2, choice: 'b' }, { type: 'specialize', slot: 3, choice: 'b' }]);
  run(s, 100);
  step(s, [{ type: 'cast', ability: 'bounty', x: 1.2, y: 1 }, { type: 'cast', ability: 'stasis', x: 3, y: 1 }]);
  run(s, 60);
  expect(s.enemies.length).toBeGreaterThan(5);
  expect(s.spawns.length).toBeGreaterThan(0);
  expect(s.zones).toHaveLength(2);
  expect(s.towers.some((t) => t.locks.length > 0)).toBe(true);
  return s;
}

function load(text: string): SaveData {
  const result = decode(text);
  if (!result.ok) throw new Error(result.reason);
  return result.data;
}

function memory(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const text = (s: State = createState(1), now = NOW): string => encode(s, SETTINGS, now);
// Edits the saved JSON in a deliberately untyped way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edited = (edit: (save: any) => void, s = busy()): string => {
  const save = JSON.parse(text(s));
  edit(save);
  return JSON.stringify(save);
};

describe('round trip', () => {
  it('restores a busy mid-wave game exactly, including gold above 1e308', () => {
    const s = busy();
    const data = load(text(s));
    expect(data.state).toEqual(s);
    expect(data.state.gold.eq('1e400')).toBe(false);
    expect(data.state.gold.eq(s.gold)).toBe(true);
    expect(data.settings).toEqual(SETTINGS);
    expect(data.savedAt).toBe(NOW);
  });

  it('plays on identically after loading', () => {
    const s = busy();
    const copy = load(text(s)).state;
    run(s, 3000);
    run(copy, 3000);
    expect(copy).toEqual(s);
  });

  it('restores the pause after a loss and finished-wave history', () => {
    const s = createState(1);
    until(s, 'waveLost');
    run(s, 10);
    expect(load(text(s)).state).toEqual(s);
  });

  it('survives long play with every field in normal use', () => {
    const s = createState(3);
    for (let i = 0; i < 20_000; i++) {
      step(s, i % 300 === 0 ? [{ type: 'build', slot: (i / 300) % 12, tower: 'tesla' }, { type: 'upgrade', slot: 0, amount: 'max' }] : []);
      if (i % 500 === 0) expect(load(text(s)).state).toEqual(s);
    }
  });
});

describe('reloading', () => {
  it('gives no extra gold from repeating a wave', () => {
    const played = createState(2);
    addTower(played, 0, 'bolt', { level: 20 });
    const reloaded = load(text(played)).state;
    let current = reloaded;
    for (let i = 0; i < 12; i++) {
      run(played, 60);
      run(current, 60);
      current = new Session(load(text(current)).state, SETTINGS, NOW, NOW).state;
    }
    expect(current.gold.eq(played.gold)).toBe(true);
    expect(current).toEqual(played);
  });

  it('is no escape from a loss', () => {
    const s = createState(1);
    while (s.lives > 1) step(s);
    const again = load(text(s)).state;
    expect(again.lives).toBe(1);
    expect(again.enemies).toHaveLength(s.enemies.length);
    until(again, 'waveLost', 100);
  });
});

describe('bad saves are refused as corrupt', () => {
  it.each(['', '{}', 'null', '[]', '42', '{"v":1}', '{"v":-1}', '{"v":"1"}', text().slice(0, -5)])('%s', (bad) => {
    expect(decode(bad)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it.each<[string, (save: { state: Record<string, never>; settings: Record<string, unknown>; savedAt: unknown }) => void]>(([
    ['negative gold', (x) => { x.state.gold = [-5, 3]; }],
    ['gold not a number', (x) => { x.state.gold = [null, 3]; }],
    ['unnormalized gold', (x) => { x.state.gold = [55, 3]; }],
    ['wave 0', (x) => { x.state.wave = 0; }],
    ['fractional wave', (x) => { x.state.wave = 1.5; }],
    ['too many lives', (x) => { x.state.lives = 11; }],
    ['missing field', (x) => { delete x.state.attempt; }],
    ['best below this run', (x) => { x.state.bestEver = 1; x.state.bestRun = 2; }],
    ['unknown tower', (x) => { x.state.towers[0].kind = 'laser'; }],
    ['inherited name as tower', (x) => { x.state.towers[0].kind = 'toString'; }],
    ['two towers in one slot', (x) => { x.state.towers[1].slot = x.state.towers[0].slot; }],
    ['slot off the map', (x) => { x.state.towers[0].slot = 12; }],
    ['level 0', (x) => { x.state.towers[0].level = 0; }],
    ['unknown specialization', (x) => { x.state.towers[0].spec = 'c'; }],
    ['unknown enemy', (x) => { x.state.enemies[0].kind = 'ghost'; }],
    ['enemy past the exit', (x) => { x.state.enemies[0].dist = 45; }],
    ['dead enemy', (x) => { x.state.enemies[0].hp = 0; }],
    ['enemy with too much HP', (x) => { x.state.enemies[0].hp = 1.1; }],
    ['repeated enemy id', (x) => { x.state.enemies[1].id = x.state.enemies[0].id; }],
    ['enemy id not yet given out', (x) => { x.state.nextEnemyId = 1; }],
    ['unsorted spawns', (x) => { x.state.spawns.reverse(); }],
    ['negative cooldown', (x) => { x.state.cooldowns.meteor = -1; }],
    ['missing cooldown', (x) => { delete x.state.cooldowns.smite; }],
    ['unknown zone', (x) => { x.state.zones[0].kind = 'fire'; }],
    ['too much history', (x) => { x.state.history = Array(21).fill({ gold: [1, 0], ticks: 1 }); }],
    ['endless list', (x) => { x.state.enemies = Array(501).fill(x.state.enemies[0]); }],
    ['unknown speed', (x) => { x.settings.speed = 100; }],
    ['volume above 1', (x) => { x.settings.volume = 1.5; }],
    ['volume missing', (x) => { delete x.settings.volume; }],
    ['muted not a boolean', (x) => { x.settings.muted = 'yes'; }],
    ['guide out of range', (x) => { x.settings.guide = 16; }],
    ['holding wave 1 with a tower standing', (x) => { x.state.holdForTower = true; }],
    ['bad timestamp', (x) => { x.savedAt = 'yesterday'; }],
    ['negative Cores', (x) => { x.state.cores = [-1, 0]; }],
    ['short layout', (x) => { x.state.layout = [null]; }],
    ['unknown layout tower', (x) => { x.state.layout[3] = 'laser'; }],
    ['owned not a flag', (x) => { x.state.owned.autoCast = 'yes'; }],
    ['missing options', (x) => { delete x.state.options; }],
    ['fractional prestiges', (x) => { x.state.prestiges = 0.5; }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as [string, (x: any) => void][]))('%s', (_, edit) => {
    expect(decode(edited(edit))).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('versions', () => {
  it('refuses a newer schema with its own reason', () => {
    expect(decode(edited((x) => { x.v = SAVE_VERSION + 1; }))).toEqual({ ok: false, reason: 'newer' });
  });

  it('migrates a version 1 save, keeping everything and adding prestige', () => {
    const s = busy();
    const v1 = edited((x) => {
      x.v = 1;
      for (const k of ['cores', 'prestiges', 'clearedThisRun', 'layout', 'owned', 'options', 'holdForTower']) delete x.state[k];
    }, s);
    const data = load(v1);
    expect(data.state).toEqual({ ...s, clearedThisRun: s.bestRun });
    expect(data.state.layout).toHaveLength(12);
  });

  it('migrates a synthetic version 0 save', () => {
    const s = busy();
    const v0 = edited((x) => {
      x.v = 0;
      delete x.settings;
      delete x.state.history;
      delete x.state.waveGold;
      for (const k of ['cores', 'prestiges', 'clearedThisRun', 'layout', 'owned', 'options', 'holdForTower']) delete x.state[k];
    }, s);
    const data = load(v0);
    expect(data.settings).toEqual({ speed: 1, volume: 0.6, muted: false, guide: 15 });
    expect(data.state.holdForTower).toBe(false);
    expect(data.state.history).toEqual([]);
    expect(data.state.waveGold.toNumber()).toBe(0);
    expect(data.state.gold.eq(s.gold)).toBe(true);
    expect(data.state.towers).toEqual(s.towers);
  });
});

it('version 2 saves get sound on at the default volume', () => {
  const v2 = edited((x) => { x.v = 2; x.settings = { speed: 3 }; delete x.state.holdForTower; });
  expect(load(v2).settings).toEqual({ speed: 3, volume: 0.6, muted: false, guide: 15 });
});

it('version 3 saves skip the guide and the first-wave hold', () => {
  const v3 = edited((x) => { x.v = 3; delete x.settings.guide; delete x.state.holdForTower; });
  const data = load(v3);
  expect(data.settings.guide).toBe(15);
  expect(data.state.holdForTower).toBe(false);
});

describe('export and import', () => {
  it('round-trips, ignoring line breaks added on the way', () => {
    const s = busy();
    const out = exportText(text(s));
    expect(out).toMatch(/^TD1\.[A-Za-z0-9+/=]+\.[0-9a-f]{8}$/);
    const wrapped = `  ${out.replace(/(.{60})/g, '$1\n')}\n`;
    const result = importText(wrapped);
    expect(result.ok && result.data.state).toEqual(s);
  });

  it.each(['', 'hello', 'TD1..', 'TD1.abc.00000000', 'TD1.%%%.811c9dc5'])('refuses malformed text "%s"', (bad) => {
    expect(importText(bad)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('refuses text with any character changed or missing', () => {
    const out = exportText(text());
    for (const i of [5, 50, out.length - 3]) {
      const swapped = out[i] === 'A' ? 'B' : 'A';
      expect(importText(out.slice(0, i) + swapped + out.slice(i + 1)).ok).toBe(false);
      expect(importText(out.slice(0, i) + out.slice(i + 1)).ok).toBe(false);
    }
  });

  it('refuses a newer save, and a valid checksum around a bad save', () => {
    expect(importText(exportText(edited((x) => { x.v = 99; })))).toEqual({ ok: false, reason: 'newer' });
    expect(importText(exportText(edited((x) => { x.state.wave = 0; })))).toEqual({ ok: false, reason: 'corrupt' });
    expect(importText(exportText('not json'))).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('save store', () => {
  const store = (m: StorageLike): SaveStore => new SaveStore(() => m);

  it('starts new when empty, and rotates the previous valid save into the backup', () => {
    const m = memory();
    const st = store(m);
    expect(st.load()).toEqual({ kind: 'new' });
    const [a, b, c] = [1, 2, 3].map((i) => text(createState(i))) as [string, string, string];
    expect(st.save(a)).toBe(true);
    expect([m.data.get(MAIN_KEY), m.data.get(BACKUP_KEY)]).toEqual([a, undefined]);
    st.save(b);
    expect([m.data.get(MAIN_KEY), m.data.get(BACKUP_KEY)]).toEqual([b, a]);
    st.save(c);
    expect([m.data.get(MAIN_KEY), m.data.get(BACKUP_KEY)]).toEqual([c, b]);
    expect(store(m).load()).toMatchObject({ kind: 'loaded', from: 'main' });
  });

  it('loads the backup when the main save is corrupt, keeping the damaged text', () => {
    const good = text(createState(8));
    const m = memory({ [MAIN_KEY]: 'damaged', [BACKUP_KEY]: good });
    const st = store(m);
    expect(st.load()).toMatchObject({ kind: 'loaded', from: 'backup', data: { state: { seed: 8 } } });
    expect(m.data.get(DAMAGED_KEY)).toBe('damaged');
    const next = text(createState(9));
    st.save(next);
    expect(m.data.get(MAIN_KEY)).toBe(next);
    expect(m.data.get(BACKUP_KEY)).toBe(good);
  });

  it('loads the backup when the main save is missing', () => {
    const m = memory({ [BACKUP_KEY]: text(createState(8)) });
    expect(store(m).load()).toMatchObject({ kind: 'loaded', from: 'backup' });
  });

  it('overwrites nothing when both are corrupt, until the player decides', () => {
    const m = memory({ [MAIN_KEY]: 'bad', [BACKUP_KEY]: 'worse' });
    const st = store(m);
    expect(st.load()).toEqual({ kind: 'corrupt' });
    expect(st.save(text())).toBe(false);
    expect([...m.data]).toEqual([[MAIN_KEY, 'bad'], [BACKUP_KEY, 'worse']]);
    expect(st.allowOverwrite()).toBe(true);
    expect(st.save(text())).toBe(true);
    expect(m.data.get(MAIN_KEY)).toBe(text());
    expect(m.data.get(DAMAGED_KEY)).toBe('bad');
    expect(m.data.get(BACKUP_KEY)).toBe('worse');
  });

  it('never falls back behind, or writes over, a newer save', () => {
    const newer = edited((x) => { x.v = 99; });
    const m = memory({ [MAIN_KEY]: newer, [BACKUP_KEY]: text() });
    const st = store(m);
    expect(st.load()).toEqual({ kind: 'newer' });
    expect(st.save(text())).toBe(false);
    expect(m.data.get(MAIN_KEY)).toBe(newer);
  });

  it.each<[string, () => StorageLike]>([
    ['cannot be opened', () => { throw new Error('denied'); }],
    ['is full', () => ({ ...memory(), setItem: () => { throw new Error('quota'); } })],
  ])('reports storage that %s, without throwing', (_, open) => {
    const st = new SaveStore(open);
    expect(st.load()).toEqual({ kind: 'unavailable' });
    expect(st.save(text())).toBe(false);
    expect(st.allowOverwrite()).toBe(false);
  });

  it('reports a save that fails later', () => {
    const m = memory();
    const st = store(m);
    st.load();
    m.setItem = () => { throw new Error('quota'); };
    expect(st.save(text())).toBe(false);
  });
});

describe('tab lock', () => {
  /** A minimal Web Locks stand-in shared by several "tabs". */
  function fakeLocks(): { locks: LocksLike; release: () => void } {
    let held = false;
    let free: (() => void) | undefined;
    const waiting: (() => void)[] = [];
    const request = async (_name: string, a: unknown, b?: unknown): Promise<unknown> => {
      const callback = (b ?? a) as (lock: unknown) => Promise<unknown>;
      if (held) {
        if (b) return callback(null);
        await new Promise<void>((r) => waiting.push(r));
      }
      held = true;
      const closed = new Promise<void>((r) => { free = r; });
      return Promise.race([callback({}), closed]);
    };
    return {
      locks: { request } as unknown as LocksLike,
      release: () => {
        held = false;
        free?.();
        waiting.shift()?.();
      },
    };
  }

  it('runs the first tab, holds back the second, and lets it run once the first closes', async () => {
    const { locks, release } = fakeLocks();
    const [first, second] = [0, 1].map(() => ({ onStart: vi.fn(), onWaiting: vi.fn() })) as [
      { onStart: ReturnType<typeof vi.fn>; onWaiting: ReturnType<typeof vi.fn> },
      { onStart: ReturnType<typeof vi.fn>; onWaiting: ReturnType<typeof vi.fn> },
    ];
    void claimTab(locks, first as never);
    await Promise.resolve();
    expect(first.onStart).toHaveBeenCalledExactlyOnceWith(true);
    void claimTab(locks, second as never);
    await new Promise((r) => setTimeout(r));
    expect(second.onWaiting).toHaveBeenCalledOnce();
    expect(second.onStart).not.toHaveBeenCalled();
    release();
    await new Promise((r) => setTimeout(r));
    expect(second.onStart).toHaveBeenCalledExactlyOnceWith(true);
    expect(first.onWaiting).not.toHaveBeenCalled();
  });

  it('runs unlocked when Web Locks are missing', async () => {
    const handlers = { onStart: vi.fn(), onWaiting: vi.fn() };
    await claimTab(undefined, handlers);
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith(false);
    expect(handlers.onWaiting).not.toHaveBeenCalled();
  });
});
