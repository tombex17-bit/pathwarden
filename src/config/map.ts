export interface Point { readonly x: number; readonly y: number }

export const GRID_W = 16;
export const GRID_H = 9;
export const PATH_WIDTH = 0.8;
export const SLOT_RADIUS = 0.45;
/** Every map has this many slots, so towers keep their slot number when the map changes. */
export const SLOT_COUNT = 12;

const p = (x: number, y: number): Point => ({ x, y });

export interface MapDef {
  readonly name: string;
  readonly text: string;
  /** Best wave ever needed to pick it. */
  readonly unlockWave: number;
  /** Multiplies all enemy gold on this map. */
  readonly goldMult: number;
  /** Corners of the path, entrance first. Segments run along the grid. */
  readonly path: readonly Point[];
  readonly slots: readonly Point[];
}

export const MAPS = {
  switchback: {
    name: 'Switchback',
    text: 'A long winding road. The first map.',
    unlockWave: 0,
    goldMult: 1,
    path: [p(0, 1), p(13, 1), p(13, 4), p(2, 4), p(2, 7), p(16, 7)],
    slots: [
      p(3, 2.5), p(5.5, 2.5), p(8, 2.5), p(10.5, 2.5),
      p(4.5, 5.5), p(7, 5.5), p(9.5, 5.5), p(12, 5.5),
      p(14.4, 2.5), p(0.7, 5.5), p(14.5, 5.5), p(0.7, 2.8),
    ],
  },
  crossroads: {
    name: 'Crossroads',
    text: 'The road loops back over itself. Area towers shine at the crossing. Gold x1.15.',
    unlockWave: 25,
    goldMult: 1.15,
    path: [p(0, 4), p(10, 4), p(10, 1), p(6, 1), p(6, 8), p(16, 8)],
    slots: [
      p(3, 2.5), p(4.8, 2.6), p(8, 2.5), p(11.5, 2.5),
      p(3, 5.5), p(4.8, 5.4), p(7.3, 5.4), p(9, 6.5),
      p(12, 6.5), p(1, 2.5), p(14.5, 6.5), p(4.8, 7.2),
    ],
  },
  shortcut: {
    name: 'Short Cut',
    text: 'A short road with little time to stop anyone. Gold x1.3.',
    unlockWave: 50,
    goldMult: 1.3,
    path: [p(0, 6), p(5, 6), p(5, 2), p(11, 2), p(11, 6), p(16, 6)],
    slots: [
      p(8, 4), p(6.5, 3.6), p(9.5, 3.6), p(3.5, 4.5),
      p(12.5, 4.5), p(2, 7.6), p(14, 7.6), p(3.5, 1.5),
      p(12.5, 1.5), p(8, 0.7), p(6.5, 7.3), p(9.5, 7.3),
    ],
  },
} as const satisfies Record<string, MapDef>;

export type MapId = keyof typeof MAPS;
export const MAP_IDS = Object.keys(MAPS) as MapId[];
export const FIRST_MAP: MapId = 'switchback';
