import { GRID_H, GRID_W, MAPS, SLOT_RADIUS, type MapId, type Point } from '../config/map';

/** Maps grid cells to CSS pixels: the whole map, centered, aspect ratio kept. */
export interface View { readonly scale: number; readonly left: number; readonly top: number }

const TAP_RADIUS_PX = 22;

export function fitView(width: number, height: number): View {
  const scale = Math.min(width / GRID_W, height / GRID_H);
  return { scale, left: (width - GRID_W * scale) / 2, top: (height - GRID_H * scale) / 2 };
}

export function toScreen(view: View, p: Point): Point {
  return { x: view.left + p.x * view.scale, y: view.top + p.y * view.scale };
}

export function toGrid(view: View, x: number, y: number): Point {
  return { x: (x - view.left) / view.scale, y: (y - view.top) / view.scale };
}

/** The nearest slot within its own radius or 22 px, whichever is larger. */
export function slotAt(view: View, x: number, y: number, map: MapId): number | undefined {
  let best: number | undefined;
  let bestDist = Math.max(TAP_RADIUS_PX, SLOT_RADIUS * view.scale);
  MAPS[map].slots.forEach((slot, i) => {
    const s = toScreen(view, slot);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}
