import { expect } from 'vitest';
import { GRID_H, GRID_W, PATH_WIDTH, SLOT_COUNT, SLOT_RADIUS } from '../../src/config/map';
import { distanceToPath, type Layout } from '../../src/sim/path';

/** A road across the grid along grid lines, and 12 slots clear of it, apart, inside the grid and in reach. */
export function checkLayout(l: Layout, name: string, reach = true): void {
  const { path, slots } = l;
  expect(path[0]!.x, name).toBe(0);
  expect(path[path.length - 1]!.x, name).toBe(GRID_W);
  for (let i = 1; i < path.length; i++) expect(path[i]!.x === path[i - 1]!.x || path[i]!.y === path[i - 1]!.y, name).toBe(true);
  expect(slots).toHaveLength(SLOT_COUNT);
  for (const [i, s] of slots.entries()) {
    expect(s.x - SLOT_RADIUS, `${name} slot ${i}`).toBeGreaterThanOrEqual(0);
    expect(s.x + SLOT_RADIUS, `${name} slot ${i}`).toBeLessThanOrEqual(GRID_W);
    expect(s.y - SLOT_RADIUS, `${name} slot ${i}`).toBeGreaterThanOrEqual(0);
    expect(s.y + SLOT_RADIUS, `${name} slot ${i}`).toBeLessThanOrEqual(GRID_H);
    const gap = distanceToPath(path, s);
    expect(gap, `${name} slot ${i} clear of the path`).toBeGreaterThanOrEqual(PATH_WIDTH / 2 + SLOT_RADIUS);
    // Every tower kind reaches the path from every slot (the shortest range is 2.4).
    if (reach) expect(gap, `${name} slot ${i} in reach`).toBeLessThanOrEqual(2);
    for (const [j, o] of slots.entries()) if (j > i) expect(Math.hypot(s.x - o.x, s.y - o.y), `${name} slots ${i}, ${j}`).toBeGreaterThan(1.2);
  }
}
