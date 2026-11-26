import type { AbilityKind, TowerKind } from '../config/balance';
import { hasBoss } from '../sim/waves';
import type { SimEvent } from '../sim/types';

export type Sound =
  | { name: 'shot'; tower: TowerKind }
  | { name: 'death'; boss: boolean }
  | { name: 'leak' }
  | { name: 'ability'; ability: AbilityKind }
  | { name: 'purchase' }
  | { name: 'boss' }
  | { name: 'prestige' };

export type SoundName = Sound['name'];

/** Most sounds of each kind per real second (SPEC section 13 limits shots to 8). */
export const SOUNDS_PER_SECOND: Readonly<Record<SoundName, number>> = {
  shot: 8, death: 8, leak: 4, ability: 8, purchase: 8, boss: 2, prestige: 2,
};

function soundFor(e: SimEvent): Sound | undefined {
  switch (e.type) {
    case 'shot': return { name: 'shot', tower: e.kind };
    case 'death': return { name: 'death', boss: e.kind === 'boss' };
    case 'leak': return { name: 'leak' };
    case 'cast': return { name: 'ability', ability: e.ability };
    case 'waveStart': return hasBoss(e.wave) ? { name: 'boss' } : undefined;
    case 'prestige': return { name: 'prestige' };
    default: return undefined;
  }
}

/** Turns game events into sounds and drops those over the limit, so fast play stays pleasant. */
export class SoundPicker {
  private readonly played = new Map<SoundName, number[]>();

  pick(events: readonly SimEvent[], nowMs: number): Sound[] {
    const sounds: Sound[] = [];
    for (const e of events) {
      const sound = soundFor(e);
      if (sound && this.allow(sound.name, nowMs)) sounds.push(sound);
    }
    return sounds;
  }

  allow(name: SoundName, nowMs: number): boolean {
    const recent = (this.played.get(name) ?? []).filter((t) => nowMs - t < 1000 && t <= nowMs);
    const ok = recent.length < SOUNDS_PER_SECOND[name];
    if (ok) recent.push(nowMs);
    this.played.set(name, recent);
    return ok;
  }
}
