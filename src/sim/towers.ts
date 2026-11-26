import Decimal from 'break_infinity.js';
import { HERO, TICKS_PER_SECOND } from '../config/balance';
import { affordableLevels, upgradeCost } from './economy';
import { layoutOf } from './path';
import { log10Damage, rankOf } from './stats';
import type { SimEvent, State, Tower } from './types';

// Rules that touch every tower: the Warden, ranks and damage (SPEC section 19).

export const isHero = (tower: Tower): boolean => tower.kind === 'warden';
export const heroOf = (state: State): Tower | undefined => state.towers.find(isHero);
/** Towers that count toward the next build price; the Warden is free and does not count. */
export const builtTowers = (state: State): number => state.towers.filter((t) => !isHero(t)).length;

export function newTower(slot: number, kind: Tower['kind'], buildPaid: Decimal): Tower {
  return {
    slot, kind, level: 1, spec: null, cooldown: 0, log10Damage: 0,
    locks: [], buildPaid, upgradesPaid: new Decimal(0), tier: 1, kills: 0, boostTicks: 0, boostCooldown: 0,
  };
}

function inAura(state: State, tower: Tower): boolean {
  const hero = heroOf(state);
  if (!hero || hero === tower) return false;
  const { slots } = layoutOf(state);
  const a = slots[hero.slot]!;
  const b = slots[tower.slot]!;
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= HERO.auraRange ** 2;
}

/** Recomputes a tower's damage; call after anything that affects it changes. */
export function refreshDamage(state: State, tower: Tower): void {
  tower.log10Damage = log10Damage(tower.kind, tower.spec, tower.level, state.power, tower.tier, rankOf(tower.kills))
    + (inAura(state, tower) ? Math.log10(HERO.auraMult) : 0);
}

export function refreshAll(state: State): void {
  for (const t of state.towers) refreshDamage(state, t);
}

/** A tower finished off an enemy: count it, and raise its rank at each threshold. */
export function creditKill(state: State, tower: Tower, events: SimEvent[]): void {
  const before = rankOf(tower.kills);
  tower.kills++;
  const rank = rankOf(tower.kills);
  if (rank === before) return;
  refreshDamage(state, tower);
  events.push({ type: 'rankUp', slot: tower.slot, kind: tower.kind, rank });
}

/** The Warden learns from every kill: a share of the gold becomes experience, spent on levels at upgrade prices. */
export function gainHeroXp(state: State, gold: Decimal, events: SimEvent[]): void {
  const hero = heroOf(state);
  if (!hero) return;
  state.heroXp = state.heroXp.add(gold.mul(HERO.xpShare));
  const levels = affordableLevels(state.heroXp, hero.level);
  if (levels === 0) return;
  state.heroXp = Decimal.max(0, state.heroXp.sub(upgradeCost(hero.level, levels)));
  hero.level += levels;
  refreshDamage(state, hero);
  events.push({ type: 'heroLevel', level: hero.level });
}

export const HERO_MOVE_TICKS = HERO.moveSeconds * TICKS_PER_SECOND;
