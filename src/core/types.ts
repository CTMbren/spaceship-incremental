export type ItemId = 'ore' | 'ice' | 'plate' | 'coolant' | 'circuit' | 'core_shard';

export interface Cell {
  x: number;
  y: number;
}

export type Cost = {
  credits: number;
  items?: Partial<Record<ItemId, number>>;
};

/** A hull is a fixed silhouette; the player owns a growing subset of it. */
export interface HullDef {
  id: string;
  name: string;
  /** Every cell the finished hull can ever contain. */
  template: Cell[];
  /** Cells owned at the start (e.g. a 1x3 column). */
  startCells: Cell[];
  /** Cost of the Nth tile, indexed by (ownedCount - startCells.length). */
  tileCosts: Cost[];
}

export interface ShipState {
  hullId: string;
  /** Owned cells as "x,y" keys. Plain data so it saves with JSON.stringify. */
  ownedCells: string[];
}

export interface GameState {
  version: number;
  credits: number;
  items: Record<ItemId, number>;
  ship: ShipState;
}
