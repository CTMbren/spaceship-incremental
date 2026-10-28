import { HULLS } from '../data/hulls';
import { MODULES, SMELTER } from '../data/modules';
import { SMASHER } from '../data/smasher';
import { PRICES } from '../data/balance';
import { nextTileCost } from './hull';
import { freeCells, freeEdgeCells, moduleCost } from './modules';
import type { Cost, GameState, ItemId } from './types';

export type StructureGoalId = 'smelter' | 'repair' | 'beam2' | 'expand';

/**
 * The structure purchase the player is working toward next (after the first sell). Sell and the Smelter
 * never touch the materials it needs ("reserved for the current goal").
 */
export function structureGoal(s: GameState): { id: StructureGoalId; cost: Cost } | null {
  const def = HULLS[s.ship.hullId];
  const tile = def ? nextTileCost(def, s.ship.ownedCells.length) : null;
  const expand = tile ? { id: 'expand' as const, cost: tile } : null;
  if (!s.smelter.built) {
    return freeCells(s).length > 0 ? { id: 'smelter', cost: MODULES.smelter.cost } : expand;
  }
  if (!s.smasher.repaired) return { id: 'repair', cost: SMASHER.repair };
  if (s.beams.length < 2) {
    const cost = moduleCost(s, 'beam');
    if (cost && freeEdgeCells(s).length > 0) return { id: 'beam2', cost };
    return expand;
  }
  return expand;
}

/**
 * Materials held back from selling and smelting. The very first sell is the tutorial: nothing is reserved.
 * This is what the goal needs directly (the Smelter itself may still use everything else).
 */
export function reserved(s: GameState): Partial<Record<ItemId, number>> {
  if (s.stats.sold < 1 || !s.flags.holdForGoal) return {};
  return structureGoal(s)?.cost.items ?? {};
}

export const reservedQty = (s: GameState, item: ItemId): number => reserved(s)[item] ?? 0;

/**
 * Ore the Smelter needs to turn into the Plate the goal is short of. Selling keeps it back so one tap of
 * Sell cannot starve the Smelter; the Smelter itself is allowed to use it.
 */
export function smeltFeedReserve(s: GameState): number {
  if (!s.smelter.built || !s.smelter.on || s.stats.sold < 1) return 0;
  const need = reservedQty(s, 'plate');
  const short = Math.max(0, need - Math.floor(s.items.plate));
  return short * SMELTER.batchIn;
}

/** Units of an item the Smelter may use right now (only the goal's own materials are off limits). */
export const smeltableQty = (s: GameState, item: ItemId): number =>
  Math.max(0, Math.floor(s.items[item]) - reservedQty(s, item));

/** Units of an item the player can sell right now. */
export const availableQty = (s: GameState, item: ItemId): number =>
  Math.max(0, Math.floor(s.items[item]) - reservedQty(s, item) - (item === 'ore' ? smeltFeedReserve(s) : 0));

/** Items the Sell button handles (Core Shards are kept). */
export const SELLABLE: readonly ItemId[] = ['ore', 'ice', 'plate', 'coolant', 'circuit'];

/** Credits selling the given items (default: all sellable) would pay right now. */
export function sellValue(s: GameState, items: readonly ItemId[] = SELLABLE): number {
  return SELLABLE.reduce((sum, item) => sum + (items.includes(item) ? availableQty(s, item) * PRICES[item] : 0), 0);
}
