import { expect, it } from 'vitest';
import { TOWER_KINDS, type EnemyKind } from '../../src/config/balance';
import { createState, step } from '../../src/sim/sim';
import type { State } from '../../src/sim/types';
import { addTower, place } from '../unit/helpers';

const LIMIT_MS = 0.1;
const STEPS = 300;

/** The heaviest field: 72 enemies and a boss, all alive, and 12 towers that keep firing. */
function worstCase(): State {
  const s = createState(1, 10);
  s.spawns = [];
  const kinds: EnemyKind[] = ['swarm', 'shielded', 'regenerator'];
  for (let i = 0; i < 72; i++) place(s, kinds[i % 3]!, i * 0.28);
  place(s, 'boss', 5);
  for (let i = 0; i < 12; i++) addTower(s, i, TOWER_KINDS[i % 5]!, { spec: i % 2 ? 'a' : 'b', weak: true });
  return s;
}

it(`a step takes at most ${LIMIT_MS} ms on average`, () => {
  const time = (rounds: number): number => {
    let total = 0;
    for (let r = 0; r < rounds; r++) {
      const s = worstCase();
      const start = performance.now();
      for (let i = 0; i < STEPS; i++) step(s);
      total += performance.now() - start;
      expect(s.enemies).toHaveLength(73);
    }
    return total / (rounds * STEPS);
  };
  time(3);
  const average = time(20);
  process.stdout.write(`Average step: ${average.toFixed(4)} ms
`);
  expect(average).toBeLessThanOrEqual(LIMIT_MS);
});
