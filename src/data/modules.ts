import type { Cost, ItemId } from '../core/types';

/**
 * Buildable modules (all 1x1 for now; 2-tile footprints are a later slice). Credits buy speed, materials buy
 * structure. `costs` lists the price of each copy; its length is the cap per ship.
 * Placement: 'edge' needs a side facing open space, 'rear' needs its back (the right side on screen) open.
 */
export const MODULES = {
  beam: {
    name: 'Tractor Beam',
    placement: 'edge' as const, // needs a side facing empty space
    /** Cost of the Nth beam (index 0 is the free starting beam). */
    costs: [
      { credits: 0 },
      { credits: 60, items: { ore: 10 } },
      { credits: 140, items: { plate: 6 } },
    ] as Cost[],
  },
  /**
   * Smelter copies: #1 is the tutorial price; #2 and #3 follow about x3 (Brendan: "120, 360, 1000").
   * The list length is the cap per ship.
   */
  smelter: {
    name: 'Smelter',
    placement: 'any' as const,
    costs: [
      { credits: 0, items: { ore: 25 } },
      { credits: 120, items: { plate: 4 } },
      { credits: 360, items: { plate: 10 } },
    ] as Cost[],
  },
  /** Smasher copies: #1 comes with the ship (it starts Rusty); bought copies arrive repaired. */
  smasher: {
    name: 'Rock Smasher',
    placement: 'any' as const,
    costs: [
      { credits: 0 },
      { credits: 500, items: { plate: 8 } },
      { credits: 1200, items: { plate: 20 } },
    ] as Cost[],
  },
  /** Day 8: power. Each wing powers modules within its reach. */
  solar: {
    name: 'Solar Wing',
    placement: 'edge' as const,
    costs: [
      { credits: 0, items: { plate: 6 } },
      { credits: 0, items: { plate: 6 } },
      { credits: 0, items: { plate: 8 } },
      { credits: 0, items: { plate: 10 } },
      { credits: 0, items: { plate: 12 } },
      { credits: 0, items: { plate: 14 } },
    ] as Cost[],
  },
  /** Day 8: travel. One per ship. */
  engine: {
    name: 'Engine',
    placement: 'rear' as const,
    costs: [{ credits: 0, items: { plate: 12 } }] as Cost[],
  },
  /** Day 8: Heavy rocks and Ice. Offered once the ship reaches the Rubble Belt. */
  grapple: {
    name: 'Grapple Beam',
    placement: 'edge' as const,
    costs: [
      { credits: 0, items: { plate: 10, ore: 8 } },
      { credits: 200, items: { plate: 16, ore: 12 } },
    ] as Cost[],
  },
  /** Day 9: first automation, a Contractor-rank reward. Fires every idle beam touching it, as soon as the Bay has room. */
  winch: {
    name: 'Auto-Winch',
    placement: 'any' as const,
    costs: [
      { credits: 0, items: { plate: 14 } },
      { credits: 300, items: { plate: 20 } },
    ] as Cost[],
  },
  /** Day 10: Ice Melter. Offered at the Rubble Belt once the hull has 10 tiles (tile 12 needs Coolant). */
  melter: {
    name: 'Ice Melter',
    placement: 'any' as const,
    costs: [
      { credits: 0, items: { plate: 12, ice: 6 } },
      { credits: 150, items: { plate: 10, ice: 6 } },
      { credits: 450, items: { plate: 20, ice: 10 } },
    ] as Cost[],
  },
  /** Day 10: Fabricator. Offered once an Ice Melter is built (tiles 13-18 need Circuits). 1x1 until 2-tile footprints arrive. */
  fab: {
    name: 'Fabricator',
    placement: 'any' as const,
    costs: [
      { credits: 0, items: { plate: 20, coolant: 4 } },
      { credits: 400, items: { plate: 30, coolant: 8 } },
    ] as Cost[],
  },
  /** Day 11: the Rover Bay. One per ship, offered once the ship reaches a planet Orbit (Veda). 1x1 until footprints. */
  rover: {
    name: 'Rover Bay',
    placement: 'edge' as const, // the Rover needs a door to open space
    costs: [{ credits: 0, items: { plate: 12, circuit: 2 } }] as Cost[],
  },
} as const;

/** Share of a module's price (and its upgrade credits) paid back when it is sold. */
export const SELL_REFUND = 0.75;

/** Tractor Beam levels: each level makes every rock from that beam richer. Cost base 25, x1 x3 x9 x27 x81. */
export const BEAM = {
  levels: [
    { name: 'Hook', oreMul: 1, cost: { credits: 0 } as Cost },
    { name: 'Winch Line', oreMul: 1.25, cost: { credits: 25 } as Cost },
    { name: 'Twin Strand', oreMul: 1.5, cost: { credits: 75 } as Cost },
    { name: 'Gravity Lace', oreMul: 1.75, cost: { credits: 225 } as Cost },
    // Patch 10.1: two more levels everywhere (credits keep climbing about x3; late credits pile up otherwise)
    { name: 'Quantum Tether', oreMul: 2, cost: { credits: 675 } as Cost },
    { name: 'Singularity Lace', oreMul: 2.25, cost: { credits: 2025 } as Cost },
  ],
} as const;

/** Smelter turns raw Ore into Plate. Each level is +25% throughput. Cost base 40, x1 x3 x9. */
export const SMELTER = {
  batchIn: 3, // Ore
  batchOut: 1, // Plate
  levels: [
    { name: 'Furnace', secPerBatch: 6, cost: { credits: 0 } as Cost },
    { name: 'Draft Flue', secPerBatch: 4.8, cost: { credits: 40 } as Cost },
    { name: 'Slag Recycler', secPerBatch: 3.84, cost: { credits: 120 } as Cost },
    { name: 'Blast Chamber', secPerBatch: 3.07, cost: { credits: 360 } as Cost },
    { name: 'Arc Furnace', secPerBatch: 2.46, cost: { credits: 1080 } as Cost },
    { name: 'Plasma Crucible', secPerBatch: 1.97, cost: { credits: 3240 } as Cost },
  ],
} as const;

/**
 * Day 10 converters. Same rules as the Smelter: batches from the shared stock, never touching what the current
 * goal needs, x1 x3 x9 upgrade credits, each level about 25% faster.
 */
export const MELTER = {
  inputs: { ice: 2 } as Partial<Record<ItemId, number>>,
  output: 'coolant' as ItemId,
  outQty: 1,
  levels: [
    { name: 'Heat Coil', secPerBatch: 8, cost: { credits: 0 } as Cost },
    { name: 'Steam Jacket', secPerBatch: 6.4, cost: { credits: 100 } as Cost },
    { name: 'Pressure Still', secPerBatch: 5.12, cost: { credits: 300 } as Cost },
    { name: 'Plasma Kettle', secPerBatch: 4.1, cost: { credits: 900 } as Cost },
    { name: 'Cryo Loop', secPerBatch: 3.28, cost: { credits: 2000 } as Cost },
    { name: 'Comet Forge', secPerBatch: 2.62, cost: { credits: 4500 } as Cost },
  ],
} as const;

export const FAB = {
  inputs: { plate: 2, coolant: 1 } as Partial<Record<ItemId, number>>,
  output: 'circuit' as ItemId,
  outQty: 1,
  levels: [
    { name: 'Bench Arm', secPerBatch: 20, cost: { credits: 0 } as Cost },
    { name: 'Twin Claw', secPerBatch: 16, cost: { credits: 150 } as Cost },
    { name: 'Etch Line', secPerBatch: 12.8, cost: { credits: 450 } as Cost },
    { name: 'Clean Room', secPerBatch: 10.2, cost: { credits: 1350 } as Cost },
    { name: 'Photon Etcher', secPerBatch: 8.2, cost: { credits: 3000 } as Cost },
    { name: 'Nano Loom', secPerBatch: 6.5, cost: { credits: 6750 } as Cost },
  ],
} as const;

/** Hull tiles the ship needs before the Ice Melter is offered (at the Rubble Belt or later). */
export const MELTER_UNLOCK_TILES = 8; // Patch 10.1: was 10, so the Melter can be tried as soon as the ship reaches the Belt
