import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, type TowerKind } from '../../src/config/balance';
import { bestTarget } from '../../src/sim/abilities';
import { buildCost, canAfford, upgradeCost } from '../../src/sim/economy';
import { createNewGame, step } from '../../src/sim/sim';
import type { Command, State } from '../../src/sim/types';
import { GUIDE_SLOTS } from '../../src/ui/guide-steps';

// Can a new player beat the first waves without losing a life? Wave 1 used to start at once and leaked lives
// for anyone slower than a bot, so it now waits for the first tower, and the game starts with 70 gold, not 60.

interface Player {
  /** Towers to build, in order. */
  plan: readonly [TowerKind, number][];
  /** Seconds between the player's actions, like a person looking away. */
  every: number;
  upgrade: boolean;
  meteor: boolean;
  /** Seconds before the first click, reading the screen. */
  reading: number;
}

/** The guide's way: Bolt in its slot, a second one where it points, then more towers along the path. */
const GUIDED: Player['plan'] = [
  ['bolt', GUIDE_SLOTS[0]], ['bolt', GUIDE_SLOTS[1]], ['bolt', GUIDE_SLOTS[2]], ['cannon', 1], ['bolt', 6], ['beam', 7],
];

/** Plays from a brand-new game; returns lives lost in each wave, plus 100 for a lost wave. */
function play(seed: number, player: Player, waves: number): number[] {
  const s: State = createNewGame(seed);
  const lost: number[] = [0];
  let wave = 1;
  for (let tick = 0; s.wave <= waves && tick < 3600 * TICKS_PER_SECOND; tick++) {
    const acting = tick >= player.reading * TICKS_PER_SECOND && tick % Math.round(player.every * TICKS_PER_SECOND) === 0;
    const commands: Command[] = [];
    if (acting) {
      const next = player.plan[s.towers.length];
      if (next && canAfford(s.gold, buildCost(s.towers.length))) {
        commands.push({ type: 'build', tower: next[0], slot: next[1] });
      } else if (player.upgrade && s.towers.length > 0) {
        const weakest = [...s.towers].sort((a, b) => a.level - b.level)[0]!;
        // Save up when the next tower is close.
        const saving = next !== undefined && s.gold.gte(buildCost(s.towers.length).mul(0.7));
        if (!saving && canAfford(s.gold, upgradeCost(weakest.level))) commands.push({ type: 'upgrade', slot: weakest.slot, amount: 1 });
      }
      if (player.meteor && s.cooldowns.meteor === 0 && s.enemies.length >= 3) {
        const at = bestTarget(s, 'meteor');
        if (at) commands.push({ type: 'cast', ability: 'meteor', ...at });
      }
    }
    for (const e of step(s, commands).events) {
      if (e.type === 'waveStart') lost[(wave = e.wave) - 1] ??= 0;
      if (e.type === 'leak') lost[wave - 1]! += 1;
      if (e.type === 'waveLost') lost[wave - 1]! += 100;
    }
  }
  // The loop ends as the next wave starts.
  return lost.slice(0, waves);
}

const SEEDS = [1, 2, 3, 4, 5];
const none = (waves: number): number[] => Array<number>(waves).fill(0);

describe('a new player can keep all 10 lives', () => {
  it('following the guide, acting every 3 seconds, through wave 15 and the first boss', () => {
    for (const seed of SEEDS) {
      expect(play(seed, { plan: GUIDED, every: 3, upgrade: true, meteor: true, reading: 30 }, 15), `seed ${seed}`).toEqual(none(15));
    }
  });

  it('even without Meteor', () => {
    for (const seed of SEEDS) {
      expect(play(seed, { plan: GUIDED, every: 3, upgrade: true, meteor: false, reading: 30 }, 15), `seed ${seed}`).toEqual(none(15));
    }
  });

  it('a slow player who reads for 2 minutes and then acts every 8 seconds, without Meteor, through wave 3', () => {
    for (const seed of SEEDS) {
      expect(play(seed, { plan: GUIDED, every: 8, upgrade: true, meteor: false, reading: 120 }, 3), `seed ${seed}`).toEqual(none(3));
    }
  });
});
