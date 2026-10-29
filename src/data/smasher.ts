import type { Cost } from '../core/types';

/**
 * Rock Smasher (the old Crusher tile). Works rocks in parallel with the player's hands.
 * Rate is HP per second; a 35 HP dust rock takes 13.0 s / 10.1 s / 7.8 s / 6.1 s by level.
 * Patch 7.2: every level +20% (2.25 -> 2.7 ...) so idle play and offline returns bring more Ore.
 */
export const SMASHER = {
  /** Structure cost, paid in materials: 8 Plate (needs the Smelter). */
  repair: { credits: 0, items: { plate: 8 } } as Cost,
  levels: [
    { hpPerSec: 2.7, queue: 2, cost: { credits: 0 } as Cost },
    { hpPerSec: 3.45, queue: 3, cost: { credits: 150 } as Cost },
    { hpPerSec: 4.5, queue: 4, cost: { credits: 450 } as Cost },
    { hpPerSec: 5.7, queue: 5, cost: { credits: 1350 } as Cost },
  ],
  /** Level at which a touching Beam feeds plain rocks straight into the queue. */
  autoIntakeLevel: 2,
} as const;
