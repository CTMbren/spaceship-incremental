import { HULLS } from '../data/hulls';
import { cellKey, nextTileCost, unlockableCells } from './hull';
import type { Cell, Cost, GameState, ItemId } from './types';

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: 'not_unlockable' | 'hull_full' | 'need_credits' | 'need_items' | 'unknown_hull' };

export function canAfford(state: GameState, cost: Cost): 'ok' | 'need_credits' | 'need_items' {
  if (state.credits < cost.credits) return 'need_credits';
  for (const [k, v] of Object.entries(cost.items ?? {})) {
    if (state.items[k as ItemId] < (v ?? 0)) return 'need_items';
  }
  return 'ok';
}

/** Pure: returns a new state, never mutates the input. */
export function buyTile(state: GameState, cell: Cell): ActionResult {
  const def = HULLS[state.ship.hullId];
  if (!def) return { ok: false, reason: 'unknown_hull' };
  const owned = new Set(state.ship.ownedCells);
  const cost = nextTileCost(def, owned.size);
  if (!cost) return { ok: false, reason: 'hull_full' };
  if (!unlockableCells(def, owned).some((c) => cellKey(c) === cellKey(cell))) {
    return { ok: false, reason: 'not_unlockable' };
  }
  const afford = canAfford(state, cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const items = { ...state.items };
  for (const [k, v] of Object.entries(cost.items ?? {})) items[k as ItemId] -= v ?? 0;
  return {
    ok: true,
    state: {
      ...state,
      credits: state.credits - cost.credits,
      items,
      ship: { ...state.ship, ownedCells: [...state.ship.ownedCells, cellKey(cell)] },
    },
  };
}
