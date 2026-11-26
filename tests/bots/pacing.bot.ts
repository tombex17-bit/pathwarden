import { describe, expect, it } from 'vitest';
import { createState } from '../../src/sim/sim';
import { playRun } from './player';

// The pacing targets of SPEC section 9.

const log = (text: string): void => void process.stdout.write(`${text}\n`);
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const h = (hours: number | undefined): string => (hours === undefined ? 'never' : `${hours.toFixed(2)} h`);

describe('first run', () => {
  it('the Typical player can prestige after 3-5 hours, and reaches waves 25 and 50 in time', () => {
    const runs = [1, 2, 3, 4, 5].map((seed) => {
      const run = playRun(createState(seed), { typical: true, maxHours: 8, prestige: false });
      log(`seed ${seed}: wave 25 at ${h(run.reached[25])}, 50 at ${h(run.reached[50])}, 100 at ${h(run.reached[100])}, prestige possible at ${h(run.prestigeReadyAt)}`);
      return run;
    });
    const first = median(runs.map((r) => r.prestigeReadyAt ?? Infinity));
    const at25 = median(runs.map((r) => r.reached[25] ?? Infinity)) * 60;
    const at50 = median(runs.map((r) => r.reached[50] ?? Infinity)) * 60;
    log(`median: prestige ${first.toFixed(2)} h, wave 25 ${at25.toFixed(1)} min, wave 50 ${at50.toFixed(1)} min`);
    expect(first).toBeGreaterThanOrEqual(3);
    expect(first).toBeLessThanOrEqual(5);
    expect(at25).toBeGreaterThanOrEqual(8);
    expect(at25).toBeLessThanOrEqual(20);
    expect(at50).toBeGreaterThanOrEqual(20);
    expect(at50).toBeLessThanOrEqual(60);
  });

  it('an idle-only player reaches wave 100 within 10 hours', () => {
    for (const seed of [1, 2]) {
      const run = playRun(createState(seed), { typical: false, maxHours: 10, prestige: false });
      log(`idle-only seed ${seed}: wave 100 at ${h(run.reached[100])}`);
      expect(run.reached[100]).toBeDefined();
    }
  });
});

describe('later runs', () => {
  it.each([1, 2])('seed %i: over 30 prestiges the best wave keeps rising and no run exceeds 12 hours', (seed) => {
    const state = createState(seed);
    const bests: number[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 31; i++) {
      const run = playRun(state, { typical: true, maxHours: 12, prestige: true });
      expect(run.prestigeReadyAt, `run ${i} never could prestige`).toBeDefined();
      expect(run.hours, `run ${i} took too long`).toBeLessThanOrEqual(12);
      bests.push(state.bestEver);
      lines.push(`${i}: ${run.hours.toFixed(1)} h, best ${run.bestRun}`);
    }
    log(`seed ${seed}: ${lines.join(' | ')}`);
    log(`seed ${seed}: Power ${state.power}, Greed ${state.greed}, Cores left ${state.cores.toString()}`);
    // Prestiges 1-30 follow the first run; each window of 10 must raise the best wave.
    for (const end of [10, 20, 30]) {
      expect(bests[end]!, `prestiges ${end - 9}-${end} did not raise the best wave`).toBeGreaterThan(bests[end - 10]!);
    }
  });
});
