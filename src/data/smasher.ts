import type { Cost } from '../core/types';

/**
 * Rock Smasher (the old Crusher tile). Works rocks in parallel with the player's hands.
 * Rate is HP per second; a 14 HP dust rock takes 15.6 s / 12.2 s / 9.3 s / 7.4 s by level.
 */
export const SMASHER = {
  /**
   * INTERIM: the design is 8 Plate, but Plate needs the Smelter (Day 5). Until then repair costs Ore.
   * Switch to { credits: 0, items: { plate: 8 } } when the Smelter ships.
   */
  repair: { credits: 0, items: { ore: 24 } } as Cost,
  levels: [
    { hpPerSec: 0.9, queue: 2, cost: { credits: 0 } as Cost },
    { hpPerSec: 1.15, queue: 3, cost: { credits: 150 } as Cost },
    { hpPerSec: 1.5, queue: 4, cost: { credits: 450 } as Cost },
    { hpPerSec: 1.9, queue: 5, cost: { credits: 1350 } as Cost },
  ],
  /** Level at which a touching Beam feeds plain rocks straight into the queue. */
  autoIntakeLevel: 2,
} as const;
