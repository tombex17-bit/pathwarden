import Decimal from 'break_infinity.js';
import { expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/config/balance';
import { createState, step } from '../../src/sim/sim';
import { addTower } from '../unit/helpers';
import { BUILD_ORDER, castCommands, specAt } from './policy';

const HOURS = 2;
/** With `--autocast`, both players own Auto-cast (SPEC, M5). */
const AUTOCAST = process.env.BOT_AUTOCAST === '1';
const SEEDS = [1, 2];
// Formation level, wave with auto-advance off, starting wave with auto-advance on (SPEC, M3).
const CASES = [[20, 13, 35], [30, 13, 35], [50, 38, 60], [60, 43, 65], [70, 48, 70], [90, 63, 85]] as const;

interface Outcome { gold: Decimal; wave: number; lost: number }

function play(seed: number, level: number, wave: number, autoAdvance: boolean, active: boolean): Outcome {
  const s = createState(seed, wave);
  s.bestEver = 99;
  s.autoAdvance = autoAdvance;
  s.owned.autoCast = s.options.autoCast = AUTOCAST;
  BUILD_ORDER.forEach((kind, slot) => addTower(s, slot, kind, { level, spec: specAt(kind, level) ?? undefined }));
  const start = s.gold;
  let lost = 0;
  for (let i = 0; i < HOURS * 3600 * TICKS_PER_SECOND; i++) {
    for (const e of step(s, active ? castCommands(s) : []).events) if (e.type === 'waveLost') lost++;
  }
  return { gold: s.gold.sub(start), wave: s.wave, lost };
}

function compare(level: number, wave: number, autoAdvance: boolean): number[] {
  return SEEDS.map((seed) => {
    const active = play(seed, level, wave, autoAdvance, true);
    const idle = play(seed, level, wave, autoAdvance, false);
    const ratio = active.gold.div(idle.gold).toNumber();
    process.stdout.write(
      `${AUTOCAST ? 'auto-cast, ' : ''}level ${level}, ${autoAdvance ? 'advancing from' : 'fixed'} wave ${wave}, seed ${seed}: ${ratio.toFixed(2)}x`
      + ` (ends on ${active.wave}/${idle.wave}, lost ${active.lost}/${idle.lost})\n`,
    );
    if (!autoAdvance) expect(idle.lost).toBe(0);
    return ratio;
  });
}

it('farming a wave the towers clear pays 1.8-2.2x', () => {
  for (const ratio of CASES.flatMap(([level, fixed]) => compare(level, fixed, false))) {
    expect(ratio).toBeGreaterThanOrEqual(1.8);
    expect(ratio).toBeLessThanOrEqual(2.2);
  }
});

it('near the losing point pays at most 3.0x (geometric mean)', () => {
  const ratios = CASES.flatMap(([level, , from]) => compare(level, from, true));
  const mean = Math.exp(ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length);
  process.stdout.write(`geometric mean: ${mean.toFixed(2)}x\n`);
  expect(mean).toBeLessThanOrEqual(3);
});
