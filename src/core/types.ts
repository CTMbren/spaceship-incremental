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

export type ModuleId = 'beam' | 'smasher' | 'smelter';

/** A module sitting on one owned tile (1x1 modules only until Day 7 adds footprints). */
export interface ModuleInstance {
  uid: number;
  defId: ModuleId;
  /** Owned-cell key "x,y". */
  cell: string;
}

export interface ShipState {
  hullId: string;
  /** Owned cells as "x,y" keys. Plain data so it saves with JSON.stringify. */
  ownedCells: string[];
  modules: ModuleInstance[];
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
  /** Tractor Beam level 1..4: richer rocks. Beam i belongs to the i-th beam module. */
  level: number;
}

export interface CrusherState {
  rock: Rock | null;
  heat: number;
  /** Seconds left of overheat lockout. */
  lockout: number;
  /** True while a finger is held on the rock past the hold delay (heat does not cool). */
  holding: boolean;
  /** Seconds the current hold has lasted, and the fractional auto-tap accumulator. */
  holdT: number;
  holdAcc: number;
  /** Position inside the weak-point cycle (seconds). Visible while < BAL.weak.active. */
  weakT: number;
  /** Weak point offset from the rock centre, in rock radii. */
  weakX: number;
  weakY: number;
}

export interface SmasherState {
  /** The old Crusher tile starts Rusty (inert) and is repaired once. */
  repaired: boolean;
  level: number; // 1..4
  /** Rocks waiting (and the one being smashed, at index 0). HP is the remaining HP. */
  queue: Rock[];
}

export interface SmelterState {
  built: boolean;
  level: number; // 1..4
  /** Player switch: when off the Smelter leaves Ore alone. */
  on: boolean;
  /** Progress through the current batch, 0..1. */
  progress: number;
}

export interface Stats {
  rocks: number;
  geodes: number;
  sold: number;
  taps: number;
  holdTicks: number;
  sent: number;
  smashed: number;
  overheats: number;
  smelted: number;
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
  /** The stage (hand-crushing) state. Named crusher for historical reasons. */
  crusher: CrusherState;
  smasher: SmasherState;
  smelter: SmelterState;
  /** Hand Tools level 1..4 (Workshop). */
  handLevel: number;
  stats: Stats;
  /** Geodes opened since the last guaranteed Core Shard. Persists across Jump. */
  pity: number;
  /** holdForGoal: Sell and the Smelter keep back what the current goal needs (Cargo sheet switch). */
  flags: { tappedBeam: boolean; usedHold: boolean; holdForGoal: boolean };
  /** Epoch ms the game was last seen (stamped by the scene when saving); 0 = never. Drives offline catch-up. */
  savedAt: number;
}

export type GameEvent =
  /** `to` says where the rock went: the Bay, or straight into the Smasher queue (auto-intake). */
  | { kind: 'rock_arrived'; geode: boolean; to?: 'bay' | 'smasher' }
  | { kind: 'beam_blocked' }
  | { kind: 'hit'; crit: boolean }
  | { kind: 'overheat' }
  | { kind: 'hold_tick' }
  | { kind: 'sent' }
  | { kind: 'smashed'; ore: number }
  | { kind: 'repaired' }
  | { kind: 'smelted'; plate: number }
  | { kind: 'built'; module: ModuleId }
  | { kind: 'upgraded'; what: 'beam' | 'smelter' | 'smasher' | 'hand'; level: number }
  | { kind: 'smasher_upgraded'; level: number }
  | { kind: 'crushed'; ore: number; geode: boolean; credits: number; shard: boolean }
  | { kind: 'sold'; item: ItemId; qty: number; credits: number };
