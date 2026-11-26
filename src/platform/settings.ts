export const SPEEDS = [1, 2, 3] as const;
export type Speed = (typeof SPEEDS)[number];

/** Steps of the first-waves guide a player has done, as bits (see ui/guide.ts). All set means finished. */
export const GUIDE_STEPS = { built: 1, upgraded: 2, meteor: 4, second: 8 } as const;
export const GUIDE_DONE = 15;

/** Volume runs from 0 to 1. Muting keeps the volume for later. */
export interface Settings { speed: Speed; volume: number; muted: boolean; guide: number }

export const DEFAULT_VOLUME = 0.6;

export const defaultSettings = (): Settings => ({ speed: 1, volume: DEFAULT_VOLUME, muted: false, guide: 0 });
