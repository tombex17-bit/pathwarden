import Decimal from 'break_infinity.js';
import { IDLE, TICKS_PER_SECOND } from '../config/balance';
import type { State } from './types';

/** Remembers a finished wave, won or lost, for the idle rate. */
export function recordWave(state: State, ticks: number): void {
  state.history.push({ gold: state.waveGold, ticks });
  if (state.history.length > IDLE.waves) state.history.shift();
}

/** Base gold per game second over the last finished waves, without bounties; 0 before the first. */
export function idleRate(state: State): Decimal {
  const ticks = state.history.reduce((sum, w) => sum + w.ticks, 0);
  if (ticks === 0) return new Decimal(0);
  const gold = state.history.reduce((sum, w) => sum.add(w.gold), new Decimal(0));
  return gold.mul(TICKS_PER_SECOND).div(ticks);
}

/** Pays for real time spent away and returns the gold earned. Waves do not advance. */
export function payOffline(state: State, awaySeconds: number): Decimal {
  const seconds = Math.min(IDLE.capSeconds, Math.max(0, awaySeconds));
  const gold = idleRate(state).mul(IDLE.offlineShare * seconds);
  state.gold = state.gold.add(gold);
  return gold;
}
