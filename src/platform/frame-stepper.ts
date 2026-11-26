import { TICKS_PER_SECOND } from '../config/balance';

export const MAX_STEPS_PER_FRAME = 12;
const STEP_MS = 1000 / TICKS_PER_SECOND;

/** Turns real frame times into whole simulation steps. */
export class FrameStepper {
  private pendingMs = 0;

  /** Returns how many steps to run; time beyond the per-frame limit is dropped. */
  advance(realMs: number, speed = 1): number {
    this.pendingMs += Math.max(0, realMs) * speed;
    const due = Math.floor(this.pendingMs / STEP_MS + 1e-9);
    if (due > MAX_STEPS_PER_FRAME) {
      this.pendingMs = 0;
      return MAX_STEPS_PER_FRAME;
    }
    this.pendingMs = Math.max(0, this.pendingMs - due * STEP_MS);
    return due;
  }

  /** How far the next step has progressed, 0 to 1, for drawing between steps. */
  get alpha(): number {
    return Math.min(1, this.pendingMs / STEP_MS);
  }
}
