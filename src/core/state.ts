import { BAL } from '../data/balance';
import { HULL_TUG } from '../data/hulls';
import { cellKey } from './hull';
import { initialJobs } from './jobs';
import { initialRover } from './rover';
import type { GameState, ItemId } from './types';

export const SAVE_VERSION = 12;
export const ITEM_IDS: readonly ItemId[] = ['ore', 'ice', 'plate', 'coolant', 'circuit', 'core_shard', 'sand', 'resin'];

export function createInitialState(seed = 1): GameState {
  const items = Object.fromEntries(ITEM_IDS.map((i) => [i, 0])) as Record<ItemId, number>;
  return {
    version: SAVE_VERSION,
    credits: BAL.startCredits,
    items,
    ship: {
      hullId: HULL_TUG.id,
      ownedCells: HULL_TUG.startCells.map(cellKey),
      modules: [
        { uid: 1, defId: 'beam', cell: '2,0' },
        { uid: 2, defId: 'smasher', cell: '2,1' },
      ],
    },
    rng: seed,
    beams: [{ uid: 1, kind: 'tractor', status: 'idle', remaining: 0, level: 1 }],
    bay: [],
    crusher: { rock: null, heat: 0, lockout: 0, holding: false, holdT: 0, holdAcc: 0, weakT: 0, weakX: 0, weakY: 0 },
    smashers: [{ uid: 2, paid: { credits: 0 }, repaired: false, level: 1, queue: [] }],
    smelters: [],
    melters: [],
    fabs: [],
    rover: initialRover((seed ^ 0x50e) >>> 0),
    station: { paints: [], paint: null },
    handLevel: 1,
    stats: { rocks: 0, geodes: 0, sold: 0, taps: 0, holdTicks: 0, sent: 0, smashed: 0, overheats: 0, smelted: 0, melted: 0, fabbed: 0 },
    pity: 0,
    flags: { tappedBeam: false, usedHold: false, holdForGoal: true, powerNotice: 0 },
    travel: { node: 0, dest: null, progress: 0, visited: [0] },
    jobs: initialJobs(seed ^ 0x5eed),
    savedAt: 0,
  };
}
