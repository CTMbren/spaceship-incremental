import type { Cost, HullDef } from '../core/types';

/**
 * Tile n (4..18) costs round5(60 * 1.17^(n-4)) credits plus materials.
 * Tuned with the headless economy sim (see docs/economy-and-details.md).
 */
const MATS: Record<number, NonNullable<Cost['items']>> = {
  4: { ore: 4 },
  5: { ore: 6 },
  6: { ore: 8 },
  7: { ore: 6, plate: 2 },
  8: { ore: 8, plate: 3 },
  9: { ore: 10, plate: 4 },
  // Patch 10.1: lighter material gates from tile 10 on (Brendan could not reach the later tiles)
  10: { plate: 4, ice: 2 },
  11: { plate: 5, ice: 3 },
  12: { plate: 6, coolant: 2 },
  13: { plate: 6, circuit: 1 },
  14: { plate: 8, circuit: 2 },
  15: { plate: 8, circuit: 2 },
  16: { circuit: 3 },
  17: { circuit: 4 },
  18: { circuit: 5, core_shard: 1 },
};

/** Credit curve (Patch 10.1: growth x1.23 -> x1.17; tile 18 costs 540 instead of 1,090, about 3,355 in all). */
export const TILE_BASE = 60;
export const TILE_GROWTH = 1.17;

const tileCosts: Cost[] = [];
for (let n = 4; n <= 18; n++) {
  tileCosts.push({
    credits: Math.round((TILE_BASE * Math.pow(TILE_GROWTH, n - 4)) / 5) * 5,
    items: MATS[n],
  });
}

/**
 * Hull 1 "Tug": 18 cells, 11 edge + 7 interior. Starts as the centre column (2,0)-(2,2).
 *   . X X . .
 *   . X X X .
 *   X X X X X
 *   X X X X X
 *   . X X X .
 */
export const HULL_TUG: HullDef = {
  id: 'tug',
  name: 'Tug',
  template: [
    { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
    { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
    { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
    { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 },
  ],
  startCells: [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
  tileCosts,
};

/**
 * Day 12: Hull 2 "Hauler", 28 cells, made from the Tug at the Dry Dock (Station Halcyon). A superset of the Tug:
 * the stern grows two rows, so every owned tile and module stays where it is.
 *   . X X . .
 *   . X X X .
 *   X X X X X
 *   X X X X X
 *   X X X X X   <- row 4 widened
 *   X X X X X   <- new
 *   . X X X .   <- new
 * Tiles 19-28 grow 8% each from tile 18's price and ask for planet goods and Circuits.
 */
const HAULER_MATS: Record<number, NonNullable<Cost['items']>> = {
  19: { plate: 8, sand: 4 },
  20: { plate: 8, sand: 4 },
  21: { plate: 10, resin: 3 },
  22: { plate: 10, resin: 3 },
  23: { circuit: 2, sand: 6 },
  24: { circuit: 2, sand: 6 },
  25: { circuit: 3, resin: 5 },
  26: { circuit: 3, resin: 5 },
  27: { circuit: 4, coolant: 4 },
  28: { circuit: 5, core_shard: 1 },
};
export const HAULER_GROWTH = 1.08;
const tile18 = tileCosts[tileCosts.length - 1].credits;
const haulerCosts: Cost[] = [...tileCosts];
for (let n = 19; n <= 28; n++) {
  haulerCosts.push({ credits: Math.round((tile18 * Math.pow(HAULER_GROWTH, n - 18)) / 5) * 5, items: HAULER_MATS[n] });
}

export const HULL_HAULER: HullDef = {
  id: 'hauler',
  name: 'Hauler',
  template: [
    ...HULL_TUG.template,
    { x: 0, y: 4 }, { x: 4, y: 4 },
    { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 },
    { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 },
  ],
  startCells: HULL_TUG.startCells,
  tileCosts: haulerCosts,
};

export const HULLS: Record<string, HullDef> = { [HULL_TUG.id]: HULL_TUG, [HULL_HAULER.id]: HULL_HAULER };
