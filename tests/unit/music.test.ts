import { describe, expect, it } from 'vitest';
import { BEATS_PER_BAR, composeBar, hz } from '../../src/platform/music';

describe('generated music', () => {
  it('is the same every time a bar comes round', () => {
    expect(composeBar(37, 'calm')).toEqual(composeBar(37, 'calm'));
    expect(composeBar(37, 'tense')).toEqual(composeBar(37, 'tense'));
  });

  it('stays in A minor (with the raised seventh only in tense music) and inside each bar', () => {
    const inKey = (midi: number, tense: boolean): boolean => [0, 2, 3, 5, 7, 8, 10, ...(tense ? [11] : [])].includes(((midi - 57) % 12 + 12) % 12);
    for (let bar = 0; bar < 200; bar++) {
      for (const mood of ['calm', 'tense'] as const) {
        for (const n of composeBar(bar, mood)) {
          expect(n.beat).toBeGreaterThanOrEqual(0);
          expect(n.beat + n.beats).toBeLessThanOrEqual(BEATS_PER_BAR);
          expect(n.gain).toBeGreaterThan(0);
          if (n.voice !== 'kick' && n.voice !== 'hat') expect(inKey(n.midi, mood === 'tense'), `bar ${bar} ${n.voice} ${n.midi}`).toBe(true);
        }
      }
    }
  });

  it('has a chord and bass in every bar, drums only when tense, and varies over a section', () => {
    for (let bar = 0; bar < 64; bar++) {
      const calm = composeBar(bar, 'calm');
      expect(calm.filter((n) => n.voice === 'pad')).toHaveLength(3);
      expect(calm.some((n) => n.voice === 'bass')).toBe(true);
      expect(calm.some((n) => n.voice === 'kick' || n.voice === 'hat')).toBe(false);
      expect(composeBar(bar, 'tense').filter((n) => n.voice === 'kick')).toHaveLength(4);
    }
    const bars = new Set(Array.from({ length: 32 }, (_, b) => JSON.stringify(composeBar(b, 'calm'))));
    expect(bars.size).toBeGreaterThan(20);
  });

  it('tunes A4 to 440 Hz', () => {
    expect(hz(69)).toBe(440);
    expect(hz(57)).toBe(220);
  });
});
