import { PRICES } from '../data/balance';
import { sellPrice } from './station';
import { MELTER, SMELTER } from '../data/modules';

/** What an input is kept back to make (Cargo sheet note). */
const FEEDS_INTO: Partial<Record<ItemId, string>> = { ore: 'Plate', ice: 'Coolant', plate: 'Circuits', coolant: 'Circuits' };
import { availableQty, feedReserves, reservedQty, SELLABLE, structureGoal, type StructureGoalId } from './reserve';
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
  melter: 'the Ice Melter',
  fab: 'the Fabricator',
  rover: 'the Rover Bay',
  drydock: 'the Dry Dock',
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
  if (item === 'ice') return s.items.ice > 0 || s.melters.length > 0;
  if (item === 'coolant') return s.items.coolant > 0 || s.stats.melted > 0;
  if (item === 'circuit') return s.items.circuit > 0 || s.stats.fabbed > 0;
  return s.items[item] > 0;
};

/** One row per item the player has owned, in price order, Shards last (not for sale). */
export function cargoRows(s: GameState): CargoRow[] {
  const goal = structureGoal(s);
  const why = goal ? GOAL_LABEL[goal.id] : 'your goal';
  const rows: CargoRow[] = [];
  const feeds = feedReserves(s);
  for (const item of SELLABLE) {
    if (!owned(s, item)) continue;
    const count = Math.floor(s.items[item]);
    const surplus = availableQty(s, item);
    const direct = Math.min(count, reservedQty(s, item));
    const feed = Math.min(count - direct, feeds[item] ?? 0);
    const makes = FEEDS_INTO[item] ?? 'goods';
    const kept = count - surplus;
    let keptNote = '';
    if (direct > 0 && feed > 0) keptNote = `Kept ${direct} for ${why}, ${feed} to make ${makes}`;
    else if (direct > 0) keptNote = `Kept ${direct} for ${why}`;
    else if (feed > 0) keptNote = `Kept ${feed} to make ${makes} for ${why}`;
    let tip = '';
    if (item === 'ore' && s.smelters.length > 0 && count > 0) tip = `Smelter: ${SMELTER.batchIn} Ore makes ${SMELTER.batchOut} Plate worth ${SMELTER.batchOut * PRICES.plate} credits`;
    if (item === 'ice' && s.melters.length > 0 && count > 0) tip = `Ice Melter: ${MELTER.inputs.ice} Ice makes ${MELTER.outQty} Coolant worth ${PRICES.coolant} credits`;
    rows.push({ item, count, price: sellPrice(s, item), surplus, kept, keptNote, forSale: true, tip });
  }
  if (s.items.core_shard > 0) {
    rows.push({ item: 'core_shard', count: Math.floor(s.items.core_shard), price: PRICES.core_shard, surplus: 0, kept: 0, keptNote: '', forSale: false, tip: '' });
  }
  return rows;
}
