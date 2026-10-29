import { PRICES } from '../data/balance';
import { SMELTER } from '../data/modules';
import { availableQty, reservedQty, SELLABLE, smeltFeedReserve, structureGoal, type StructureGoalId } from './reserve';
import type { GameState, ItemId } from './types';

/** `quick`: one tap sells everything (only Ore so far, before the Smelter). `cargo`: the Sell button opens the Cargo sheet. */
export type SellMode = 'quick' | 'cargo';

/** The Cargo sheet takes over once a second thing to sell is coming: the Smelter is built, or Plate already exists. */
export const sellMode = (s: GameState): SellMode =>
  s.smelters.length > 0 || s.stats.smelted > 0 || SELLABLE.some((k) => k !== 'ore' && s.items[k] > 0) ? 'cargo' : 'quick';

const GOAL_LABEL: Record<StructureGoalId, string> = {
  smelter: 'the Smelter',
  repair: 'the Smasher repair',
  solar: 'a Solar Wing',
  beam2: 'your next beam',
  engine: 'the Engine',
  grapple: 'the Grapple Beam',
  expand: 'the next hull tile',
};

export interface CargoRow {
  item: ItemId;
  count: number;
  price: number;
  /** Units the row's Sell button would sell now. */
  surplus: number;
  /** Units held back, and why ("Kept 8 for the Smasher repair"). */
  kept: number;
  keptNote: string;
  forSale: boolean;
  /** A short economy hint (smelting value) or ''. */
  tip: string;
}

const owned = (s: GameState, item: ItemId): boolean => {
  if (item === 'ore') return s.items.ore > 0 || s.stats.rocks > 0;
  if (item === 'plate') return s.items.plate > 0 || s.stats.smelted > 0;
  return s.items[item] > 0;
};

/** One row per item the player has owned, in price order, Shards last (not for sale). */
export function cargoRows(s: GameState): CargoRow[] {
  const goal = structureGoal(s);
  const why = goal ? GOAL_LABEL[goal.id] : 'your goal';
  const rows: CargoRow[] = [];
  for (const item of SELLABLE) {
    if (!owned(s, item)) continue;
    const count = Math.floor(s.items[item]);
    const surplus = availableQty(s, item);
    const direct = Math.min(count, reservedQty(s, item));
    const feed = item === 'ore' ? Math.min(count - direct, smeltFeedReserve(s)) : 0;
    const kept = count - surplus;
    let keptNote = '';
    if (direct > 0 && feed > 0) keptNote = `Kept ${direct} for ${why}, ${feed} to make Plate`;
    else if (direct > 0) keptNote = `Kept ${direct} for ${why}`;
    else if (feed > 0) keptNote = `Kept ${feed} to make Plate for ${why}`;
    const tip = item === 'ore' && s.smelters.length > 0 && count > 0
      ? `Smelter: ${SMELTER.batchIn} Ore makes ${SMELTER.batchOut} Plate worth ${SMELTER.batchOut * PRICES.plate} credits`
      : '';
    rows.push({ item, count, price: PRICES[item], surplus, kept, keptNote, forSale: true, tip });
  }
  if (s.items.core_shard > 0) {
    rows.push({ item: 'core_shard', count: Math.floor(s.items.core_shard), price: PRICES.core_shard, surplus: 0, kept: 0, keptNote: '', forSale: false, tip: '' });
  }
  return rows;
}
