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

export interface Rock {
  kind: 'dust';
  geode: boolean;
  hp: number;
  maxHp: number;
  ore: number;
}

export interface BeamState {
  /** idle: waiting for a tap. counting: countdown running. blocked: arrived but the Bay is full. */
  status: 'idle' | 'counting' | 'blocked';
  remaining: number;
}

export interface CrusherState {
  rock: Rock | null;
  heat: number;
  /** Seconds left of overheat lockout. */
  lockout: number;
  /** Position inside the weak-point cycle (seconds). Visible while < BAL.weak.active. */
  weakT: number;
  /** Weak point offset from the rock centre, in rock radii. */
  weakX: number;
  weakY: number;
}

export interface Stats {
  rocks: number;
  geodes: number;
  sold: number;
  taps: number;
}

export interface GameState {
  version: number;
  credits: number;
  items: Record<ItemId, number>;
  ship: ShipState;
  /** Seeded RNG state (mulberry32) so the core stays deterministic and saveable. */
  rng: number;
  beams: BeamState[];
  bay: Rock[];
  crusher: CrusherState;
  stats: Stats;
  /** Geodes opened since the last guaranteed Core Shard. Persists across Jump. */
  pity: number;
  flags: { tappedBeam: boolean };
}

export type GameEvent =
  | { kind: 'rock_arrived'; geode: boolean }
  | { kind: 'beam_blocked' }
  | { kind: 'hit'; crit: boolean }
  | { kind: 'overheat' }
  | { kind: 'crushed'; ore: number; geode: boolean; credits: number; shard: boolean }
  | { kind: 'sold'; item: ItemId; qty: number; credits: number };
