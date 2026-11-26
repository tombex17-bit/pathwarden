import Decimal from 'break_infinity.js';
import { BUILD_COST, ENEMIES, GOLD, GREED_MULT, REFUND, UPGRADE_COST, type BuyAmount, type EnemyKind } from '../config/balance';
import type { State, Tower } from './types';
import { slotCount } from './waves';

/** Forgives rounding, so a price shown as exactly your gold can always be paid. */
const ROUNDING = 1 - 1e-9;

export function buildCost(towersBuilt: number): Decimal {
  return Decimal.pow(BUILD_COST.growth, towersBuilt).mul(BUILD_COST.base);
}

/** Price of `count` levels, starting from `level`. */
export function upgradeCost(level: number, count = 1): Decimal {
  const first = Decimal.pow(UPGRADE_COST.growth, level).mul(UPGRADE_COST.base);
  if (count === 1) return first;
  return first.mul(Decimal.pow(UPGRADE_COST.growth, count).sub(1)).div(UPGRADE_COST.growth - 1);
}

/** How many levels can be bought with `gold`, starting from `level`. */
export function affordableLevels(gold: Decimal, level: number): number {
  const ratio = gold.mul(UPGRADE_COST.growth - 1).div(upgradeCost(level)).add(1);
  let count = Math.max(0, Math.floor(ratio.log10() / Math.log10(UPGRADE_COST.growth)));
  // The logarithm can be off by one at exact prices.
  while (canAfford(gold, upgradeCost(level, count + 1))) count++;
  while (count > 0 && !canAfford(gold, upgradeCost(level, count))) count--;
  return count;
}

/** Levels a buy amount stands for; 'max' is at least 1 so that its price can be shown. */
export function levelsFor(amount: BuyAmount, gold: Decimal, level: number): number {
  return amount === 'max' ? Math.max(1, affordableLevels(gold, level)) : amount;
}

export function canAfford(gold: Decimal, cost: Decimal): boolean {
  return gold.gte(cost.mul(ROUNDING));
}

/** Pays if possible; returns whether it did. */
export function pay(state: State, cost: Decimal): boolean {
  if (!canAfford(state.gold, cost)) return false;
  state.gold = Decimal.max(0, state.gold.sub(cost));
  return true;
}

export function sellValue(tower: Tower): Decimal {
  return tower.buildPaid.mul(REFUND.build).add(tower.upgradesPaid.mul(REFUND.upgrades));
}

/** Gold for killing one unit, before any bounty; `goldMult` is the map's. */
export function enemyGold(wave: number, kind: EnemyKind, greed: number, goldMult = 1): Decimal {
  const mult = ENEMIES[kind].goldMult * (kind === 'boss' ? slotCount(wave) : 1);
  return Decimal.pow(GOLD.growth, wave - 1).mul(GOLD.base * mult * goldMult).mul(Decimal.pow(GREED_MULT, greed));
}
