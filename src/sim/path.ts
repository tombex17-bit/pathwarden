import { GRID_H, GRID_W, MAPS, MAZE, PATH_WIDTH, SLOT_COUNT, SLOT_RADIUS, type MapId, type Point } from '../config/map';
import { createRng } from './rng';

// Where the road and the slots are on the current map (SPEC sections 19 and 21).

interface Segment { from: Point; to: Point; length: number }

export interface Layout {
  readonly path: readonly Point[];
  readonly slots: readonly Point[];
  readonly goldMult: number;
  readonly length: number;
  readonly segments: readonly Segment[];
}

/** What decides a layout: the map, the seed of a generated road, and the Maze's walls. */
export interface LayoutKey { map: MapId; wildSeed: number; walls: readonly number[] }

function makeLayout(path: readonly Point[], slots: readonly Point[], goldMult: number): Layout {
  const segments = path.slice(1).map((to, i) => {
    const from = path[i]!;
    return { from, to, length: Math.hypot(to.x - from.x, to.y - from.y) };
  });
  return { path, slots, goldMult, segments, length: segments.reduce((sum, s) => sum + s.length, 0) };
}

/** Distance from a point to a polyline. */
export function distanceToPath(path: readonly Point[], p: Point): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return best;
}

// ---- Generated roads (Wilds) ----

/** Slots must clear the road and other slots, and stay within reach of it. */
export const WILDS = { minClear: PATH_WIDTH / 2 + SLOT_RADIUS + 0.05, maxReach: 2, minSpacing: 1.3 } as const;

/** A road across the grid with 2 to 4 bends up or down, and 12 slots along it. Same seed, same road. */
export function generateWilds(seed: number): { path: Point[]; slots: Point[] } {
  const rng = createRng(seed, 0x5eed);
  const int = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
  for (;;) {
    const bends = int(2, 4);
    // Columns for the vertical stretches, at least 3 apart and away from the edges.
    const xs: number[] = [];
    let x = 1;
    for (let i = 0; i < bends; i++) {
      x += int(3, Math.max(3, Math.floor((14 - x) / (bends - i))));
      xs.push(Math.min(x, 14));
    }
    if (new Set(xs).size !== xs.length || xs[xs.length - 1]! > 14) continue;
    let y = int(1, 7);
    const path: Point[] = [{ x: 0, y }];
    for (const bx of xs) {
      path.push({ x: bx, y });
      let ny = int(1, 8);
      while (Math.abs(ny - y) < 2) ny = int(1, 8);
      y = ny;
      path.push({ x: bx, y });
    }
    path.push({ x: GRID_W, y });

    const candidates: Point[] = [];
    for (let cx = 0.75; cx <= GRID_W - 0.75; cx += 0.5) {
      for (let cy = 0.75; cy <= GRID_H - 0.75; cy += 0.5) {
        const d = distanceToPath(path, { x: cx, y: cy });
        if (d >= WILDS.minClear && d <= WILDS.maxReach) candidates.push({ x: cx, y: cy });
      }
    }
    // Shuffle, then keep spots far enough from those already kept.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    const slots: Point[] = [];
    for (const c of candidates) {
      if (slots.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= WILDS.minSpacing)) slots.push(c);
      if (slots.length === SLOT_COUNT) break;
    }
    if (slots.length === SLOT_COUNT) return { path, slots: slots.sort((a, b) => a.x - b.x || a.y - b.y) };
  }
}

/** Shorter generated roads pay more: x1 at the first map's length (44), up to x1.3. */
export const wildsGold = (length: number): number => Math.min(1.3, 1 + Math.max(0, 44 - length) / 70);

// ---- The Maze ----

export const MAZE_CELLS = GRID_W * GRID_H;
export const cellOf = (x: number, y: number): number => Math.floor(y) * GRID_W + Math.floor(x);
export const cellCenter = (cell: number): Point => ({ x: (cell % GRID_W) + 0.5, y: Math.floor(cell / GRID_W) + 0.5 });
const ENTRANCE = MAZE.row * GRID_W;
const EXIT = MAZE.row * GRID_W + GRID_W - 1;
const SLOT_CELLS = new Set(MAPS.maze.slots.map((s) => cellOf(s.x, s.y)));

/** Cells that can never hold a wall: the entrance, the exit and the slots. */
export const isOpenOnly = (cell: number): boolean => cell === ENTRANCE || cell === EXIT || SLOT_CELLS.has(cell);

/** The shortest way through the Maze, cell by cell, keeping straight where it can; undefined if walled off. */
export function mazeRoute(walls: readonly number[]): number[] | undefined {
  const blocked = new Set([...walls, ...SLOT_CELLS]);
  const dist = new Map<number, number>([[EXIT, 0]]);
  const queue = [EXIT];
  const neighbours = (c: number): number[] => {
    const x = c % GRID_W;
    const list: number[] = [];
    if (x < GRID_W - 1) list.push(c + 1);
    if (x > 0) list.push(c - 1);
    if (c >= GRID_W) list.push(c - GRID_W);
    if (c < MAZE_CELLS - GRID_W) list.push(c + GRID_W);
    return list.filter((n) => !blocked.has(n));
  };
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    for (const n of neighbours(c)) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(c)! + 1);
        queue.push(n);
      }
    }
  }
  if (!dist.has(ENTRANCE)) return undefined;
  const route = [ENTRANCE];
  let step = 1;
  while (route[route.length - 1] !== EXIT) {
    const c = route[route.length - 1]!;
    const next = neighbours(c).filter((n) => dist.get(n) === dist.get(c)! - 1);
    route.push(next.find((n) => n - c === step) ?? next[0]!);
    step = route[route.length - 1]! - c;
  }
  return route;
}

/** The route as corners only, from the left edge to the right edge. */
function mazePath(route: readonly number[]): Point[] {
  const points = [{ x: 0, y: MAZE.row + 0.5 }, ...route.map(cellCenter), { x: GRID_W, y: MAZE.row + 0.5 }];
  return points.filter((p, i) => {
    const a = points[i - 1];
    const b = points[i + 1];
    return !a || !b || !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

// ---- Looking layouts up ----

const cache = new Map<string, Layout>();
let last: { key: LayoutKey; layout: Layout } | undefined;

export function layoutOf(key: LayoutKey): Layout {
  // Walls are replaced, never changed in place, so the same array means the same Maze.
  if (last && last.key.map === key.map && last.key.wildSeed === key.wildSeed && last.key.walls === key.walls) return last.layout;
  const layout = lookUp(key);
  last = { key: { map: key.map, wildSeed: key.wildSeed, walls: key.walls }, layout };
  return layout;
}

function lookUp(key: LayoutKey): Layout {
  const def = MAPS[key.map];
  const id = def.kind === 'fixed' ? key.map : def.kind === 'generated' ? `wilds:${key.wildSeed}` : `maze:${key.walls.join('.')}`;
  let layout = cache.get(id);
  if (layout) return layout;
  if (def.kind === 'fixed') layout = makeLayout(def.path, def.slots, def.goldMult);
  else if (def.kind === 'generated') {
    const { path, slots } = generateWilds(key.wildSeed);
    const plain = makeLayout(path, slots, 1);
    layout = makeLayout(path, slots, wildsGold(plain.length));
  } else {
    const route = mazeRoute(key.walls);
    if (!route) throw new Error('The Maze has no way through');
    layout = makeLayout(mazePath(route), def.slots, def.goldMult);
  }
  if (cache.size > 64) cache.clear();
  cache.set(id, layout);
  return layout;
}

export const pathLength = (layout: Layout): number => layout.length;

/** The longest road any map can have, for checking saved distances: a Maze can wind across the whole field. */
export const MAX_PATH_LENGTH = MAZE_CELLS + GRID_W;

/** Point on the path centerline at a distance from the entrance, clamped to both ends. */
export function pointAt(layout: Layout, distance: number): Point {
  let left = Math.max(0, distance);
  for (const { from, to, length } of layout.segments) {
    if (left <= length) {
      const f = length === 0 ? 0 : left / length;
      return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    }
    left -= length;
  }
  return layout.path[layout.path.length - 1]!;
}
