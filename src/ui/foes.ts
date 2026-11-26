import Decimal from 'break_infinity.js';
import { ENEMIES, type EnemyKind } from '../config/balance';
import { enemyGold } from '../sim/economy';
import type { State } from '../sim/types';
import { log10EnemyHp } from '../sim/waves';

export interface FoeRow { kind: EnemyKind; left: number; hp: Decimal; gold: Decimal; speed: number }

const ORDER = Object.keys(ENEMIES) as EnemyKind[];

/** The enemies still to beat in this wave, on the field or yet to come, one row per kind. */
export function foeRows(state: State): FoeRow[] {
  const left = new Map<EnemyKind, number>();
  for (const { kind } of [...state.enemies, ...state.spawns]) left.set(kind, (left.get(kind) ?? 0) + 1);
  return ORDER.filter((kind) => left.has(kind)).map((kind) => ({
    kind,
    left: left.get(kind)!,
    hp: Decimal.pow10(log10EnemyHp(state.wave, kind)),
    gold: enemyGold(state.wave, kind, state.greed),
    speed: ENEMIES[kind].speed,
  }));
}
