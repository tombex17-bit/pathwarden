import { ABILITIES, SPEC_LEVEL, TICKS_PER_SECOND, type SpecChoice, type TowerKind } from '../../src/config/balance';
import { bestTarget } from '../../src/sim/abilities';
import type { Command, State } from '../../src/sim/types';

// The bots' exact policy (SPEC section 9).

/** Towers by slot index, in build order. */
export const BUILD_ORDER: readonly TowerKind[] = [
  'bolt', 'cannon', 'bolt', 'beam', 'tesla', 'frost', 'bolt', 'beam', 'cannon', 'tesla', 'beam', 'bolt',
];

export const SPECS: Readonly<Record<TowerKind, SpecChoice>> = { bolt: 'a', cannon: 'b', frost: 'b', beam: 'a', tesla: 'b', warden: 'a' };

export const specAt = (kind: TowerKind, level: number): SpecChoice | null => (level >= SPEC_LEVEL ? SPECS[kind] : null);

const after = (state: State, seconds: number): boolean => state.waveTick > seconds * TICKS_PER_SECOND;

/** What an active player casts right now. */
export function castCommands(state: State): Command[] {
  const commands: Command[] = [];
  const some = state.enemies.length > 0;
  const ready = (a: keyof typeof ABILITIES): boolean => state.cooldowns[a] === 0 && state.bestEver >= ABILITIES[a].unlockWave;

  const aim = (ability: 'meteor' | 'stasis' | 'smite'): void => {
    const at = bestTarget(state, ability);
    if (at) commands.push({ type: 'cast', ability, ...at });
  };
  if (some && ready('meteor') && after(state, 7)) aim('meteor');
  if (some && ready('stasis') && after(state, 9)) aim('stasis');
  if (ready('bounty') && after(state, 1) && !after(state, 3)) {
    commands.push({ type: 'cast', ability: 'bounty', x: 1.2, y: 1 });
  }
  if (some && ready('smite') && after(state, 7)) aim('smite');
  return commands;
}
