import type { Cost } from '../core/types';

/** Buildable modules (1x1 until footprints arrive on Day 7). Credits buy speed, materials buy structure. */
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
} as const;

/** Share of a module's price (and its upgrade credits) paid back when it is sold. */
export const SELL_REFUND = 0.75;

/** Tractor Beam levels: each level makes every rock from that beam richer. Cost base 25, x1 x3 x9. */
export const BEAM = {
  levels: [
    { name: 'Hook', oreMul: 1, cost: { credits: 0 } as Cost },
    { name: 'Winch Line', oreMul: 1.25, cost: { credits: 25 } as Cost },
    { name: 'Twin Strand', oreMul: 1.5, cost: { credits: 75 } as Cost },
    { name: 'Gravity Lace', oreMul: 1.75, cost: { credits: 225 } as Cost },
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
  ],
} as const;
