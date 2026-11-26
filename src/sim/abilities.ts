import { ABILITIES, ABILITY_KINDS, TICKS_PER_SECOND, type AbilityKind } from '../config/balance';
import { GRID_H, GRID_W, type Point } from '../config/map';
import { damage, distSq, kill } from './combat';
import { removeDead } from './enemies';
import { towerStats } from './stats';
import type { CommandResult, Enemy, SimEvent, State } from './types';

const no = (reason: string): CommandResult => ({ ok: false, reason });

/** log10 of the damage per second of all towers, ignoring range, splash, chain, ramp and Brittle. */
export function log10FormationDps(state: State): number {
  const logs = state.towers.map((t) => {
    const { hitsPerSecond, targets } = towerStats(t.kind, t.spec);
    return t.log10Damage + Math.log10(hitsPerSecond * targets);
  });
  const top = Math.max(...logs);
  if (!Number.isFinite(top)) return -Infinity;
  return top + Math.log10(logs.reduce((sum, l) => sum + 10 ** (l - top), 0));
}

/** Where an ability does the most: the enemy with the most others in range, or the one with the most HP for Smite. */
export function bestTarget(state: State, ability: AbilityKind): Point | undefined {
  if (ability === 'smite') {
    const hp = (e: Enemy): number => e.log10MaxHp + Math.log10(e.hp);
    const top = state.enemies.reduce<Enemy | undefined>((a, b) => (a && hp(a) >= hp(b) ? a : b), undefined);
    return top && { x: top.x, y: top.y };
  }
  const radiusSq = ABILITIES[ability].radius ** 2;
  let best: Enemy | undefined;
  let bestCount = 0;
  for (const a of state.enemies) {
    let count = 0;
    for (const b of state.enemies) if (distSq(a, b) <= radiusSq) count++;
    if (count > bestCount) {
      best = a;
      bestCount = count;
    }
  }
  return best && { x: best.x, y: best.y };
}

export function isUnlocked(state: State, ability: AbilityKind): boolean {
  return state.bestEver >= ABILITIES[ability].unlockWave;
}

/** Casts if allowed; a rejected cast changes nothing and spends no cooldown. */
export function cast(state: State, ability: AbilityKind, at: Point, events: SimEvent[]): CommandResult {
  if (!Object.hasOwn(ABILITIES, ability)) return no('No such ability');
  if (!isUnlocked(state, ability)) return no(`Clear wave ${ABILITIES[ability].unlockWave} first`);
  if (state.cooldowns[ability] > 0) return no('Not ready yet');
  if (!(at.x >= 0 && at.x <= GRID_W && at.y >= 0 && at.y <= GRID_H)) return no('Pick a point on the map');
  // Bounty Mark is laid in advance: strong towers can leave the field empty between spawns.
  if (ability !== 'bounty' && state.enemies.length === 0) return no('No enemies on the map');

  const { radius, cooldownSeconds } = ABILITIES[ability];
  const inside = state.enemies.filter((e) => distSq(e, at) <= radius ** 2);
  let center: Point = { x: at.x, y: at.y };

  switch (ability) {
    case 'meteor': {
      const power = log10FormationDps(state);
      for (const e of inside) damage(state, e, power, ABILITIES.meteor.dpsSeconds, false, events);
      break;
    }
    case 'stasis':
    case 'bounty':
      state.zones.push({
        kind: ability, x: at.x, y: at.y, untilTick: state.tick + ABILITIES[ability].seconds * TICKS_PER_SECOND,
      });
      break;
    case 'smite': {
      if (inside.length === 0) return no('No enemy there');
      const target = inside.reduce((a, b) => (distSq(b, at) < distSq(a, at) ? b : a));
      center = { x: target.x, y: target.y };
      smite(state, target, events);
      break;
    }
  }
  state.cooldowns[ability] = cooldownSeconds * TICKS_PER_SECOND;
  events.push({ type: 'cast', ability, x: center.x, y: center.y });
  removeDead(state);
  return { ok: true };
}

function smite(state: State, target: Enemy, events: SimEvent[]): void {
  if (target.kind !== 'boss' && target.hp < ABILITIES.smite.killBelow) kill(state, target, events);
  else damage(state, target, log10FormationDps(state), ABILITIES.smite.dpsSeconds, false, events);
}

export function tickCooldowns(state: State): void {
  for (const a of ABILITY_KINDS) if (state.cooldowns[a] > 0) state.cooldowns[a]--;
  if (state.zones.some((z) => z.untilTick < state.tick)) state.zones = state.zones.filter((z) => z.untilTick >= state.tick);
}

/** Applies one kind of zone to every enemy inside it now. */
export function applyZones(state: State, kind: 'stasis' | 'bounty'): void {
  for (const zone of state.zones) {
    if (zone.kind !== kind) continue;
    const radiusSq = ABILITIES[kind].radius ** 2;
    for (const e of state.enemies) {
      if (distSq(e, zone) > radiusSq) continue;
      if (kind === 'stasis') e.stasisTick = state.tick;
      else e.marked = true;
    }
  }
}
