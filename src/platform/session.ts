import type Decimal from 'break_infinity.js';
import { IDLE } from '../config/balance';
import { payOffline } from '../sim/idle';
import { step } from '../sim/sim';
import type { Command, CommandResult, SimEvent, State } from '../sim/types';
import { FrameStepper } from './frame-stepper';
import type { Settings } from './settings';

/** Real time without frames longer than this counts as being away. */
export const AWAY_GAP_MS = 5000;

export interface Away { seconds: number; gold: Decimal }
export type OnResult = (result: CommandResult) => void;

/** A running game: turns real time into steps, and time away into offline gold. */
export class Session {
  private readonly stepper = new FrameStepper();
  private queue: { command: Command; onResult: OnResult | undefined }[] = [];
  private hidden = false;

  /** `wallMs` is the time of day now; `savedAt` is when a loaded game was saved. */
  constructor(readonly state: State, readonly settings: Settings, private wallMs: number, savedAt = wallMs) {
    this.loadedAway = this.pay(wallMs - savedAt);
  }

  /** What was earned while the game was closed. */
  readonly loadedAway: Away | undefined;

  get alpha(): number {
    return this.stepper.alpha;
  }

  send(command: Command, onResult?: OnResult): void {
    this.queue.push({ command, onResult });
  }

  /** Runs one frame. `playMs` is real time since the last frame, on a steady clock. */
  frame(playMs: number, wallMs: number): { events: SimEvent[]; away: Away | undefined } {
    if (this.hidden) return { events: [], away: undefined };
    const gap = wallMs - this.wallMs;
    this.wallMs = wallMs;
    if (gap > AWAY_GAP_MS) return { events: [], away: this.pay(gap) };

    const events: SimEvent[] = [];
    for (let i = this.stepper.advance(playMs, this.settings.speed); i > 0; i--) {
      const batch = this.queue;
      this.queue = [];
      const result = step(this.state, batch.map((q) => q.command));
      batch.forEach((q, n) => q.onResult?.(result.results[n]!));
      events.push(...result.events);
    }
    return { events, away: undefined };
  }

  /** Applies commands still waiting for a frame, so that a save taken now includes them. */
  flush(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    const result = step(this.state, batch.map((q) => q.command));
    batch.forEach((q, n) => q.onResult?.(result.results[n]!));
  }

  hide(wallMs: number): void {
    if (this.hidden) return;
    this.hidden = true;
    this.wallMs = wallMs;
  }

  show(wallMs: number): Away | undefined {
    if (!this.hidden) return undefined;
    this.hidden = false;
    const away = this.pay(wallMs - this.wallMs);
    this.wallMs = wallMs;
    return away;
  }

  private pay(ms: number): Away | undefined {
    // A paused game earns nothing while away, as it earns nothing while open.
    if (ms <= 0 || this.state.paused) return undefined;
    const seconds = ms / 1000;
    return { seconds, gold: payOffline(this.state, seconds) };
  }
}

/** Short absences are paid without a message. */
export function deservesSummary(away: Away | undefined): away is Away {
  return away !== undefined && away.seconds >= IDLE.summarySeconds;
}
