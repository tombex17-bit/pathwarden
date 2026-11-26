export const TICKS_PER_SECOND = 30;

export const WAVE = {
  spawnSeconds: 10,
  minSeconds: 24,
  lives: 10,
  lossWaves: 5,
  restartSeconds: 2,
  baseSlots: 12,
  extraSlotsMax: 12,
  wavesPerExtraSlot: 10,
  bossEvery: 10,
  bossSeconds: 5,
  /** Boss gold as a share of the wave's slot count. */
  bossGoldPerSlot: 0.5,
} as const;

export const HP = { base: 14, growth: 1.09 } as const;
export const GOLD = { base: 2, growth: 1.065, start: 60 } as const;

export const BUILD_COST = { base: 50, growth: 1.6 } as const;
export const UPGRADE_COST = { base: 20, growth: 1.09 } as const;
export const REFUND = { build: 1, upgrades: 0.7 } as const;
export const BUY_AMOUNTS = [1, 10, 25, 'max'] as const;
export type BuyAmount = (typeof BUY_AMOUNTS)[number];

export const DAMAGE = { milestoneLevels: 25, milestoneMult: 2, powerMult: 1.4 } as const;
export const GREED_MULT = 1.3;
export const SPEC_LEVEL = 25;

export const SLOW_CAP = 0.6;
export const SLOW_SECONDS = 2;
export const BRITTLE = { mult: 1.2, seconds: 2 } as const;
export const BEAM_RAMP_PER_SECOND = 0.2;
export const CHAIN = { range: 1.5, falloff: 0.7 } as const;

export const IDLE = { waves: 20, offlineShare: 0.5, capSeconds: 8 * 3600, summarySeconds: 60 } as const;

export const PRESTIGE = {
  minWave: 100,
  minCleared: 10,
  coreBase: 10,
  coreGrowth: 1.06,
  headStartShare: 0.5,
  /** A new run's gold, in waves' worth of base gold: 20 x N(s) x baseGold(s). */
  startGoldWaves: 20,
  autoCastCooldownMult: 2,
} as const;

export const PERMANENT = {
  power: { name: 'Power', text: 'x1.4 tower damage', cost: 5, growth: 1.5, once: false },
  greed: { name: 'Greed', text: 'x1.3 gold', cost: 5, growth: 1.5, once: false },
  autoUpgrade: { name: 'Auto-upgrade', text: 'Rebuilds your layout and buys levels', cost: 5, growth: 1, once: true },
  autoCast: { name: 'Auto-cast', text: 'Casts Meteor, Stasis and Smite at half speed', cost: 10, growth: 1, once: true },
} as const;
export type PermanentKind = keyof typeof PERMANENT;
export const PERMANENT_KINDS = Object.keys(PERMANENT) as PermanentKind[];

export const BOUNTY_MULT = 2.25;

/** Radii in cells. `dpsSeconds` is damage as seconds of the whole formation's DPS. */
export const ABILITIES = {
  meteor: { name: 'Meteor', text: 'Damages an area', unlockWave: 0, cooldownSeconds: 40, radius: 1.8, dpsSeconds: 1 },
  stasis: { name: 'Stasis', text: 'Slows an area 70%', unlockWave: 10, cooldownSeconds: 60, radius: 2, seconds: 5, slow: 0.7 },
  bounty: { name: 'Bounty Mark', text: 'Marked enemies pay more', unlockWave: 20, cooldownSeconds: 20, radius: 1.2, seconds: 8 },
  smite: { name: 'Smite', text: 'Strikes one enemy', unlockWave: 35, cooldownSeconds: 45, radius: 1, dpsSeconds: 3, killBelow: 0.3 },
} as const;
export type AbilityKind = keyof typeof ABILITIES;
export const ABILITY_KINDS = Object.keys(ABILITIES) as AbilityKind[];
export const AUTO_CAST_ABILITIES: readonly AbilityKind[] = ['meteor', 'stasis', 'smite'];

export type EnemyKind = 'grunt' | 'runner' | 'brute' | 'swarm' | 'shielded' | 'regenerator' | 'boss';

export interface EnemyDef {
  readonly firstWave: number;
  /** Chance relative to other types; 0 means it is never picked for a normal slot. */
  readonly weight: number;
  readonly hpMult: number;
  /** For the boss this is multiplied by the wave's slot count. */
  readonly goldMult: number;
  /** Cells per game second. */
  readonly speed: number;
  readonly leakLives: number;
  readonly perSlot?: number;
  /** Seconds between units of one slot. */
  readonly unitGap?: number;
  /** Shield as a share of maximum HP. */
  readonly shield?: number;
  /** Share of maximum HP healed per second. */
  readonly regen?: number;
  /** Multiplies every slow. */
  readonly slowTaken?: number;
}

export const ENEMIES: Readonly<Record<EnemyKind, EnemyDef>> = {
  grunt: { firstWave: 1, weight: 6, hpMult: 1, goldMult: 1, speed: 2, leakLives: 1 },
  runner: { firstWave: 4, weight: 3, hpMult: 0.6, goldMult: 0.6, speed: 3.2, leakLives: 1 },
  brute: { firstWave: 8, weight: 2, hpMult: 2, goldMult: 2, speed: 1.3, leakLives: 1 },
  swarm: { firstWave: 12, weight: 2, hpMult: 0.3, goldMult: 0.3, speed: 2.2, leakLives: 1, perSlot: 3, unitGap: 0.2 },
  shielded: { firstWave: 18, weight: 2, hpMult: 1, goldMult: 1.3, speed: 1.8, leakLives: 1, shield: 0.35 },
  regenerator: { firstWave: 25, weight: 2, hpMult: 0.8, goldMult: 1, speed: 1.8, leakLives: 1, regen: 0.02 },
  boss: { firstWave: 10, weight: 0, hpMult: 10, goldMult: WAVE.bossGoldPerSlot, speed: 1.3, leakLives: 10, slowTaken: 0.5 },
};

export type TowerKind = 'bolt' | 'cannon' | 'frost' | 'beam' | 'tesla';
export type SpecChoice = 'a' | 'b';

export interface TowerStats {
  readonly damage: number;
  readonly hitsPerSecond: number;
  /** Cells. */
  readonly range: number;
  readonly targets: number;
  readonly targeting: 'farthest' | 'highestHp';
  /** Radius in cells; 0 means no splash. */
  readonly splash: number;
  readonly slow: number;
  readonly brittle: boolean;
  /** Highest extra damage from staying on one target; 0 means no ramp. */
  readonly rampCap: number;
  /** Extra enemies hit by a chain. */
  readonly jumps: number;
  readonly ignoresShield: boolean;
}

export interface SpecDef {
  readonly name: string;
  readonly text: string;
  readonly change: Partial<TowerStats>;
}

export interface TowerDef {
  readonly name: string;
  readonly text: string;
  readonly stats: TowerStats;
  readonly specs: Readonly<Record<SpecChoice, SpecDef>>;
}

const NO_TRAITS = {
  targets: 1, targeting: 'farthest', splash: 0, slow: 0, brittle: false, rampCap: 0, jumps: 0, ignoresShield: false,
} as const;

export const TOWERS: Readonly<Record<TowerKind, TowerDef>> = {
  bolt: {
    name: 'Bolt', text: 'Fast single shots',
    stats: { ...NO_TRAITS, damage: 4, hitsPerSecond: 2, range: 2.8 },
    specs: {
      a: { name: 'Rapid', text: '+60% hits per second', change: { hitsPerSecond: 2 * 1.6 } },
      b: {
        name: 'Sniper', text: '+60% range, +25% damage, targets highest HP',
        change: { range: 2.8 * 1.6, damage: 4 * 1.25, targeting: 'highestHp' },
      },
    },
  },
  cannon: {
    name: 'Cannon', text: 'Slow shots that hit an area',
    stats: { ...NO_TRAITS, damage: 9, hitsPerSecond: 0.5, range: 2.6, splash: 0.9 },
    specs: {
      a: { name: 'Wide', text: 'Area radius x1.6', change: { splash: 0.9 * 1.6 } },
      b: { name: 'Heavy', text: 'Damage x1.6', change: { damage: 9 * 1.6 } },
    },
  },
  frost: {
    name: 'Frost', text: 'Hits an area and slows 25%',
    stats: { ...NO_TRAITS, damage: 3, hitsPerSecond: 1, range: 2.4, splash: 1, slow: 0.25 },
    specs: {
      a: { name: 'Deep chill', text: 'Slows 45%', change: { slow: 0.45 } },
      b: { name: 'Brittle', text: 'Hit enemies take +20% damage for 2 s', change: { brittle: true } },
    },
  },
  beam: {
    name: 'Beam', text: 'Ramps up on one target, ignores shields',
    stats: { ...NO_TRAITS, damage: 0.8, hitsPerSecond: 10, range: 2.6, rampCap: 1, ignoresShield: true },
    specs: {
      a: { name: 'Focus', text: 'Ramps up to +200%', change: { rampCap: 2 } },
      b: { name: 'Split', text: 'Hits 2 targets', change: { targets: 2 } },
    },
  },
  tesla: {
    name: 'Tesla', text: 'Chains to 2 more enemies',
    stats: { ...NO_TRAITS, damage: 5, hitsPerSecond: 0.8, range: 2.5, jumps: 2 },
    specs: {
      a: { name: 'Long chain', text: 'Chains to 5 more enemies', change: { jumps: 5 } },
      b: { name: 'Surge', text: 'Damage x1.5', change: { damage: 5 * 1.5 } },
    },
  },
};

export const TOWER_KINDS = Object.keys(TOWERS) as TowerKind[];
