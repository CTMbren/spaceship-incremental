import type { Cost, HullDef } from '../core/types';

/**
 * Tile n (4..18) costs round5(60 * 1.23^(n-4)) credits plus materials.
 * Tuned with the headless economy sim (see docs/economy-and-details.md).
 */
const MATS: Record<number, NonNullable<Cost['items']>> = {
  4: { ore: 4 },
  5: { ore: 6 },
  6: { ore: 8 },
  7: { ore: 6, plate: 2 },
  8: { ore: 8, plate: 3 },
  9: { ore: 10, plate: 4 },
  10: { plate: 6, ice: 3 },
  11: { plate: 8, ice: 4 },
  12: { plate: 10, coolant: 5 },
  13: { plate: 12, circuit: 2 },
  14: { plate: 14, circuit: 3 },
  15: { plate: 16, circuit: 4 },
  16: { circuit: 5 },
  17: { circuit: 6 },
  18: { circuit: 8, core_shard: 1 },
};

const tileCosts: Cost[] = [];
for (let n = 4; n <= 18; n++) {
  tileCosts.push({
    credits: Math.round((60 * Math.pow(1.23, n - 4)) / 5) * 5,
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

export const HULLS: Record<string, HullDef> = { [HULL_TUG.id]: HULL_TUG };
