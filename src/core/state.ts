import { HULL_TUG } from '../data/hulls';
import { cellKey } from './hull';
import type { GameState, ItemId } from './types';

export const SAVE_VERSION = 1;
export const ITEM_IDS: readonly ItemId[] = ['ore', 'ice', 'plate', 'coolant', 'circuit', 'core_shard'];

export function createInitialState(): GameState {
  const items = Object.fromEntries(ITEM_IDS.map((i) => [i, 0])) as Record<ItemId, number>;
  return {
    version: SAVE_VERSION,
    credits: 120,
    items,
    ship: { hullId: HULL_TUG.id, ownedCells: HULL_TUG.startCells.map(cellKey) },
  };
}
