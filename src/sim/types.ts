import type Decimal from 'break_infinity.js';
import type { AbilityKind, BuyAmount, EnemyKind, PermanentKind, SpecChoice, TowerKind } from '../config/balance';
import type { Point } from '../config/map';

export interface Slow { amount: number; untilTick: number }

export interface Enemy {
  id: number;
  kind: EnemyKind;
  /** Distance along the path now and one step ago (for drawing between steps). */
  dist: number;
  prevDist: number;
  /** Position at `dist`. */
  x: number;
  y: number;
  /** Remaining HP as a fraction of maximum, 0 to 1. */
  hp: number;
  /** Remaining shield as a fraction of maximum HP. */
  shield: number;
  log10MaxHp: number;
  gold: Decimal;
  slows: Slow[];
  brittleUntil: number;
  /** The last step spent inside a Stasis zone. */
  stasisTick: number;
  /** Pays the bounty when killed. */
  marked: boolean;
}

/** An enemy a ramping tower is holding, and since when. */
export interface RampLock { enemyId: number; sinceTick: number }

export interface Tower {
  slot: number;
  kind: TowerKind;
  level: number;
  spec: SpecChoice | null;
  /** Steps until the next hit. */
  cooldown: number;
  log10Damage: number;
  locks: RampLock[];
  buildPaid: Decimal;
  upgradesPaid: Decimal;
}

export interface Zone { kind: 'stasis' | 'bounty'; x: number; y: number; untilTick: number }

/** Base gold and length of a finished wave. */
export interface WaveRecord { gold: Decimal; ticks: number }

export interface PendingSpawn { tick: number; kind: EnemyKind }

export interface State {
  seed: number;
  tick: number;
  gold: Decimal;
  /** Permanent upgrade levels P and G. */
  power: number;
  greed: number;
  wave: number;
  attempt: number;
  waveTick: number;
  lives: number;
  /** Steps left before the next wave after a loss; 0 while a wave is running. */
  restartTicks: number;
  bestRun: number;
  bestEver: number;
  autoAdvance: boolean;
  nextEnemyId: number;
  spawns: PendingSpawn[];
  enemies: Enemy[];
  towers: Tower[];
  kills: number;
  /** Steps until each ability is ready. */
  cooldowns: Record<AbilityKind, number>;
  zones: Zone[];
  /** Gold from kills in this wave, without bounties. */
  waveGold: Decimal;
  /** The last finished waves, oldest first. */
  history: WaveRecord[];
  cores: Decimal;
  /** Completed prestiges. */
  prestiges: number;
  /** Waves cleared since the run started. */
  clearedThisRun: number;
  /** Tower kind per slot, recorded at the last prestige; null where nothing is rebuilt. */
  layout: (TowerKind | null)[];
  owned: { autoUpgrade: boolean; autoCast: boolean };
  /** Switches for purchased automation. */
  options: { autoUpgrade: boolean; autoCast: boolean };
}

export type OptionName = 'autoAdvance' | 'autoUpgrade' | 'autoCast';

export type Command =
  | { type: 'build'; slot: number; tower: TowerKind }
  | { type: 'upgrade'; slot: number; amount: BuyAmount }
  | { type: 'specialize'; slot: number; choice: SpecChoice }
  | { type: 'sell'; slot: number }
  | { type: 'cast'; ability: AbilityKind; x: number; y: number }
  | { type: 'prestige' }
  | { type: 'buyPermanent'; upgrade: PermanentKind }
  | { type: 'setOption'; option: OptionName; value: boolean };

export type CommandResult = { ok: true } | { ok: false; reason: string };

export type SimEvent =
  /** One attack, for drawing: the tower, then every enemy it reached in order. */
  | { type: 'shot'; slot: number; kind: TowerKind; points: Point[]; splash: number }
  | { type: 'hit'; slot: number; kind: TowerKind; enemyId: number }
  | { type: 'cast'; ability: AbilityKind; x: number; y: number }
  | { type: 'death'; enemyId: number; kind: EnemyKind; x: number; y: number; gold: Decimal }
  | { type: 'leak'; enemyId: number; kind: EnemyKind }
  | { type: 'waveStart'; wave: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'waveLost'; wave: number; nextWave: number }
  | { type: 'prestige'; cores: Decimal; wave: number };

export interface StepResult { events: SimEvent[]; results: CommandResult[] }
