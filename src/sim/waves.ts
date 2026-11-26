import { ENEMIES, HP, TICKS_PER_SECOND, WAVE, type EnemyKind } from '../config/balance';
import { createRng } from './rng';
import type { PendingSpawn } from './types';

const KINDS = Object.keys(ENEMIES) as EnemyKind[];

export function slotCount(wave: number): number {
  return WAVE.baseSlots + Math.min(WAVE.extraSlotsMax, Math.floor(wave / WAVE.wavesPerExtraSlot));
}

export function hasBoss(wave: number): boolean {
  return wave % WAVE.bossEvery === 0;
}

/** log10 of an enemy's maximum HP; logs stay finite at any wave. */
export function log10EnemyHp(wave: number, kind: EnemyKind): number {
  return Math.log10(HP.base * ENEMIES[kind].hpMult) + (wave - 1) * Math.log10(HP.growth);
}

/** Picks an unlocked enemy by weight; `roll` is in [0, 1). */
export function pickEnemy(wave: number, roll: number): EnemyKind {
  const open = KINDS.filter((k) => ENEMIES[k].weight > 0 && ENEMIES[k].firstWave <= wave);
  let left = roll * open.reduce((sum, k) => sum + ENEMIES[k].weight, 0);
  for (const kind of open) {
    left -= ENEMIES[kind].weight;
    if (left < 0) return kind;
  }
  return open[open.length - 1]!;
}

export function buildSpawns(seed: number, wave: number, attempt: number): PendingSpawn[] {
  const rng = createRng(seed, wave, attempt);
  const n = slotCount(wave);
  const spawns: PendingSpawn[] = [];
  for (let i = 0; i < n; i++) {
    const kind = pickEnemy(wave, rng());
    const { perSlot = 1, unitGap = 0 } = ENEMIES[kind];
    const start = (WAVE.spawnSeconds * TICKS_PER_SECOND * i) / (n - 1);
    for (let unit = 0; unit < perSlot; unit++) {
      spawns.push({ tick: Math.round(start + unit * unitGap * TICKS_PER_SECOND), kind });
    }
  }
  if (hasBoss(wave)) spawns.push({ tick: WAVE.bossSeconds * TICKS_PER_SECOND, kind: 'boss' });
  return spawns.sort((a, b) => a.tick - b.tick);
}
