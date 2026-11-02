import type { Cost, ItemId } from '../core/types';

/**
 * Day 12: Station Halcyon (docs/travel-shop-rover-jump-plan.md, Session 4). The Trader buys refined goods for
 * more while you are docked, sells materials at a mark-up, and sells hull paints; the Dry Dock turns the Tug into
 * the bigger Hauler. Fixed stock, no timers, nothing expires.
 */
export const TRADER = {
  /** Refined and planet goods sell for this much more while docked at a Station. */
  sellBonus: 1.2,
  bonusItems: ['plate', 'coolant', 'circuit', 'sand', 'resin'] as ItemId[],
  /** Materials the Trader sells: credits each (about 1.5x their sell price), sold in packs. */
  // Sand and Resin too: the route only runs forward, so the Station is where planet goods come from after Veda
  buy: { ice: 5, plate: 12, coolant: 24, circuit: 90, sand: 8, resin: 18 } as Partial<Record<ItemId, number>>,
  pack: 5,
} as const;

export type PaintId = 'tug' | 'violet' | 'teal' | 'gold';

/** Hull paints: the accent stripe colour. Tug Orange is free; Fleet Gold comes with the Fleet Partner rank. */
export const PAINTS: Record<PaintId, { name: string; color: number; cost: Cost | null; blurb: string }> = {
  tug: { name: 'Tug Orange', color: 0xf0704a, cost: null, blurb: 'The colour she came in.' },
  violet: { name: 'Veda Violet', color: 0xa77bff, cost: { credits: 200, items: { sand: 6, resin: 4 } }, blurb: 'Mixed from Veda glass.' },
  teal: { name: 'Halcyon Teal', color: 0x2ee6d6, cost: { credits: 300, items: { resin: 8 } }, blurb: 'Station house colours.' },
  gold: { name: 'Fleet Gold', color: 0xffc83d, cost: null, blurb: 'Fleet Partner rank reward.' },
};
export const PAINT_IDS: readonly PaintId[] = ['tug', 'violet', 'teal', 'gold'];

/** Dry Dock: Tug (18 cells) to Hauler (28 cells, a superset, so nothing moves). */
export const DRY_DOCK = {
  // about 3 Dunes and 2 Ruins trips of planet goods after the attachments (bot pacing, Day 12)
  hauler: { credits: 1500, items: { plate: 40, sand: 12, resin: 8, core_shard: 2 } } as Cost,
} as const;
