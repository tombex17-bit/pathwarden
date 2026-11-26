import Decimal from 'break_infinity.js';
import { GOLD, SPEC_LEVEL, TICKS_PER_SECOND, TOWERS, WAVE, type TowerKind } from '../config/balance';
import { SLOTS } from '../config/map';
import { applyZones, cast, tickCooldowns } from './abilities';
import { fireTowers } from './combat';
import { buildCost, levelsFor, pay, sellValue, upgradeCost } from './economy';
import { createEnemy, moveEnemies } from './enemies';
import { recordWave } from './idle';
import { autoCast, autoUpgrade, buyPermanent, coresFor, prestige } from './prestige';
import { log10Damage } from './stats';
import type { Command, CommandResult, SimEvent, State, StepResult, Tower } from './types';
import { buildSpawns } from './waves';

const MIN_WAVE_TICKS = WAVE.minSeconds * TICKS_PER_SECOND;
const RESTART_TICKS = WAVE.restartSeconds * TICKS_PER_SECOND;

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
    cores: new Decimal(0), prestiges: 0, clearedThisRun: 0, layout: SLOTS.map(() => null),
    owned: { autoUpgrade: false, autoCast: false }, options: { autoUpgrade: false, autoCast: false },
    holdForTower: false,
  };
  startWave(state, []);
  return state;
}

/** A brand-new game: like `createState`, but wave 1 waits for the first tower. */
export function createNewGame(seed: number): State {
  const state = createState(seed);
  state.holdForTower = true;
  return state;
}

/** Advances the game by exactly one step (1/30 game second), changing `state` in place. */
export function step(state: State, commands: readonly Command[] = []): StepResult {
  const events: SimEvent[] = [];
  const results = commands.map((c) => apply(state, c, events));
  state.tick++;
  tickCooldowns(state);
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
  if (state.waveTick >= MIN_WAVE_TICKS && state.spawns.length === 0 && state.enemies.length === 0) {
    clearWave(state, events);
  }
  return { events, results };
}

/** Recomputes a tower's damage; call after anything that affects it changes. */
export function refreshDamage(state: State, tower: Tower): void {
  tower.log10Damage = log10Damage(tower.kind, tower.spec, tower.level, state.power);
}

function apply(state: State, command: Command, events: SimEvent[]): CommandResult {
  switch (command.type) {
    case 'setOption':
      if (command.option === 'autoAdvance') state.autoAdvance = command.value;
      else if (command.option === 'autoUpgrade' || command.option === 'autoCast') {
        if (!state.owned[command.option]) return no('Not bought yet');
        state.options[command.option] = command.value;
      } else return no('No such option');
      return OK;
    case 'prestige': {
      const cores = coresFor(state.bestRun);
      const result = prestige(state, () => startWave(state, events));
      if (result.ok) events.push({ type: 'prestige', cores, wave: state.wave });
      return result;
    }
    case 'buyPermanent': {
      const result = buyPermanent(state, command.upgrade);
      for (const t of state.towers) refreshDamage(state, t);
      return result;
    }
  }
  if (command.type === 'cast') return cast(state, command.ability, command, events);
  if (!SLOTS[command.slot]) return no('No such slot');
  const tower = state.towers.find((t) => t.slot === command.slot);

  if (command.type === 'build') {
    if (!Object.hasOwn(TOWERS, command.tower)) return no('No such tower');
    if (tower) return no('Slot is taken');
    const result = build(state, command.slot, command.tower);
    // The player chose this slot, so the recorded layout no longer applies to it.
    if (result.ok) state.layout[command.slot] = null;
    return result;
  }

  if (!tower) return no('Slot is empty');
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
  }
}

function build(state: State, slot: number, kind: TowerKind): CommandResult {
  const cost = buildCost(state.towers.length);
  if (!pay(state, cost)) return no('Not enough gold');
  const built: Tower = {
    slot, kind, level: 1, spec: null, cooldown: 0, log10Damage: 0,
    locks: [], buildPaid: cost, upgradesPaid: new Decimal(0),
  };
  refreshDamage(state, built);
  state.towers.push(built);
  return OK;
}

function startWave(state: State, events: SimEvent[]): void {
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
