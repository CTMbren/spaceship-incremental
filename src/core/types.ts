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

export type ModuleId = 'beam' | 'smasher' | 'smelter' | 'solar' | 'engine' | 'grapple' | 'winch';

/** A module sitting on one owned tile (1x1 modules only until footprints arrive). */
export interface ModuleInstance {
  uid: number;
  defId: ModuleId;
  /** Owned-cell key "x,y". */
  cell: string;
  /** Level of modules with no unit state of their own (Solar Wing, Engine). Default 1. */
  level?: number;
  /** What it cost to build (sell refund) for modules with no unit state of their own (Solar, Engine, Grapple). */
  paid?: Cost;
}

export interface ShipState {
  hullId: string;
  /** Owned cells as "x,y" keys. Plain data so it saves with JSON.stringify. */
  ownedCells: string[];
  modules: ModuleInstance[];
}

export type RockKind = 'dust' | 'ice' | 'heavy' | 'big';

export interface Rock {
  kind: RockKind;
  geode: boolean;
  hp: number;
  maxHp: number;
  ore: number;
  /** Ice it holds (Ice chunks and Heavy rocks). Missing means 0 (older saves). */
  ice?: number;
}

export interface BeamState {
  /** Module uid of the beam's tile (a Tractor Beam or a Grapple Beam module). */
  uid: number;
  /** tractor: fast, small rocks. grapple: slow, one big rock (Heavy rocks with Ice from the Rubble Belt on). */
  kind: 'tractor' | 'grapple';
  /** idle: waiting for a tap. counting: countdown running. blocked: arrived but the Bay is full. */
  status: 'idle' | 'counting' | 'blocked';
  remaining: number;
  /** Level 1..4. Tractor: richer rocks. Grapple: shorter countdown. */
  level: number;
}

/** A job on the Job Board (Day 9): materials wanted, what has been handed over, and the pay. */
export interface Job {
  kind: 'quick' | 'standard' | 'local';
  client: string;
  /** Local jobs only: the route node where it can be delivered. */
  node?: number;
  wants: Partial<Record<ItemId, number>>;
  delivered: Partial<Record<ItemId, number>>;
  credits: number;
  rep: number;
}

export interface JobsState {
  unlocked: boolean;
  /** Reputation earned (ranks are derived from it). */
  rep: number;
  /** Highest rank whose one-time gifts were handed out. */
  rankPaid: number;
  /** The board's own RNG (mulberry32 state), separate from rocks. */
  seed: number;
  slots: (Job | null)[];
  /** Seconds of play until an empty slot gets a new job. */
  refill: number[];
  /** Seconds until each slot's free Skip is back. */
  skipCd: number[];
  /** Production per minute (exponential average) that sizes jobs, and the counters it is built from. */
  rate: Partial<Record<ItemId, number>>;
  made: Partial<Record<ItemId, number>>;
  seen: Partial<Record<ItemId, number>>;
  done: number;
}

/** Where the ship is on the system route (Day 8). */
export interface TravelState {
  /** Index of the node the ship is at, or left from while cruising. */
  node: number;
  /** Node it is cruising to, or null when parked at `node`. */
  dest: number | null;
  /** Seconds of level-1 cruising done on the current leg. */
  progress: number;
  /** Nodes reached so far (index list, in order). */
  visited: number[];
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
  /** Module uid of the tile this unit sits on (ship.modules). */
  uid: number;
  /** What it cost to get (for the sell refund). The starting Smasher cost nothing. */
  paid: Cost;
  /** The starting Smasher begins Rusty (inert) and is repaired once; bought copies arrive repaired. */
  repaired: boolean;
  level: number; // 1..4
  /** Rocks waiting (and the one being smashed, at index 0). HP is the remaining HP. */
  queue: Rock[];
}

export interface SmelterState {
  /** Module uid of the tile this unit sits on (ship.modules). */
  uid: number;
  /** What it cost to build (for the sell refund). */
  paid: Cost;
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
  /** One unit per Smasher / Smelter module, in the order they were built. Shared Ore stock, separate levels. */
  smashers: SmasherState[];
  smelters: SmelterState[];
  /** Hand Tools level 1..4 (Workshop). */
  handLevel: number;
  stats: Stats;
  /** Geodes opened since the last guaranteed Core Shard. Persists across Jump. */
  pity: number;
  /**
   * holdForGoal: Sell and the Smelter keep back what the current goal needs (Cargo sheet switch).
   * powerNotice: Plate given to a ship that existed before power arrived (Day 8); the scene explains it once, then 0.
   */
  flags: { tappedBeam: boolean; usedHold: boolean; holdForGoal: boolean; powerNotice: number };
  travel: TravelState;
  jobs: JobsState;
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
  | { kind: 'smashed'; ore: number; ice?: number; uid?: number }
  | { kind: 'departed'; to: number }
  | { kind: 'jobs_open' }
  | { kind: 'job_posted'; slot: number }
  | { kind: 'job_progress'; slot: number }
  | { kind: 'job_done'; slot: number; credits: number; rep: number }
  | { kind: 'rank_up'; rank: number }
  | { kind: 'arrived'; node: number }
  | { kind: 'repaired' }
  | { kind: 'smelted'; plate: number; uid?: number }
  | { kind: 'built'; module: ModuleId }
  | { kind: 'module_sold'; module: ModuleId; credits: number }
  | { kind: 'module_moved'; module: ModuleId }
  | { kind: 'upgraded'; what: 'beam' | 'smelter' | 'smasher' | 'hand' | 'solar' | 'engine'; level: number }
  | { kind: 'smasher_upgraded'; level: number }
  | { kind: 'crushed'; ore: number; ice?: number; geode: boolean; credits: number; shard: boolean }
  | { kind: 'sold'; item: ItemId; qty: number; credits: number };
