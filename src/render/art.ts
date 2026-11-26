import type { EnemyKind, TowerKind } from '../config/balance';
import { GRID_H, GRID_W, PATH_WIDTH, SLOT_RADIUS, type MapId, type Point } from '../config/map';
import { distanceToPath, type Layout } from '../sim/path';
import { createRng } from '../sim/rng';
import { COLORS, SHADES } from './palette';
import { ENEMY_RADIUS, traceEnemy } from './shapes';

// The game's drawn art (SPEC section 22): scenery, the road, towers and enemies. Everything is in grid units.

type Ctx = CanvasRenderingContext2D;

const DARK: Readonly<Record<TowerKind, string>> = {
  bolt: SHADES.boltDark, cannon: SHADES.cannonDark, frost: SHADES.frostDark,
  beam: SHADES.beamDark, tesla: SHADES.teslaDark, warden: SHADES.wardenDark,
};

// ---- Scenery ----

type Theme = 'meadow' | 'ruins' | 'canyon' | 'forest' | 'plaza';
type Prop = 'tree' | 'bush' | 'rock' | 'tuft' | 'pillar' | 'block' | 'crystal' | 'crack';

const THEMES: Readonly<Record<MapId, Theme>> = {
  switchback: 'meadow', crossroads: 'ruins', shortcut: 'canyon', wilds: 'forest', maze: 'plaza',
};

/** What grows on each kind of ground, how often, and how many tries to place it. */
const PROPS: Readonly<Record<Theme, { props: readonly Prop[]; count: number }>> = {
  meadow: { props: ['tree', 'bush', 'bush', 'rock', 'tuft', 'tuft', 'tuft'], count: 46 },
  ruins: { props: ['pillar', 'block', 'block', 'rock', 'tuft', 'bush'], count: 36 },
  canyon: { props: ['rock', 'rock', 'crystal', 'crack', 'crack', 'tuft'], count: 40 },
  forest: { props: ['tree', 'tree', 'tree', 'bush', 'tuft'], count: 60 },
  plaza: { props: [], count: 0 },
};

const GROUND: Readonly<Record<Theme, readonly [string, string]>> = {
  meadow: [SHADES.meadow, SHADES.meadowLight],
  ruins: [SHADES.ruins, SHADES.ruinsLight],
  canyon: [SHADES.canyon, SHADES.canyonLight],
  forest: [SHADES.forest, SHADES.forestLight],
  plaza: [COLORS.background, COLORS.panel],
};

const SIZE: Readonly<Record<Prop, number>> = {
  tree: 0.42, bush: 0.24, rock: 0.22, tuft: 0.1, pillar: 0.2, block: 0.24, crystal: 0.2, crack: 0.25,
};

interface Placed { prop: Prop; at: Point; size: number; seed: number }

/** Spots for scenery: clear of the road, the slots and each other. The same map and seed give the same spots. */
export function placeScenery(map: MapId, layout: Layout, seed: number): Placed[] {
  const { props, count } = PROPS[THEMES[map]];
  const rng = createRng(seed, map.length, map.charCodeAt(0));
  const placed: Placed[] = [];
  for (let i = 0; i < count * 4 && placed.length < count; i++) {
    const prop = props[Math.floor(rng() * props.length)]!;
    const size = SIZE[prop] * (0.8 + rng() * 0.4);
    const at = { x: 0.3 + rng() * (GRID_W - 0.6), y: 0.3 + rng() * (GRID_H - 0.6) };
    const clear = distanceToPath(layout.path, at) > PATH_WIDTH / 2 + size + 0.08
      && layout.slots.every((s) => Math.hypot(s.x - at.x, s.y - at.y) > SLOT_RADIUS + size + 0.12)
      && placed.every((p) => Math.hypot(p.at.x - at.x, p.at.y - at.y) > p.size + size);
    if (clear) placed.push({ prop, at, size, seed: Math.floor(rng() * 1e6) });
  }
  // Farther back first, so nearer scenery overlaps it.
  return placed.sort((a, b) => a.at.y - b.at.y);
}

function circle(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function polygon(ctx: Ctx, points: readonly Point[], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();
}

/** An uneven stone outline around a point. */
function stoneOutline(at: Point, r: number, seed: number): Point[] {
  const rng = createRng(seed);
  const sides = 6 + Math.floor(rng() * 3);
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    const k = r * (0.75 + rng() * 0.3);
    return { x: at.x + Math.cos(a) * k, y: at.y + Math.sin(a) * k * 0.8 };
  });
}

function drawProp(ctx: Ctx, { prop, at, size: r, seed }: Placed, px: number): void {
  const { x, y } = at;
  switch (prop) {
    case 'tree':
      ctx.fillStyle = SHADES.bark;
      ctx.fillRect(x - r * 0.12, y, r * 0.24, r * 0.6);
      circle(ctx, x - r * 0.35, y - r * 0.05, r * 0.5, SHADES.leaf);
      circle(ctx, x + r * 0.35, y - r * 0.05, r * 0.5, SHADES.leaf);
      circle(ctx, x, y - r * 0.4, r * 0.6, SHADES.leaf);
      circle(ctx, x - r * 0.2, y - r * 0.55, r * 0.28, SHADES.leafLight);
      return;
    case 'bush':
      circle(ctx, x - r * 0.4, y, r * 0.55, SHADES.leaf);
      circle(ctx, x + r * 0.4, y, r * 0.55, SHADES.leaf);
      circle(ctx, x, y - r * 0.25, r * 0.6, SHADES.leaf);
      circle(ctx, x - r * 0.15, y - r * 0.4, r * 0.25, SHADES.leafLight);
      return;
    case 'rock': {
      const outline = stoneOutline(at, r, seed);
      polygon(ctx, outline, SHADES.stone);
      polygon(ctx, [outline[0]!, ...outline.slice(Math.ceil(outline.length / 2)), at].map((p) => ({ x: p.x, y: p.y - r * 0.08 })), SHADES.stoneLight);
      return;
    }
    case 'tuft':
      ctx.strokeStyle = SHADES.leafLight;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      for (const dx of [-0.6, 0, 0.6]) {
        ctx.moveTo(x + dx * r, y + r * 0.5);
        ctx.lineTo(x + dx * r * 1.6, y - r * 0.6);
      }
      ctx.stroke();
      return;
    case 'pillar':
      ctx.fillStyle = SHADES.stone;
      ctx.fillRect(x - r * 0.5, y - r * 1.2, r, r * 1.7);
      ctx.fillStyle = SHADES.stoneLight;
      ctx.fillRect(x - r * 0.65, y - r * 1.3, r * 1.3, r * 0.3);
      ctx.fillRect(x - r * 0.65, y + r * 0.45, r * 1.3, r * 0.25);
      return;
    case 'block':
      ctx.fillStyle = SHADES.stone;
      ctx.fillRect(x - r, y - r * 0.6, r * 2, r * 1.2);
      ctx.fillStyle = SHADES.stoneLight;
      ctx.fillRect(x - r, y - r * 0.6, r * 2, r * 0.35);
      return;
    case 'crystal':
      polygon(ctx, [{ x, y: y - r * 1.3 }, { x: x + r * 0.5, y }, { x, y: y + r * 0.4 }, { x: x - r * 0.5, y }], SHADES.crystal);
      polygon(ctx, [{ x, y: y - r * 1.3 }, { x: x + r * 0.5, y }, { x, y: y - r * 0.1 }], COLORS.frost);
      return;
    case 'crack': {
      const rng = createRng(seed);
      ctx.strokeStyle = SHADES.roadEdge;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      for (let i = 1; i <= 4; i++) ctx.lineTo(x - r + (i * r) / 2, y + (rng() - 0.5) * r * 0.8);
      ctx.stroke();
    }
  }
}

/** The ground, scenery, road, gate and keep: everything that only changes with the map. */
export function paintScenery(ctx: Ctx, map: MapId, layout: Layout, seed: number, px: number): void {
  const theme = THEMES[map];
  // Each kind of ground has its own tint, in a faint checkerboard; the plaza's is stronger, like paving.
  const [base, light] = GROUND[theme];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, GRID_W, GRID_H);
  ctx.fillStyle = light;
  for (let x = 0; x < GRID_W; x++) {
    for (let y = 0; y < GRID_H; y++) if ((x + y) % 2 === 0) ctx.fillRect(x, y, 1, 1);
  }
  for (const p of placeScenery(map, layout, seed)) drawProp(ctx, p, px);
  paintRoad(ctx, layout, px);
}

function paintRoad(ctx: Ctx, layout: Layout, px: number): void {
  const trace = (): void => {
    ctx.beginPath();
    for (const p of layout.path) ctx.lineTo(p.x, p.y);
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = SHADES.roadEdge;
  ctx.lineWidth = PATH_WIDTH + 0.18;
  trace();
  ctx.stroke();
  ctx.strokeStyle = COLORS.path;
  ctx.lineWidth = PATH_WIDTH;
  trace();
  ctx.stroke();
  // Dashes down the middle show which way enemies walk.
  ctx.strokeStyle = SHADES.roadLine;
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([0.2, 0.3]);
  trace();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineJoin = 'miter';

  const [a, b] = [layout.path[0]!, layout.path[1]!];
  const along = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
  const side = { x: -along.y, y: along.x };
  // The gate: a pillar either side of the entrance.
  for (const s of [-1, 1]) {
    const c = { x: a.x + along.x * 0.35 + side.x * s * 0.55, y: a.y + along.y * 0.35 + side.y * s * 0.55 };
    ctx.fillStyle = SHADES.stone;
    ctx.fillRect(c.x - 0.12, c.y - 0.12, 0.24, 0.24);
    ctx.fillStyle = SHADES.stoneLight;
    ctx.fillRect(c.x - 0.15, c.y - 0.16, 0.3, 0.08);
  }
  // The keep the enemies are after, at the exit.
  const end = layout.path[layout.path.length - 1]!;
  const kx = end.x - 0.55;
  const ky = end.y;
  ctx.fillStyle = SHADES.stone;
  ctx.fillRect(kx - 0.35, ky - 0.75, 0.7, 1.1);
  ctx.fillStyle = SHADES.stoneLight;
  for (let i = 0; i < 3; i++) ctx.fillRect(kx - 0.35 + i * 0.27, ky - 0.9, 0.16, 0.18);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(kx - 0.12, ky - 0.05, 0.24, 0.4);
  ctx.strokeStyle = COLORS.muted;
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  ctx.moveTo(kx, ky - 0.9);
  ctx.lineTo(kx, ky - 1.3);
  ctx.stroke();
  polygon(ctx, [{ x: kx, y: ky - 1.3 }, { x: kx + 0.3, y: ky - 1.2 }, { x: kx, y: ky - 1.1 }], COLORS.gold);
}

// ---- Towers ----

/** A tower's body, turned toward `angle` (radians, 0 = right) where it has a turret. */
export function drawTower(ctx: Ctx, kind: TowerKind, at: Point, angle: number): void {
  const main = COLORS[kind];
  const dark = DARK[kind];
  ctx.save();
  ctx.translate(at.x, at.y);
  switch (kind) {
    case 'bolt':
      circle(ctx, 0, 0, 0.22, dark);
      ctx.rotate(angle);
      ctx.strokeStyle = dark;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(0.02, 0, 0.27, -1, 1);
      ctx.stroke();
      ctx.fillStyle = main;
      ctx.fillRect(0, -0.035, 0.34, 0.07);
      polygon(ctx, [{ x: 0.2, y: 0 }, { x: 0, y: 0.14 }, { x: -0.2, y: 0 }, { x: 0, y: -0.14 }], main);
      circle(ctx, -0.03, -0.03, 0.04, COLORS.text);
      break;
    case 'cannon':
      ctx.fillStyle = main;
      ctx.fillRect(-0.22, -0.22, 0.44, 0.44);
      ctx.fillStyle = dark;
      ctx.fillRect(-0.15, -0.15, 0.3, 0.3);
      ctx.rotate(angle);
      ctx.fillStyle = dark;
      ctx.fillRect(0, -0.08, 0.34, 0.16);
      ctx.fillStyle = main;
      ctx.fillRect(0.28, -0.1, 0.08, 0.2);
      circle(ctx, 0, 0, 0.11, main);
      break;
    case 'frost': {
      const star = (r: number, color: string): void => {
        polygon(ctx, [0, 1, 2].map((i) => ({ x: r * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 3), y: r * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 3) })), color);
        polygon(ctx, [0, 1, 2].map((i) => ({ x: r * Math.cos(Math.PI / 2 + (i * 2 * Math.PI) / 3), y: r * Math.sin(Math.PI / 2 + (i * 2 * Math.PI) / 3) })), color);
      };
      star(0.3, main);
      star(0.16, dark);
      circle(ctx, 0, 0, 0.06, COLORS.text);
      break;
    }
    case 'beam':
      circle(ctx, 0, 0, 0.27, main);
      circle(ctx, 0, 0, 0.17, dark);
      ctx.rotate(angle);
      circle(ctx, 0.1, 0, 0.08, COLORS.text);
      break;
    case 'tesla':
      circle(ctx, 0, 0, 0.27, dark);
      circle(ctx, 0, 0, 0.2, main);
      polygon(ctx, [[0.04, -0.2], [-0.13, 0.04], [-0.02, 0.04], [-0.04, 0.2], [0.13, -0.04], [0.02, -0.04]].map(([x, y]) => ({ x: x!, y: y! })), COLORS.text);
      for (let i = 0; i < 3; i++) {
        const a = angle + (i * 2 * Math.PI) / 3;
        circle(ctx, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.045, main);
      }
      break;
    case 'warden':
      polygon(ctx, [{ x: -0.25, y: -0.26 }, { x: 0.25, y: -0.26 }, { x: 0.25, y: 0.06 }, { x: 0, y: 0.31 }, { x: -0.25, y: 0.06 }], dark);
      polygon(ctx, [{ x: -0.19, y: -0.2 }, { x: 0.19, y: -0.2 }, { x: 0.19, y: 0.04 }, { x: 0, y: 0.23 }, { x: -0.19, y: 0.04 }], main);
      polygon(ctx, [{ x: -0.12, y: -0.08 }, { x: 0, y: 0.04 }, { x: 0.12, y: -0.08 }, { x: 0.12, y: 0.02 }, { x: 0, y: 0.14 }, { x: -0.12, y: 0.02 }], COLORS.gold);
      break;
  }
  ctx.restore();
}

// ---- Enemies ----

/** An enemy: a darker underside, the body, a highlight, and eyes looking where it walks. */
export function drawEnemy(ctx: Ctx, kind: EnemyKind, at: Point, facing: Point, flash: boolean): void {
  const r = ENEMY_RADIUS[kind];
  const boss = kind === 'boss';
  traceEnemy(ctx, kind, { x: at.x, y: at.y + r * 0.18 });
  ctx.fillStyle = boss ? SHADES.bossDark : SHADES.enemyDark;
  ctx.fill();
  traceEnemy(ctx, kind, at);
  ctx.fillStyle = flash ? COLORS.text : boss ? COLORS.boss : COLORS.enemy;
  ctx.fill();
  if (flash) return;
  circle(ctx, at.x - r * 0.35, at.y - r * 0.38, r * 0.22, SHADES.enemyLight);
  if (boss) {
    // A crown.
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.moveTo(at.x - r * 0.5, at.y - r * 0.85);
    for (const [dx, dy] of [[-0.5, -1.35], [-0.25, -1.0], [0, -1.45], [0.25, -1.0], [0.5, -1.35], [0.5, -0.85]] as const) {
      ctx.lineTo(at.x + dx * r, at.y + dy * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (r < 0.2) return;
  const side = { x: -facing.y, y: facing.x };
  for (const s of [-1, 1]) {
    const ex = at.x + facing.x * r * 0.35 + side.x * s * r * 0.32;
    const ey = at.y + facing.y * r * 0.35 + side.y * s * r * 0.32 - r * 0.1;
    circle(ctx, ex, ey, r * 0.18, COLORS.text);
    circle(ctx, ex + facing.x * r * 0.07, ey + facing.y * r * 0.07, r * 0.09, COLORS.background);
  }
}
