export const SPEEDS = [1, 2, 3] as const;
export type Speed = (typeof SPEEDS)[number];

/** Volume runs from 0 to 1. Muting keeps the volume for later. */
export interface Settings { speed: Speed; volume: number; muted: boolean }

export const DEFAULT_VOLUME = 0.6;

export const defaultSettings = (): Settings => ({ speed: 1, volume: DEFAULT_VOLUME, muted: false });
