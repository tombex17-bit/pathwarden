import type { TowerKind } from '../config/balance';
import type { Sound } from './sounds';

const SHOT_HZ: Readonly<Record<TowerKind, number>> = { bolt: 880, cannon: 196, frost: 1320, beam: 660, tesla: 1760 };
const ABILITY_HZ = { meteor: [330, 82], stasis: [1200, 600], bounty: [880, 1760], smite: [1500, 110] } as const;

interface Tone { hz: number; toHz?: number; ms: number; wave?: OscillatorType; gain?: number; delayMs?: number }

/**
 * Plays synthesized sounds with Web Audio. Nothing is created before the first user input,
 * and nothing plays while muted.
 */
export class SoundPlayer {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private volume = 0;
  private muted = true;

  /** Call from a user input event. Browsers only allow audio to start there. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext as typeof AudioContext | undefined;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.apply();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.apply();
  }

  play(sound: Sound): void {
    if (!this.ctx || this.muted || this.volume <= 0 || this.ctx.state !== 'running') return;
    for (const tone of tones(sound)) this.tone(tone);
  }

  private apply(): void {
    // Loudness feels closer to even steps on a squared scale.
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * this.volume * 0.5;
  }

  private tone({ hz, toHz = hz, ms, wave = 'triangle', gain = 0.3, delayMs = 0 }: Tone): void {
    const ctx = this.ctx!;
    const start = ctx.currentTime + delayMs / 1000;
    const end = start + ms / 1000;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(hz, start);
    osc.frequency.exponentialRampToValueAtTime(toHz, end);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(amp).connect(this.master!);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

function tones(sound: Sound): Tone[] {
  switch (sound.name) {
    case 'shot': {
      const hz = SHOT_HZ[sound.tower];
      return [{ hz, toHz: hz * 0.7, ms: 40, wave: 'square', gain: 0.08 }];
    }
    case 'death':
      return sound.boss
        ? [{ hz: 220, toHz: 40, ms: 600, wave: 'sawtooth', gain: 0.35 }]
        : [{ hz: 520, toHz: 180, ms: 90, gain: 0.18 }];
    case 'leak':
      return [{ hz: 140, toHz: 70, ms: 220, wave: 'sawtooth', gain: 0.3 }];
    case 'ability': {
      const [hz, toHz] = ABILITY_HZ[sound.ability];
      return [{ hz, toHz, ms: 350, wave: 'sawtooth', gain: 0.25 }];
    }
    case 'purchase':
      return [{ hz: 660, ms: 60, gain: 0.2 }, { hz: 990, ms: 80, gain: 0.2, delayMs: 60 }];
    case 'boss':
      return [{ hz: 110, ms: 300, wave: 'sawtooth', gain: 0.3 }, { hz: 82, ms: 500, wave: 'sawtooth', gain: 0.3, delayMs: 320 }];
    case 'prestige':
      return [523, 659, 784, 1047].map((hz, i) => ({ hz, ms: 180, gain: 0.25, delayMs: i * 110 }));
  }
}
