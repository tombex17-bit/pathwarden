import Decimal from 'break_infinity.js';
import { TOWER_KINDS } from '../../src/config/balance';
import { encode } from '../../src/platform/save';
import { defaultSettings, type Settings } from '../../src/platform/settings';
import { createState, refreshDamage, step } from '../../src/sim/sim';
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

/** Wave 8 with the Warden unlocked, two Bolts ready to merge, and an empty field. */
export function veteran(): State {
  const s = createState(6, 8);
  s.bestRun = s.bestEver = 7;
  s.spawns = [];
  s.waveTick = 100;
  s.gold = new Decimal(5000);
  addTower(s, 0, 'bolt', { level: 20 });
  addTower(s, 1, 'bolt', { level: 22 });
  s.towers[0]!.kills = 60;
  s.towers[1]!.kills = 8;
  return s;
}

/** Three slow Brutes held in a Stasis zone near the start, and no towers. */
export function heldBrutes(): State {
  const s = createState(2);
  s.spawns = [];
  for (const d of [3, 3.3, 3.6]) place(s, 'brute', d);
  s.zones = [{ kind: 'stasis', x: 3.3, y: 1, untilTick: 1e6 }];
  return s;
}

/** Crossroads with the Warden, a tier II Bolt of rank 3 and a wave in progress, for screenshots. */
export function crossroads(): State {
  const s = createState(8, 40);
  s.map = s.nextMap = 'crossroads';
  s.bestRun = s.bestEver = 39;
  s.gold = new Decimal(2.5e4);
  addTower(s, 2, 'cannon', { level: 45, spec: 'b' }).tier = 2;
  s.towers[0]!.kills = 400;
  addTower(s, 5, 'bolt', { level: 40 });
  addTower(s, 6, 'frost', { level: 38 });
  addTower(s, 1, 'tesla', { level: 35 });
  s.towers.push({ ...s.towers[1]!, slot: 9, kind: 'warden', level: 60, kills: 30, buildPaid: new Decimal(0) });
  for (const t of s.towers) refreshDamage(s, t);
  for (let i = 0; i < seconds(6); i++) step(s);
  return s;
}

/** The Maze between waves, with a few walls and towers. */
export function mazeScene(): State {
  const s = createState(9, 90);
  s.bestRun = s.bestEver = 95;
  s.map = s.nextMap = 'maze';
  s.walls = [3 * 16 + 4, 4 * 16 + 4, 4 * 16 + 9, 5 * 16 + 4];
  s.spawns = [];
  s.waveTick = 100;
  s.gold = new Decimal(1e8);
  addTower(s, 0, 'cannon', { level: 60 });
  addTower(s, 6, 'bolt', { level: 60 });
  addTower(s, 10, 'frost', { level: 55 });
  return s;
}

/** The Wilds on a fixed seed, mid-wave, with towers along the road. */
export function wildsScene(): State {
  const s = createState(10, 70);
  s.bestRun = s.bestEver = 75;
  s.map = s.nextMap = 'wilds';
  s.wildSeed = 4242;
  s.gold = new Decimal(1e7);
  for (const [slot, kind] of [[0, 'bolt'], [3, 'cannon'], [5, 'tesla'], [8, 'beam']] as const) addTower(s, slot, kind, { level: 50 });
  for (let i = 0; i < seconds(5); i++) step(s);
  return s;
}
