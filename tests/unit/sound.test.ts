import Decimal from 'break_infinity.js';
import { describe, expect, it } from 'vitest';
import { SOUNDS_PER_SECOND, SoundPicker } from '../../src/platform/sounds';
import type { SimEvent } from '../../src/sim/types';

const shot: SimEvent = { type: 'shot', slot: 0, kind: 'bolt', points: [], splash: 0 };
const death = (kind: 'grunt' | 'boss'): SimEvent => ({ type: 'death', enemyId: 1, kind, x: 0, y: 0, gold: new Decimal(1) });

describe('sounds for game events', () => {
  it('maps each event to its sound', () => {
    const events: SimEvent[] = [
      shot, death('grunt'), death('boss'), { type: 'leak', enemyId: 2, kind: 'grunt' },
      { type: 'cast', ability: 'stasis', x: 1, y: 1 }, { type: 'waveStart', wave: 10 },
      { type: 'prestige', cores: new Decimal(3), wave: 50 },
    ];
    expect(new SoundPicker().pick(events, 0)).toEqual([
      { name: 'shot', tower: 'bolt' }, { name: 'death', boss: false }, { name: 'death', boss: true }, { name: 'leak' },
      { name: 'ability', ability: 'stasis' }, { name: 'boss' }, { name: 'prestige' },
    ]);
  });

  it('only boss waves sound when they start', () => {
    expect(new SoundPicker().pick([{ type: 'waveStart', wave: 9 }], 0)).toEqual([]);
  });

  it('plays at most 8 shots in any second', () => {
    const picker = new SoundPicker();
    expect(SOUNDS_PER_SECOND.shot).toBe(8);
    expect(picker.pick(Array(20).fill(shot), 0)).toHaveLength(8);
    expect(picker.pick([shot], 999)).toHaveLength(0);
    expect(picker.pick(Array(20).fill(shot), 1000)).toHaveLength(8);
    // Spread out over time, every shot plays.
    const spread = new SoundPicker();
    let played = 0;
    for (let t = 0; t < 10_000; t += 125) played += spread.pick([shot], t).length;
    expect(played).toBe(80);
  });

  it('limits each sound on its own', () => {
    const picker = new SoundPicker();
    picker.pick(Array(8).fill(shot), 0);
    expect(picker.pick([death('grunt')], 0)).toHaveLength(1);
    expect(picker.allow('purchase', 0)).toBe(true);
  });
});
