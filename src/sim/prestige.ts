import Decimal from 'break_infinity.js';
import { ABILITIES, AUTO_CAST_ABILITIES, CHALLENGE_CORES, GOLD, GREED_MULT, PERMANENT, PRESTIGE, TICKS_PER_SECOND, type PermanentKind } from '../config/balance';
import { bestTarget, cast, isUnlocked } from './abilities';
import { buildCost, canAfford, upgradeCost } from './economy';
import { builtTowers, heroOf, isHero, newTower, refreshAll } from './towers';
import type { CommandResult, SimEvent, State } from './types';
import { slotCount } from './waves';

const no = (reason: string): CommandResult => ({ ok: false, reason });

/** Cores a prestige would give now. */
export function coresFor(bestRun: number): Decimal {
  return Decimal.pow(PRESTIGE.coreGrowth, bestRun - PRESTIGE.minWave).mul(PRESTIGE.coreBase).floor();
}

/** Cores a prestige would give now, with +50% for each challenge in force this run. */
export function prestigeCores(state: State): Decimal {
  return coresFor(state.bestRun).mul(1 + CHALLENGE_CORES * state.challenges.length).floor();
}

export function prestigeBlocker(state: State): string | undefined {
  if (state.bestRun < PRESTIGE.minWave) return `Clear wave ${PRESTIGE.minWave} first`;
  if (state.clearedThisRun < PRESTIGE.minCleared) return `Clear ${PRESTIGE.minCleared} waves in this run first`;
  return undefined;
}

/** The wave a new run starts at. */
export function headStartWave(bestEver: number): number {
  return Math.max(1, Math.floor(PRESTIGE.headStartShare * bestEver));
}

/** Gold a run starts with: GOLD.start for the very first run, then enough for a quick start. */
export function startingGold(wave: number, greed: number, prestiges: number): Decimal {
  if (prestiges === 0) return new Decimal(GOLD.start);
  return Decimal.pow(GOLD.growth, wave - 1)
    .mul(PRESTIGE.startGoldWaves * slotCount(wave) * GOLD.base)
    .mul(Decimal.pow(GREED_MULT, greed));
}

/** Ends the run: pays Cores, records the layout and starts again further ahead. */
export function prestige(state: State, startWave: () => void): CommandResult {
  const blocker = prestigeBlocker(state);
  if (blocker) return no(blocker);
  state.cores = state.cores.add(prestigeCores(state));
  state.challenges = [...state.nextChallenges];
  state.layout = state.layout.map((_, i) => state.towers.find((t) => t.slot === i && !isHero(t))?.kind ?? null);
  // The Warden stays in its slot but starts again at level 1.
  const hero = heroOf(state);
  state.prestiges++;
  state.wave = headStartWave(state.bestEver);
  state.gold = startingGold(state.wave, state.greed, state.prestiges);
  state.towers = hero ? [newTower(hero.slot, 'warden', new Decimal(0))] : [];
  state.heroXp = new Decimal(0);
  state.heroMoveTicks = 0;
  refreshAll(state);
  state.bestRun = 0;
  state.clearedThisRun = 0;
  state.cooldowns = { meteor: 0, stasis: 0, bounty: 0, smite: 0 };
  state.zones = [];
  state.history = [];
  state.restartTicks = 0;
  startWave();
  return { ok: true };
}

export function permanentCost(state: State, kind: PermanentKind): Decimal {
  const def = PERMANENT[kind];
  if (def.once) return new Decimal(def.cost);
  const level = kind === 'power' ? state.power : state.greed;
  return Decimal.pow(PERMANENT[kind].growth, level).mul(def.cost).ceil();
}

export function owns(state: State, kind: 'autoUpgrade' | 'autoCast'): boolean {
  return state.owned[kind];
}

/** Buys a permanent upgrade with Cores. Damage is refreshed by the caller. */
export function buyPermanent(state: State, kind: PermanentKind): CommandResult {
  if (!Object.hasOwn(PERMANENT, kind)) return no('No such upgrade');
  if ((kind === 'autoUpgrade' || kind === 'autoCast') && state.owned[kind]) return no('Already owned');
  const cost = permanentCost(state, kind);
  if (!state.cores.gte(cost)) return no('Not enough Cores');
  state.cores = state.cores.sub(cost);
  switch (kind) {
    case 'power':
      state.power++;
      break;
    case 'greed':
      state.greed++;
      break;
    default:
      state.owned[kind] = true;
      state.options[kind] = true;
  }
  return { ok: true };
}

/** Once per game second: rebuild the first missing layout tower, otherwise buy the cheapest level. */
export function autoUpgrade(state: State, build: (slot: number) => void, levelUp: (slot: number) => void): void {
  if (!state.owned.autoUpgrade || !state.options.autoUpgrade || state.tick % TICKS_PER_SECOND !== 0) return;
  const slot = state.layout.findIndex((kind, i) => kind !== null && !state.towers.some((t) => t.slot === i));
  if (slot >= 0 && canAfford(state.gold, buildCost(builtTowers(state)))) {
    build(slot);
    return;
  }
  const cheapest = state.towers.filter((t) => !isHero(t)).reduce<(typeof state.towers)[number] | undefined>(
    (best, t) => (best && best.level <= t.level ? best : t), undefined,
  );
  if (cheapest && canAfford(state.gold, upgradeCost(cheapest.level))) levelUp(cheapest.slot);
}

/** Casts ready abilities on the best target, with twice the usual cooldown. Never Bounty Mark. */
export function autoCast(state: State, events: SimEvent[]): void {
  if (!state.owned.autoCast || !state.options.autoCast || state.enemies.length === 0) return;
  for (const ability of AUTO_CAST_ABILITIES) {
    if (state.cooldowns[ability] > 0 || !isUnlocked(state, ability)) continue;
    const target = bestTarget(state, ability);
    if (!target) continue;
    if (cast(state, ability, target, events).ok) {
      state.cooldowns[ability] = ABILITIES[ability].cooldownSeconds * TICKS_PER_SECOND * PRESTIGE.autoCastCooldownMult;
    }
  }
}
