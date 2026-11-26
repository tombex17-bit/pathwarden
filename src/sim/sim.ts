import Decimal from 'break_infinity.js';
import {
  CHALLENGE_KINDS, GOLD, HERO, MERGE, OVERDRIVE, RALLY, SPEC_LEVEL, TAP, TICKS_PER_SECOND, TOWER_KINDS, WAVE, type TowerKind,
} from '../config/balance';
import { FIRST_MAP, GRID_H, GRID_W, MAPS, MAP_IDS, MAZE, SLOT_COUNT } from '../config/map';
import { applyZones, cast, log10FormationDps, tickCooldowns } from './abilities';
import { damage, distSq, fireTowers } from './combat';
import { buildCost, levelsFor, pay, sellValue, upgradeCost } from './economy';
import { createEnemy, moveEnemies } from './enemies';
import { recordWave } from './idle';
import { cellOf, isOpenOnly, mazeRoute } from './path';
import { autoCast, autoUpgrade, buyPermanent, prestige, prestigeCores } from './prestige';
import { createRng } from './rng';
import { HERO_MOVE_TICKS, builtTowers, heroOf, isHero, newTower, refreshAll, refreshDamage } from './towers';
import type { Command, CommandResult, Enemy, SimEvent, State, StepResult } from './types';
import { buildSpawns } from './waves';

export { refreshDamage } from './towers';

const MIN_WAVE_TICKS = WAVE.minSeconds * TICKS_PER_SECOND;
const RESTART_TICKS = WAVE.restartSeconds * TICKS_PER_SECOND;
const TAP_TICKS = Math.round(TICKS_PER_SECOND / TAP.perSecond);

const OK: CommandResult = { ok: true };
const no = (reason: string): CommandResult => ({ ok: false, reason });

export function createState(seed: number, wave = 1): State {
  const state: State = {
    seed, tick: 0, gold: new Decimal(GOLD.start), power: 0, greed: 0,
    wave, attempt: 0, waveTick: 0, lives: WAVE.lives, restartTicks: 0,
    bestRun: 0, bestEver: 0, autoAdvance: true, nextEnemyId: 1,
    spawns: [], enemies: [], towers: [], kills: 0,
    cooldowns: { meteor: 0, stasis: 0, bounty: 0, smite: 0 }, zones: [],
    waveGold: new Decimal(0), history: [],
    cores: new Decimal(0), prestiges: 0, clearedThisRun: 0, layout: Array<null>(SLOT_COUNT).fill(null),
    owned: { autoUpgrade: false, autoCast: false }, options: { autoUpgrade: false, autoCast: false, keepLayout: false },
    holdForTower: false,
    map: FIRST_MAP, nextMap: FIRST_MAP, heroXp: new Decimal(0), heroMoveTicks: 0, tapTicks: 0,
    wildSeed: 0, walls: [], rallyTicks: 0, rallyCooldown: 0, challenges: [], nextChallenges: [], paused: false,
  };
  startWave(state, []);
  return state;
}

/** A brand-new game: like `createState`, but paused, and wave 1 waits for the first tower. */
export function createNewGame(seed: number): State {
  const state = createState(seed);
  state.holdForTower = true;
  state.paused = true;
  return state;
}

/** Advances the game by exactly one step (1/30 game second), changing `state` in place. */
export function step(state: State, commands: readonly Command[] = []): StepResult {
  const events: SimEvent[] = [];
  const results = commands.map((c) => apply(state, c, events));
  // While paused, only the commands take effect: no time passes.
  if (state.paused) return { events, results };
  state.tick++;
  tickCooldowns(state);
  if (state.heroMoveTicks > 0) state.heroMoveTicks--;
  if (state.tapTicks > 0) state.tapTicks--;
  tickBoosts(state);
  autoUpgrade(
    state,
    (slot) => build(state, slot, state.layout[slot]!),
    (slot) => apply(state, { type: 'upgrade', slot, amount: 1 }, events),
  );
  if (state.restartTicks === 0) autoCast(state, events);

  if (state.restartTicks > 0) {
    if (--state.restartTicks === 0) startWave(state, events);
    return { events, results };
  }
  if (state.holdForTower) {
    if (state.towers.length === 0) return { events, results };
    state.holdForTower = false;
  }

  spawnDue(state);
  applyZones(state, 'stasis');
  moveEnemies(state, events);
  applyZones(state, 'bounty');
  if (state.lives <= 0) {
    loseWave(state, events);
    return { events, results };
  }
  fireTowers(state, events);

  state.waveTick++;
  if (waveDone(state) && state.waveTick >= MIN_WAVE_TICKS) clearWave(state, events);
  return { events, results };
}

/** Everything has spawned and is gone; only the minimum wave length may be left. */
function waveDone(state: State): boolean {
  return state.restartTicks === 0 && !state.holdForTower && state.spawns.length === 0 && state.enemies.length === 0;
}

/** Whether the player can call the next wave now (SPEC section 19). */
export const canCallWave = (state: State): boolean => waveDone(state) && state.waveTick < MIN_WAVE_TICKS;

function apply(state: State, command: Command, events: SimEvent[]): CommandResult {
  switch (command.type) {
    case 'setOption':
      if (command.option === 'autoAdvance') state.autoAdvance = command.value;
      else if (command.option === 'keepLayout') state.options.keepLayout = command.value;
      else if (command.option === 'autoUpgrade' || command.option === 'autoCast') {
        if (!state.owned[command.option]) return no('Not bought yet');
        state.options[command.option] = command.value;
      } else return no('No such option');
      return OK;
    case 'prestige': {
      const cores = prestigeCores(state);
      const result = prestige(state, () => {
        // A new run on the Wilds gets a new road.
        if (state.map === 'wilds') state.wildSeed = newWildSeed(state);
        startWave(state, events);
      });
      if (result.ok) events.push({ type: 'prestige', cores, wave: state.wave });
      return result;
    }
    case 'buyPermanent': {
      const result = buyPermanent(state, command.upgrade);
      refreshAll(state);
      return result;
    }
    case 'cast':
      return cast(state, command.ability, command, events);
    case 'setMap': {
      if (!MAP_IDS.includes(command.map)) return no('No such map');
      const { unlockWave } = MAPS[command.map];
      if (state.bestEver < unlockWave) return no(`Clear wave ${unlockWave} first`);
      state.nextMap = command.map;
      return OK;
    }
    case 'tap':
      return tap(state, command, events);
    case 'callWave':
      if (!canCallWave(state)) return no('The wave is still running');
      clearWave(state, events);
      return OK;
    case 'toggleWall':
      return toggleWall(state, command);
    case 'rally': {
      if (!heroOf(state)) return no('Place the Warden first');
      if (state.rallyTicks > 0 || state.rallyCooldown > 0) return no('Rally is not ready');
      state.rallyTicks = RALLY.seconds * TICKS_PER_SECOND;
      events.push({ type: 'rally' });
      return OK;
    }
    case 'setPause':
      state.paused = command.paused;
      return OK;
    case 'dropChallenge':
      if (!state.challenges.includes(command.challenge)) return no('That challenge is not on this run');
      state.challenges = state.challenges.filter((c) => c !== command.challenge);
      return OK;
    case 'setChallenge': {
      if (!CHALLENGE_KINDS.includes(command.challenge)) return no('No such challenge');
      const others = state.nextChallenges.filter((c) => c !== command.challenge);
      state.nextChallenges = command.on ? CHALLENGE_KINDS.filter((c) => c === command.challenge || others.includes(c)) : others;
      return OK;
    }
  }

  if (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= SLOT_COUNT) return no('No such slot');
  const tower = state.towers.find((t) => t.slot === command.slot);

  if (command.type === 'build') {
    if (!(TOWER_KINDS as readonly string[]).includes(command.tower)) return no('No such tower');
    if (tower) return no('Slot is taken');
    const result = build(state, command.slot, command.tower);
    // The player chose this slot, so the recorded layout no longer applies to it.
    if (result.ok) state.layout[command.slot] = null;
    return result;
  }
  if (command.type === 'placeHero') return placeHero(state, command.slot, tower);

  if (!tower) return no('Slot is empty');
  if (command.type === 'boost') {
    if (tower.boostTicks > 0 || tower.boostCooldown > 0) return no('Overdrive is not ready');
    tower.boostTicks = OVERDRIVE.seconds * TICKS_PER_SECOND;
    events.push({ type: 'boost', slot: tower.slot });
    return OK;
  }
  if (isHero(tower)) return no('The Warden levels up by itself and cannot be sold');
  switch (command.type) {
    case 'upgrade': {
      const count = levelsFor(command.amount, state.gold, tower.level);
      const cost = upgradeCost(tower.level, count);
      if (!pay(state, cost)) return no('Not enough gold');
      tower.level += count;
      tower.upgradesPaid = tower.upgradesPaid.add(cost);
      refreshDamage(state, tower);
      return OK;
    }
    case 'specialize':
      if (tower.level < SPEC_LEVEL) return no(`Needs level ${SPEC_LEVEL}`);
      if (tower.spec) return no('Already specialized');
      if (command.choice !== 'a' && command.choice !== 'b') return no('No such specialization');
      tower.spec = command.choice;
      refreshDamage(state, tower);
      return OK;
    case 'sell':
      state.gold = state.gold.add(sellValue(tower));
      state.towers = state.towers.filter((t) => t !== tower);
      state.layout[command.slot] = null;
      return OK;
    case 'merge':
      return merge(state, tower, command.from, events);
  }
}

/** Overdrive and Rally run down, then cool down. */
function tickBoosts(state: State): void {
  for (const t of state.towers) {
    if (t.boostTicks > 0) {
      if (--t.boostTicks === 0) t.boostCooldown = OVERDRIVE.cooldownSeconds * TICKS_PER_SECOND;
    } else if (t.boostCooldown > 0) t.boostCooldown--;
  }
  if (state.rallyTicks > 0) {
    if (--state.rallyTicks === 0) state.rallyCooldown = RALLY.cooldownSeconds * TICKS_PER_SECOND;
  } else if (state.rallyCooldown > 0) state.rallyCooldown--;
}

const newWildSeed = (state: State): number => Math.floor(createRng(state.seed, state.attempt, state.prestiges, state.tick)() * 2 ** 31);

/** Walls may change while the Maze's road is empty, or any time while the Maze is only planned. */
export function canEditWalls(state: State): boolean {
  if (state.map !== 'maze') return state.nextMap === 'maze';
  return state.enemies.length === 0 && (state.spawns.length === 0 || state.restartTicks > 0);
}

function toggleWall(state: State, at: { x: number; y: number }): CommandResult {
  if (!(at.x >= 0 && at.x < GRID_W && at.y >= 0 && at.y < GRID_H)) return no('Outside the field');
  if (!canEditWalls(state)) return no('Walls change only while the road is empty');
  const cell = cellOf(at.x, at.y);
  if (isOpenOnly(cell)) return no('That square must stay open');
  if (state.walls.includes(cell)) {
    state.walls = state.walls.filter((c) => c !== cell);
    return OK;
  }
  if (state.walls.length >= MAZE.maxWalls) return no(`At most ${MAZE.maxWalls} walls`);
  const walls = [...state.walls, cell].sort((a, b) => a - b);
  if (!mazeRoute(walls)) return no('Enemies need a way through');
  state.walls = walls;
  return OK;
}

function build(state: State, slot: number, kind: TowerKind): CommandResult {
  const cost = buildCost(builtTowers(state));
  if (!pay(state, cost)) return no('Not enough gold');
  const built = newTower(slot, kind, cost);
  state.towers.push(built);
  refreshDamage(state, built);
  return OK;
}

/** Places the Warden on an empty slot, or moves it there. Towers near its old and new slot change damage. */
function placeHero(state: State, slot: number, there: State['towers'][number] | undefined): CommandResult {
  if (state.bestEver < HERO.unlockWave) return no(`Clear wave ${HERO.unlockWave} first`);
  const hero = heroOf(state);
  if (there) return no(there === hero ? 'The Warden is already there' : 'Slot is taken');
  if (hero) {
    if (state.heroMoveTicks > 0) return no('The Warden is still on the move');
    hero.slot = slot;
    hero.locks = [];
    state.heroMoveTicks = HERO_MOVE_TICKS;
  } else {
    state.towers.push(newTower(slot, 'warden', new Decimal(0)));
  }
  refreshAll(state);
  return OK;
}

/** Merges `from` into `tower`: one tier up, the higher level, both towers' kills and prices. Frees `from`. */
function merge(state: State, tower: State['towers'][number], from: number, events: SimEvent[]): CommandResult {
  const other = state.towers.find((t) => t.slot === from);
  if (!other || other === tower) return no('Pick another tower to merge');
  if (isHero(other)) return no('The Warden cannot merge');
  if (other.kind !== tower.kind) return no('Only towers of the same kind merge');
  if (other.spec !== tower.spec) return no('Both need the same specialization');
  if (other.tier !== tower.tier) return no('Both need the same tier');
  if (tower.tier >= MERGE.maxTier) return no('Already at the highest tier');
  if (Math.min(tower.level, other.level) < MERGE.minLevel) return no(`Both need level ${MERGE.minLevel}`);
  tower.tier++;
  tower.level = Math.max(tower.level, other.level);
  tower.kills += other.kills;
  tower.buildPaid = tower.buildPaid.add(other.buildPaid);
  tower.upgradesPaid = tower.upgradesPaid.add(other.upgradesPaid);
  state.towers = state.towers.filter((t) => t !== other);
  state.layout[tower.slot] = null;
  state.layout[from] = null;
  refreshDamage(state, tower);
  events.push({ type: 'merge', slot: tower.slot, kind: tower.kind, tier: tower.tier });
  return OK;
}

/** Hits the enemy nearest the point, if one is close enough, for a slice of the formation's damage per second. */
function tap(state: State, at: { x: number; y: number }, events: SimEvent[]): CommandResult {
  if (state.tapTicks > 0) return no('Too fast');
  let target: Enemy | undefined;
  let bestSq = TAP.radius ** 2;
  for (const e of state.enemies) {
    const d = distSq(e, at);
    if (e.hp > 0 && d <= bestSq) {
      target = e;
      bestSq = d;
    }
  }
  if (!target) return no('Nothing to hit');
  state.tapTicks = TAP_TICKS;
  events.push({ type: 'tap', enemyId: target.id, x: target.x, y: target.y });
  const log10 = Math.max(log10FormationDps(state) + Math.log10(TAP.dpsSeconds), Math.log10(TAP.minDamage));
  damage(state, target, log10, 1, false, events);
  state.enemies = state.enemies.filter((e) => e.hp > 0);
  return OK;
}

function startWave(state: State, events: SimEvent[]): void {
  if (state.nextMap !== state.map) {
    if (state.nextMap === 'wilds') state.wildSeed = newWildSeed(state);
    state.map = state.nextMap;
    state.zones = [];
    // The Warden's reach depends on where slots are.
    refreshAll(state);
    events.push({ type: 'mapChange', map: state.map });
  }
  state.attempt++;
  state.waveTick = 0;
  state.lives = WAVE.lives;
  state.enemies = [];
  state.waveGold = new Decimal(0);
  state.spawns = buildSpawns(state.seed, state.wave, state.attempt);
  events.push({ type: 'waveStart', wave: state.wave });
}

function spawnDue(state: State): void {
  while (state.spawns[0] && state.spawns[0].tick <= state.waveTick) {
    state.enemies.push(createEnemy(state, state.spawns.shift()!.kind));
  }
}

function clearWave(state: State, events: SimEvent[]): void {
  events.push({ type: 'waveClear', wave: state.wave });
  recordWave(state, state.waveTick);
  state.clearedThisRun++;
  state.bestRun = Math.max(state.bestRun, state.wave);
  state.bestEver = Math.max(state.bestEver, state.bestRun);
  if (state.autoAdvance) state.wave++;
  startWave(state, events);
}

function loseWave(state: State, events: SimEvent[]): void {
  const nextWave = Math.max(1, state.wave - WAVE.lossWaves);
  events.push({ type: 'waveLost', wave: state.wave, nextWave });
  // The pause after a loss is part of what losing costs.
  recordWave(state, state.waveTick + 1 + RESTART_TICKS);
  state.wave = nextWave;
  state.lives = 0;
  state.enemies = [];
  state.spawns = [];
  state.zones = [];
  state.restartTicks = RESTART_TICKS;
}
