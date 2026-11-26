import { GOLD, type AbilityKind } from '../config/balance';
import { GUIDE_DONE, GUIDE_STEPS } from '../platform/settings';
import { buildCost, canAfford, upgradeCost } from '../sim/economy';
import type { SimEvent, State } from '../sim/types';
import { formatNumber } from './format';

/**
 * Slots the guide suggests, best first. Slot 5 covers two stretches of path, so one Bolt there holds wave 1;
 * slot 0 adds the first stretch and the bend.
 */
export const GUIDE_SLOTS = [5, 0, 2] as const;
/** The guide ends once this wave is cleared, even if steps are left. */
export const GUIDE_LAST_WAVE = 3;
/** Meteor is worth teaching once this many enemies are on the path. */
export const GUIDE_METEOR_CROWD = 3;

export type GuideTarget = 'slot' | 'bolt' | 'upgrade' | 'meteor' | 'play';
export interface GuideStep { text: string; target?: GuideTarget; slot?: number }
export interface GuideView { selectedSlot: number | undefined; aiming: AbilityKind | undefined }

export const guideOver = (done: number, state: State): boolean => done === GUIDE_DONE || state.bestEver >= GUIDE_LAST_WAVE;

/** Adds the steps this state and these events finish to `done`. */
export function guideProgress(done: number, state: State, events: readonly SimEvent[]): number {
  let next = done;
  if (state.towers.length > 0) next |= GUIDE_STEPS.built;
  if (state.towers.length > 1) next |= GUIDE_STEPS.second;
  if (state.towers.some((t) => t.level > 1)) next |= GUIDE_STEPS.upgraded;
  if (events.some((e) => e.type === 'cast' && e.ability === 'meteor')) next |= GUIDE_STEPS.meteor;
  return next;
}

/**
 * What the guide says now, or undefined once it is over. In order of priority: build the first tower,
 * upgrade once it is affordable, Meteor once enemies crowd, then save up for a second tower.
 */
export function guideStep(done: number, state: State, view: GuideView): GuideStep | undefined {
  if (guideOver(done, state)) return undefined;
  const has = (step: number): boolean => (done & step) !== 0;
  const tower = state.towers[0];
  const emptySelected = view.selectedSlot !== undefined && !state.towers.some((t) => t.slot === view.selectedSlot);
  const freeSlot = GUIDE_SLOTS.find((slot) => !state.towers.some((t) => t.slot === slot));

  if (!has(GUIDE_STEPS.built) || !tower) {
    if (emptySelected) {
      return { text: `Pick Bolt: fast single shots for ${formatNumber(buildCost(0))} of your ${GOLD.start} gold.`, target: 'bolt' };
    }
    return { text: 'Welcome! Tap the highlighted slot on the map to place your first tower there.', target: 'slot', slot: GUIDE_SLOTS[0] };
  }

  if (state.paused) return { text: 'Your tower is ready. Press Play (or Space) to start the game.', target: 'play' };

  const cost = upgradeCost(tower.level);
  if (!has(GUIDE_STEPS.upgraded) && canAfford(state.gold, cost)) {
    if (view.selectedSlot === tower.slot) return { text: 'Press Upgrade to make your tower stronger.', target: 'upgrade' };
    return { text: 'You have enough gold for an upgrade. Tap your tower.', target: 'slot', slot: tower.slot };
  }
  if (!has(GUIDE_STEPS.meteor) && state.enemies.length >= GUIDE_METEOR_CROWD && state.cooldowns.meteor === 0) {
    if (view.aiming === 'meteor') return { text: 'Now tap where the enemies are bunched up.', target: 'meteor' };
    return { text: 'Enemies are bunching up. Press Meteor (key 1), then tap them to hit them all.', target: 'meteor' };
  }
  if (!has(GUIDE_STEPS.upgraded)) {
    return { text: `Defeated enemies give gold. At ${formatNumber(cost, 'up')} gold you can upgrade your tower.` };
  }
  if (!has(GUIDE_STEPS.second)) {
    const second = buildCost(state.towers.length);
    if (!canAfford(state.gold, second)) {
      return { text: `More towers cover more of the path. Save up ${formatNumber(second, 'up')} gold for a second one.` };
    }
    if (emptySelected) return { text: 'Pick a tower. Each kind is good at something different; see the notes under each.', target: 'bolt' };
    return { text: 'You can afford a second tower. Tap the highlighted slot.', target: 'slot', slot: freeSlot };
  }
  if (!has(GUIDE_STEPS.meteor)) return { text: 'When enemies bunch up, use Meteor (key 1) on them.' };
  return undefined;
}
