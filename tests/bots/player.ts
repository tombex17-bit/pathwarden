import { SPEC_LEVEL, TICKS_PER_SECOND, type PermanentKind } from '../../src/config/balance';
import { SLOTS } from '../../src/config/map';
import { buildCost, canAfford, upgradeCost } from '../../src/sim/economy';
import { permanentCost, prestigeBlocker } from '../../src/sim/prestige';
import { step } from '../../src/sim/sim';
import type { Command, SimEvent, State } from '../../src/sim/types';
import { BUILD_ORDER, SPECS, castCommands } from './policy';

// The Typical and idle-only players of SPEC section 9.

const HOUR = 3600 * TICKS_PER_SECOND;
const PHASE = 10 * 60 * TICKS_PER_SECOND;
const BUY_EVERY = 5 * TICKS_PER_SECOND;
const STALL = 40 * 60 * TICKS_PER_SECOND;

/** Every 5 s: the cheapest level, or the next tower in build order when it costs at most 1.5x that level. */
export function buyCommands(state: State): Command[] {
  const commands: Command[] = [];
  let gold = state.gold;
  const levels = new Map(state.towers.map((t) => [t.slot, t.level]));
  for (let guard = 0; guard < 10_000; guard++) {
    let cheapest: number | undefined;
    for (const [slot, level] of levels) if (cheapest === undefined || level < levels.get(cheapest)!) cheapest = slot;
    const levelCost = cheapest === undefined ? undefined : upgradeCost(levels.get(cheapest)!);
    const nextSlot = SLOTS.findIndex((_, i) => !levels.has(i));
    const towerCost = buildCost(levels.size);
    if (nextSlot >= 0 && (!levelCost || towerCost.lte(levelCost.mul(1.5)))) {
      if (!canAfford(gold, towerCost)) break;
      commands.push({ type: 'build', slot: nextSlot, tower: BUILD_ORDER[nextSlot]! });
      gold = gold.sub(towerCost);
      levels.set(nextSlot, 1);
    } else if (cheapest !== undefined && levelCost && canAfford(gold, levelCost)) {
      commands.push({ type: 'upgrade', slot: cheapest, amount: 1 });
      gold = gold.sub(levelCost);
      levels.set(cheapest, levels.get(cheapest)! + 1);
    } else break;
  }
  return commands;
}

function specializeCommands(state: State): Command[] {
  return state.towers
    .filter((t) => t.level >= SPEC_LEVEL && t.spec === null)
    .map((t) => ({ type: 'specialize', slot: t.slot, choice: SPECS[t.kind] }));
}

/** Auto-upgrade, then Auto-cast, then the cheaper of Power and Greed (Power on ties). */
export function spendCores(state: State): Command[] {
  const commands: Command[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    let pick: PermanentKind;
    if (!state.owned.autoUpgrade) pick = 'autoUpgrade';
    else if (!state.owned.autoCast) pick = 'autoCast';
    else pick = permanentCost(state, 'greed').lt(permanentCost(state, 'power')) ? 'greed' : 'power';
    if (!state.cores.gte(permanentCost(state, pick))) break;
    // Applied one at a time, since each purchase changes the next price.
    const { results } = step(state, [{ type: 'buyPermanent', upgrade: pick }]);
    if (!results[0]!.ok) break;
    commands.push({ type: 'buyPermanent', upgrade: pick });
  }
  return commands;
}

export interface Run {
  /** Game hours until prestige became possible, or undefined if it never did. */
  prestigeReadyAt: number | undefined;
  /** Game hours to clear each milestone wave. */
  reached: Record<number, number>;
  bestRun: number;
  hours: number;
}

/**
 * Plays one run until it prestiges (or until `maxHours`). `typical` alternates 10 minutes of active
 * play with 10 minutes of idling; otherwise the player buys all the time and never casts.
 */
export function playRun(state: State, options: { typical: boolean; maxHours: number; prestige: boolean }): Run {
  const start = state.tick;
  const reached: Record<number, number> = {};
  let readyAt: number | undefined;
  let lastRise = state.tick;
  let best = state.bestRun;
  const hours = (): number => (state.tick - start) / HOUR;

  while (state.tick - start < options.maxHours * HOUR) {
    const active = !options.typical || Math.floor((state.tick - start) / PHASE) % 2 === 0;
    let commands: Command[] = [];
    if (active) {
      if (options.typical) commands = castCommands(state);
      if ((state.tick - start) % BUY_EVERY === 0) commands.push(...buyCommands(state), ...specializeCommands(state));
    }
    const { events } = step(state, commands);
    if (events.some((e: SimEvent) => e.type === 'waveClear')) {
      for (const w of [25, 50, 75, 100]) if (state.bestRun >= w && reached[w] === undefined) reached[w] = hours();
      if (state.bestRun > best) {
        best = state.bestRun;
        lastRise = state.tick;
      }
      if (readyAt === undefined && !prestigeBlocker(state)) readyAt = hours();
    }
    if (options.prestige && readyAt !== undefined && state.tick - lastRise >= STALL) {
      const run = { prestigeReadyAt: readyAt, reached, bestRun: state.bestRun, hours: hours() };
      step(state, [{ type: 'prestige' }]);
      spendCores(state);
      return run;
    }
  }
  return { prestigeReadyAt: readyAt, reached, bestRun: state.bestRun, hours: hours() };
}
