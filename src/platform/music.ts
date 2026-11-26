// Generated background music (SPEC section 22): an original, endless piece written by these rules, made with Web Audio.

export type Mood = 'calm' | 'tense';
export type Voice = 'pad' | 'bass' | 'arp' | 'lead' | 'kick' | 'hat';

/** One note: when it starts and how long it lasts, in beats from the start of its bar. */
export interface Note { voice: Voice; beat: number; beats: number; midi: number; gain: number }

export const TEMPO: Readonly<Record<Mood, number>> = { calm: 78, tense: 104 };
export const BEATS_PER_BAR = 4;

// Chords as scale steps of A minor: i, VI, III, VII and so on. Tense music leans on the dominant (E major).
const A3 = 57;
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const CALM_CHORDS = [[0, 5, 2, 6], [0, 4, 5, 6], [3, 0, 5, 6], [5, 6, 0, 0]];
const TENSE_CHORDS = [[0, 0, 5, 4], [0, 3, 5, 4]];
const ARPS = [[0, 1, 2, 1, 0, 2, 1, 2], [0, 2, 1, 2, 0, 1, 2, 3], [2, 1, 0, 1, 2, 3, 2, 1], [0, 1, 2, 3, 2, 1, 0, 1]];
/** A minor pentatonic, for the occasional tune on top. */
const PENTA = [0, 3, 5, 7, 10];

const note = (step: number): number => A3 + 12 * Math.floor(step / 7) + MINOR[((step % 7) + 7) % 7]!;

/** Chord tones (as MIDI) of a chord built on a scale step; the tense fifth chord gets its raised third. */
function chord(root: number, mood: Mood): number[] {
  const tones = [note(root), note(root + 2), note(root + 4)];
  if (mood === 'tense' && root === 4) tones[1]! += 1;
  return tones;
}

/** A small, repeatable hash so every bar is the same each time it comes round. */
function hash(...values: number[]): number {
  let h = 2166136261;
  for (const v of values) h = Math.imul(h ^ v, 16777619);
  return (h >>> 0) / 4294967296;
}

/** Every note of one bar. Bars repeat in phrases of 4 within sections of 16, with small, seeded variations. */
export function composeBar(bar: number, mood: Mood): Note[] {
  const notes: Note[] = [];
  const phrases = mood === 'calm' ? CALM_CHORDS : TENSE_CHORDS;
  const section = Math.floor(bar / 16) % phrases.length;
  const root = phrases[section]![bar % 4]!;
  const tones = chord(root, mood);

  // A soft held chord, an octave below and around middle C.
  for (const midi of tones) notes.push({ voice: 'pad', beat: 0, beats: 4, midi, gain: 0.08 });
  // Bass on the root: half notes when calm, driving quarters when tense.
  const bassBeats = mood === 'calm' ? [0, 2] : [0, 1, 2, 3];
  for (const beat of bassBeats) notes.push({ voice: 'bass', beat, beats: mood === 'calm' ? 1.8 : 0.8, midi: tones[0]! - 12, gain: 0.22 });

  // Eighth-note arpeggio an octave up; calm music rests every fourth bar.
  if (mood === 'tense' || bar % 4 !== 3) {
    const pattern = ARPS[Math.floor(hash(bar >> 2, section) * ARPS.length)]!;
    pattern.forEach((i, eighth) => {
      const midi = (tones[i % 3] ?? tones[0]!) + 12 + (i === 3 ? 12 : 0);
      notes.push({ voice: 'arp', beat: eighth / 2, beats: 0.45, midi, gain: mood === 'calm' ? 0.05 : 0.06 });
    });
  }

  // Now and then a short tune on top, from the pentatonic scale.
  if (hash(bar, 7) < (mood === 'calm' ? 0.4 : 0.55)) {
    const count = 2 + Math.floor(hash(bar, 11) * 3);
    for (let i = 0; i < count; i++) {
      const step = PENTA[Math.floor(hash(bar, i, 13) * PENTA.length)]!;
      notes.push({ voice: 'lead', beat: 1 + i * (3 / count), beats: 3 / count, midi: A3 + 24 + step, gain: 0.05 });
    }
  }

  if (mood === 'tense') {
    for (let beat = 0; beat < 4; beat++) notes.push({ voice: 'kick', beat, beats: 0.3, midi: 0, gain: 0.35 });
    for (let eighth = 1; eighth < 8; eighth += 2) notes.push({ voice: 'hat', beat: eighth / 2, beats: 0.1, midi: 0, gain: 0.05 });
  }
  return notes;
}

export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const LOOKAHEAD_S = 0.8;

/**
 * Plays the generated music on the game's audio context. Bars are scheduled a little ahead of time.
 * While muted or at volume 0, nothing is created.
 */
export class MusicPlayer {
  private ctx: AudioContext | undefined;
  private out: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private bar = 0;
  private nextBarAt = 0;
  private volume = 0;
  private muted = true;
  mood: Mood = 'calm';

  /** Starts once the context exists, which is after the first user input. */
  attach(ctx: AudioContext): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    this.apply();
    window.setInterval(() => this.schedule(), 200);
    this.schedule();
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.apply();
  }

  private get audible(): boolean {
    return !this.muted && this.volume > 0;
  }

  private apply(): void {
    if (!this.out || !this.ctx) return;
    this.out.gain.setTargetAtTime(this.audible ? this.volume * this.volume * 0.6 : 0, this.ctx.currentTime, 0.1);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.audible) {
      if (ctx) this.nextBarAt = 0;
      return;
    }
    // After a pause (a hidden tab, or muting), start again just ahead of now.
    if (this.nextBarAt < ctx.currentTime) this.nextBarAt = ctx.currentTime + 0.1;
    while (this.nextBarAt < ctx.currentTime + LOOKAHEAD_S) {
      const beat = 60 / TEMPO[this.mood];
      for (const n of composeBar(this.bar, this.mood)) this.play(n, this.nextBarAt + n.beat * beat, n.beats * beat);
      this.nextBarAt += BEATS_PER_BAR * beat;
      this.bar++;
    }
  }

  private play(n: Note, start: number, length: number): void {
    const ctx = this.ctx!;
    const amp = ctx.createGain();
    amp.connect(this.out!);
    const end = start + length;
    if (n.voice === 'hat') {
      this.noise ??= makeNoise(ctx);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      src.connect(filter).connect(amp);
      envelope(amp.gain, start, end, n.gain, 0.002);
      src.start(start);
      src.stop(end + 0.05);
      return;
    }
    const osc = ctx.createOscillator();
    osc.connect(amp);
    if (n.voice === 'kick') {
      osc.frequency.setValueAtTime(120, start);
      osc.frequency.exponentialRampToValueAtTime(40, end);
    } else {
      osc.frequency.value = hz(n.midi);
    }
    osc.type = n.voice === 'pad' || n.voice === 'arp' ? 'triangle' : 'sine';
    envelope(amp.gain, start, end, n.gain, n.voice === 'pad' ? 0.6 : 0.01);
    osc.start(start);
    osc.stop(end + 0.3);
  }
}

/** Rises over `attack` seconds, holds, and fades out by the end. */
function envelope(gain: AudioParam, start: number, end: number, peak: number, attack: number): void {
  gain.setValueAtTime(0.0001, start);
  gain.exponentialRampToValueAtTime(peak, start + Math.min(attack, (end - start) / 2));
  gain.setValueAtTime(peak, Math.max(start + attack, end - 0.25));
  gain.exponentialRampToValueAtTime(0.0001, end + 0.25);
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    data[i] = ((seed >>> 16) & 0x7fff) / 16384 - 1;
  }
  return buffer;
}
