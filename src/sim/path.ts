import { PATH, type Point } from '../config/map';

const segments = PATH.slice(1).map((to, i) => {
  const from = PATH[i]!;
  return { from, to, length: Math.abs(to.x - from.x) + Math.abs(to.y - from.y) };
});

export const PATH_LENGTH = segments.reduce((sum, s) => sum + s.length, 0);

/** Point on the path centerline at a distance from the entrance, clamped to both ends. */
export function pointAt(distance: number): Point {
  let left = Math.max(0, distance);
  for (const { from, to, length } of segments) {
    if (left <= length) {
      const f = left / length;
      return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    }
    left -= length;
  }
  return PATH[PATH.length - 1]!;
}
