import { MAPS, MAP_IDS, type MapId, type Point } from '../config/map';

interface Segment { from: Point; to: Point; length: number }

function segmentsOf(map: MapId): Segment[] {
  const { path } = MAPS[map];
  return path.slice(1).map((to, i) => {
    const from = path[i]!;
    return { from, to, length: Math.abs(to.x - from.x) + Math.abs(to.y - from.y) };
  });
}

const SEGMENTS = Object.fromEntries(MAP_IDS.map((m) => [m, segmentsOf(m)])) as Record<MapId, Segment[]>;
const LENGTHS = Object.fromEntries(MAP_IDS.map((m) => [m, SEGMENTS[m].reduce((sum, s) => sum + s.length, 0)])) as Record<MapId, number>;

export const pathLength = (map: MapId): number => LENGTHS[map];

/** The longest path of any map, for checking saved distances. */
export const MAX_PATH_LENGTH = Math.max(...MAP_IDS.map(pathLength));

/** Point on the path centerline at a distance from the entrance, clamped to both ends. */
export function pointAt(map: MapId, distance: number): Point {
  let left = Math.max(0, distance);
  for (const { from, to, length } of SEGMENTS[map]) {
    if (left <= length) {
      const f = left / length;
      return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    }
    left -= length;
  }
  const { path } = MAPS[map];
  return path[path.length - 1]!;
}

export const slotsOf = (map: MapId): readonly Point[] => MAPS[map].slots;
