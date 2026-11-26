import Decimal from 'break_infinity.js';
import { TOWER_KINDS } from '../../src/config/balance';
import { encode } from '../../src/platform/save';
import { defaultSettings, type Settings } from '../../src/platform/settings';
import { createState, step } from '../../src/sim/sim';
import type { State } from '../../src/sim/types';
import { addTower, place, seconds } from '../unit/helpers';

export const save = (s: State, settings: Partial<Settings> = {}): string =>
  encode(s, { ...defaultSettings(), ...settings }, Date.now());

function play(s: State, secs: number): State {
  for (let i = 0; i < seconds(secs); i++) step(s);
  return s;
}

/** Wave 2 with two towers and enemies on the path. */
export function early(): State {
  const s = createState(5, 2);
  addTower(s, 0, 'bolt', { level: 3 });
  addTower(s, 4, 'cannon');
  s.gold = new Decimal(35);
  return play(s, 7);
}

/** Wave 10 with the boss on the field and every tower kind standing. */
export function boss(): State {
  const s = createState(4, 10);
  s.bestRun = s.bestEver = 9;
  for (let i = 0; i < 10; i++) addTower(s, i, TOWER_KINDS[i % 5]!, { level: 12 });
  s.gold = new Decimal(840);
  play(s, 7);
  if (!s.enemies.some((e) => e.kind === 'boss')) throw new Error('The boss should be out');
  return s;
}

/** Wave 104 cleared after 10 waves this run, so prestige is open. */
export function prestigeReady(): State {
  const s = createState(3, 105);
  s.bestRun = 104;
  s.bestEver = 110;
  s.clearedThisRun = 10;
  s.gold = new Decimal(1e9);
  s.cores = new Decimal(2);
  addTower(s, 0, 'bolt', { level: 30 });
  addTower(s, 4, 'cannon', { level: 30 });
  return s;
}

/** The heaviest field from the step benchmark: 72 enemies, a boss and 12 towers. */
export function crowded(): State {
  const s = createState(1, 10);
  s.spawns = [];
  const kinds = ['swarm', 'shielded', 'regenerator'] as const;
  for (let i = 0; i < 72; i++) place(s, kinds[i % 3]!, i * 0.28);
  place(s, 'boss', 5);
  for (let i = 0; i < 12; i++) addTower(s, i, TOWER_KINDS[i % 5]!, { spec: i % 2 ? 'a' : 'b' });
  return s;
}
