import Decimal from 'break_infinity.js';
import { ABILITY_KINDS, CHALLENGES, ENEMIES, HERO, IDLE, MERGE, OVERDRIVE, RALLY, TOWERS, WAVE, type AbilityKind, type EnemyKind, type TowerKind } from '../config/balance';
import { GRID_H, GRID_W, MAPS, MAZE, SLOT_COUNT, type MapId } from '../config/map';
import { createEnemy } from '../sim/enemies';
import { MAZE_CELLS, isOpenOnly, layoutOf, mazeRoute } from '../sim/path';
import { createState, refreshDamage } from '../sim/sim';
import type { Enemy, State, Tower } from '../sim/types';
import { DEFAULT_MUSIC_VOLUME, DEFAULT_VOLUME, GUIDE_DONE, SPEEDS, type Settings, type Speed } from './settings';

export const SAVE_VERSION = 7;
const EXPORT_PREFIX = 'TD1';
const MAX_ITEMS = 500;

export interface SaveData { state: State; settings: Settings; savedAt: number }
export type Decoded = { ok: true; data: SaveData } | { ok: false; reason: 'corrupt' | 'newer' };

type Raw = Record<string, unknown>;

// ---- Writing ----

const num = (d: Decimal): [number, number] => [d.mantissa, d.exponent];

/** Values that follow from others (damage, positions, maximum HP, gold per enemy) are left out. */
export function encode(state: State, settings: Settings, now: number): string {
  const { gold, waveGold, cores, history, towers, enemies, ...plain } = state;
  return JSON.stringify({
    v: SAVE_VERSION,
    savedAt: now,
    settings,
    state: {
      ...plain,
      gold: num(gold),
      waveGold: num(waveGold),
      cores: num(cores),
      history: history.map((h) => ({ gold: num(h.gold), ticks: h.ticks })),
      heroXp: num(state.heroXp),
      towers: towers.map(({ slot, kind, level, spec, cooldown, locks, buildPaid, upgradesPaid, tier, kills, boostTicks, boostCooldown }) => ({
        slot, kind, level, spec, cooldown, locks, buildPaid: num(buildPaid), upgradesPaid: num(upgradesPaid), tier, kills, boostTicks, boostCooldown,
      })),
      enemies: enemies.map(({ id, kind, dist, prevDist, hp, shield, slows, brittleUntil, stasisTick, marked }) => (
        { id, kind, dist, prevDist, hp, shield, slows, brittleUntil, stasisTick, marked }
      )),
    },
  });
}

// ---- Reading: every value is checked, so a bad save can never reach the game ----

class BadSave extends Error {}

function check(condition: boolean): asserts condition {
  if (!condition) throw new BadSave();
}

function obj(v: unknown): Raw {
  check(typeof v === 'object' && v !== null && !Array.isArray(v));
  return v as Raw;
}

function list<T>(v: unknown, read: (item: unknown) => T, max = MAX_ITEMS): T[] {
  check(Array.isArray(v) && v.length <= max);
  return (v as unknown[]).map(read);
}

function real(v: unknown, min: number, max: number): number {
  check(typeof v === 'number' && v >= min && v <= max);
  return v as number;
}

function int(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  check(Number.isSafeInteger(v));
  return real(v, min, max);
}

function bool(v: unknown): boolean {
  check(typeof v === 'boolean');
  return v as boolean;
}

function key<K extends string>(v: unknown, table: object): K {
  check(typeof v === 'string' && Object.hasOwn(table, v));
  return v as K;
}

function decimal(v: unknown): Decimal {
  check(Array.isArray(v) && v.length === 2);
  const [m, e] = v as unknown[];
  const mantissa = real(m, 0, 10);
  const exponent = int(e, -1000, 1e15);
  check(mantissa === 0 ? exponent === 0 : mantissa >= 1 && mantissa < 10);
  return Decimal.fromMantissaExponent_noNormalize(mantissa, exponent);
}

function unique(values: readonly (number | string)[]): void {
  check(new Set(values).size === values.length);
}

function readTower(v: unknown): Tower {
  const r = obj(v);
  const spec = r.spec;
  check(spec === null || spec === 'a' || spec === 'b');
  return {
    slot: int(r.slot, 0, SLOT_COUNT - 1),
    kind: key<TowerKind>(r.kind, TOWERS),
    level: int(r.level, 1),
    spec,
    cooldown: real(r.cooldown, -10, 1000),
    log10Damage: 0,
    locks: list(r.locks, (l) => ({ enemyId: int(obj(l).enemyId), sinceTick: int(obj(l).sinceTick) }), 10),
    buildPaid: decimal(r.buildPaid),
    upgradesPaid: decimal(r.upgradesPaid),
    tier: int(r.tier, 1, MERGE.maxTier),
    kills: int(r.kills),
    boostTicks: int(r.boostTicks, 0, OVERDRIVE.seconds * 30),
    boostCooldown: int(r.boostCooldown, 0, OVERDRIVE.cooldownSeconds * 30),
  };
}

function readEnemy(state: State, v: unknown): Enemy {
  const r = obj(v);
  const kind = key<EnemyKind>(r.kind, ENEMIES);
  const e = createEnemy(state, kind, real(r.dist, 0, layoutOf(state).length));
  e.id = int(r.id);
  e.prevDist = real(r.prevDist, 0, e.dist);
  e.hp = real(r.hp, Number.MIN_VALUE, 1);
  e.shield = real(r.shield, 0, ENEMIES[kind].shield ?? 0);
  e.slows = list(r.slows, (s) => ({ amount: real(obj(s).amount, 0, 1), untilTick: int(obj(s).untilTick) }), 10);
  e.brittleUntil = int(r.brittleUntil, -1);
  e.stasisTick = int(r.stasisTick, -1);
  e.marked = bool(r.marked);
  return e;
}

function readState(v: unknown): State {
  const r = obj(v);
  const s = createState(int(r.seed, -(2 ** 53), 2 ** 53), int(r.wave, 1));
  // The map comes first: enemy positions and the Warden's reach depend on it.
  s.map = key<MapId>(r.map, MAPS);
  s.nextMap = key<MapId>(r.nextMap, MAPS);
  s.wildSeed = int(r.wildSeed, 0, 2 ** 31);
  s.walls = list(r.walls, (c) => int(c, 0, MAZE_CELLS - 1), MAZE.maxWalls);
  check(s.walls.every((c, i) => !isOpenOnly(c) && (i === 0 || c > s.walls[i - 1]!)) && mazeRoute(s.walls) !== undefined);
  s.rallyTicks = int(r.rallyTicks, 0, RALLY.seconds * 30);
  s.rallyCooldown = int(r.rallyCooldown, 0, RALLY.cooldownSeconds * 30);
  for (const k of ['challenges', 'nextChallenges'] as const) {
    s[k] = list(r[k], (c) => key<keyof typeof CHALLENGES>(c, CHALLENGES), 3);
    unique(s[k]);
  }
  s.tick = int(r.tick);
  s.gold = decimal(r.gold);
  s.power = int(r.power);
  s.greed = int(r.greed);
  s.attempt = int(r.attempt);
  s.waveTick = int(r.waveTick);
  s.lives = int(r.lives, 0, WAVE.lives);
  s.restartTicks = int(r.restartTicks, 0, 1000);
  s.bestRun = int(r.bestRun);
  s.bestEver = int(r.bestEver, s.bestRun);
  s.autoAdvance = bool(r.autoAdvance);
  s.kills = int(r.kills);
  s.waveGold = decimal(r.waveGold);
  s.history = list(r.history, (h) => ({ gold: decimal(obj(h).gold), ticks: int(obj(h).ticks, 1) }), IDLE.waves);
  s.spawns = list(r.spawns, (p) => ({ tick: int(obj(p).tick), kind: key<EnemyKind>(obj(p).kind, ENEMIES) }));
  check(s.spawns.every((p, i) => i === 0 || p.tick >= s.spawns[i - 1]!.tick));
  s.towers = list(r.towers, readTower, SLOT_COUNT);
  unique(s.towers.map((t) => t.slot));
  const heroes = s.towers.filter((t) => t.kind === 'warden');
  check(heroes.length <= 1 && heroes.every((h) => h.spec === null && h.tier === 1));
  s.heroXp = decimal(r.heroXp);
  s.heroMoveTicks = int(r.heroMoveTicks, 0, HERO.moveSeconds * 30);
  s.tapTicks = int(r.tapTicks, 0, 30);
  for (const t of s.towers) refreshDamage(s, t);
  s.enemies = list(r.enemies, (e) => readEnemy(s, e));
  unique(s.enemies.map((e) => e.id));
  s.nextEnemyId = int(r.nextEnemyId, 1);
  check(s.enemies.every((e) => e.id < s.nextEnemyId));
  s.zones = list(r.zones, (z) => {
    const zone = obj(z);
    check(zone.kind === 'stasis' || zone.kind === 'bounty');
    return { kind: zone.kind, x: real(zone.x, 0, GRID_W), y: real(zone.y, 0, GRID_H), untilTick: int(zone.untilTick) };
  });
  s.cores = decimal(r.cores);
  s.prestiges = int(r.prestiges);
  s.clearedThisRun = int(r.clearedThisRun);
  s.holdForTower = bool(r.holdForTower);
  check(!s.holdForTower || (s.wave === 1 && s.towers.length === 0));
  s.layout = list(r.layout, (k) => (k === null ? null : key<TowerKind>(k, TOWERS)), SLOT_COUNT);
  check(s.layout.length === SLOT_COUNT && !s.layout.includes('warden'));
  check(s.bestEver >= MAPS[s.map].unlockWave && s.bestEver >= MAPS[s.nextMap].unlockWave);
  check(heroes.length === 0 || s.bestEver >= HERO.unlockWave);
  const owned = obj(r.owned);
  const options = obj(r.options);
  s.owned = { autoUpgrade: bool(owned.autoUpgrade), autoCast: bool(owned.autoCast) };
  s.options = { autoUpgrade: bool(options.autoUpgrade), autoCast: bool(options.autoCast) };
  const cooldowns = obj(r.cooldowns);
  s.cooldowns = Object.fromEntries(ABILITY_KINDS.map((a) => [a, int(cooldowns[a], 0, 200_000)])) as Record<AbilityKind, number>;
  return s;
}

function readSettings(v: unknown): Settings {
  const { speed, volume, muted, guide, musicVolume, musicMuted } = obj(v);
  check(SPEEDS.includes(speed as Speed));
  return {
    speed: speed as Speed, volume: real(volume, 0, 1), muted: bool(muted), guide: int(guide, 0, GUIDE_DONE),
    musicVolume: real(musicVolume, 0, 1), musicMuted: bool(musicMuted),
  };
}

/** Each entry turns a save of that version into the next version. */
const MIGRATIONS: Record<number, (save: Raw) => Raw> = {
  // Version 0 was never released: it had no settings and no idle-rate history.
  0: (save) => ({
    ...save, v: 1, settings: { speed: 1 }, state: { ...obj(save.state), history: [], waveGold: [0, 0] },
  }),
  // Version 2 added prestige. Waves cleared so far count as this run's.
  1: (save) => {
    const state = obj(save.state);
    return {
      ...save,
      v: 2,
      state: {
        ...state,
        cores: [0, 0],
        prestiges: 0,
        clearedThisRun: state.bestRun,
        layout: Array<null>(SLOT_COUNT).fill(null),
        owned: { autoUpgrade: false, autoCast: false },
        options: { autoUpgrade: false, autoCast: false },
      },
    };
  },
  // Version 3 added sound settings.
  2: (save) => ({ ...save, v: 3, settings: { ...obj(save.settings), volume: DEFAULT_VOLUME, muted: false } }),
  // Version 4 added the first-wave hold and the guide. Games that already exist need neither.
  3: (save) => ({
    ...save, v: 4, settings: { ...obj(save.settings), guide: GUIDE_DONE }, state: { ...obj(save.state), holdForTower: false },
  }),
  // Version 5 added maps, the Warden, taps, tiers and ranks. Old games are on the first map, and kills start at 0.
  4: (save) => {
    const state = obj(save.state);
    return {
      ...save,
      v: 5,
      state: {
        ...state,
        map: 'switchback', nextMap: 'switchback', heroXp: [0, 0], heroMoveTicks: 0, tapTicks: 0,
        towers: Array.isArray(state.towers) ? state.towers.map((t) => ({ ...obj(t), tier: 1, kills: 0 })) : state.towers,
      },
    };
  },
  // Version 7 added music, on at the default volume.
  6: (save) => ({ ...save, v: 7, settings: { ...obj(save.settings), musicVolume: DEFAULT_MUSIC_VOLUME, musicMuted: false } }),
  // Version 6 added the Wilds and the Maze, Overdrive, Rally and challenges.
  5: (save) => {
    const state = obj(save.state);
    return {
      ...save,
      v: 6,
      state: {
        ...state,
        wildSeed: 0, walls: [], rallyTicks: 0, rallyCooldown: 0, challenges: [], nextChallenges: [],
        towers: Array.isArray(state.towers) ? state.towers.map((t) => ({ ...obj(t), boostTicks: 0, boostCooldown: 0 })) : state.towers,
      },
    };
  },
};

export function decode(text: string): Decoded {
  try {
    let save = obj(JSON.parse(text));
    if (int(save.v) > SAVE_VERSION) return { ok: false, reason: 'newer' };
    while (save.v !== SAVE_VERSION) {
      const migrate = MIGRATIONS[save.v as number];
      check(migrate !== undefined);
      save = migrate(save);
    }
    return {
      ok: true,
      data: { state: readState(save.state), settings: readSettings(save.settings), savedAt: int(save.savedAt) },
    };
  } catch (e) {
    if (e instanceof BadSave || e instanceof SyntaxError) return { ok: false, reason: 'corrupt' };
    throw e;
  }
}

// ---- Export and import ----

function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function exportText(json: string): string {
  const body = btoa(json);
  return `${EXPORT_PREFIX}.${body}.${checksum(body)}`;
}

/** Reads exported text; line breaks and spaces added by messaging apps are ignored. */
export function importText(text: string): Decoded {
  const [prefix, body, sum, ...rest] = text.replace(/\s+/g, '').split('.');
  if (prefix !== EXPORT_PREFIX || !body || rest.length > 0 || sum !== checksum(body)) return { ok: false, reason: 'corrupt' };
  let json: string;
  try {
    json = atob(body);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  return decode(json);
}
