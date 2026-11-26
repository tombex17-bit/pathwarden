export interface Point { readonly x: number; readonly y: number }

export const GRID_W = 16;
export const GRID_H = 9;
export const PATH_WIDTH = 0.8;
export const SLOT_RADIUS = 0.45;

const p = (x: number, y: number): Point => ({ x, y });

export const PATH: readonly Point[] = [p(0, 1), p(13, 1), p(13, 4), p(2, 4), p(2, 7), p(16, 7)];

export const SLOTS: readonly Point[] = [
  p(3, 2.5), p(5.5, 2.5), p(8, 2.5), p(10.5, 2.5),
  p(4.5, 5.5), p(7, 5.5), p(9.5, 5.5), p(12, 5.5),
  p(14.4, 2.5), p(0.7, 5.5), p(14.5, 5.5), p(0.7, 2.8),
];
