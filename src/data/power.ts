import type { Cost, ModuleId } from '../core/types';

/**
 * Power (Day 8). The hull itself supplies a little power; Solar Wings add more but only reach modules a few
 * tiles away (path distance through owned tiles). A module is fully powered or not at all: unpowered = stopped.
 */
export const POWER = {
  /** Power the hull core supplies to any module, anywhere (used after the Solar Wings hand out theirs). */
  hullBase: 3,
  /** What each module draws while it is working. A Rusty Smasher or a Smelter switched OFF draws nothing. */
  draw: { beam: 1, grapple: 1, smasher: 1, smelter: 1, engine: 2, solar: 0, winch: 1 } as Record<ModuleId, number>,
  /** Boost: a powered module touching a Solar Wing works 15% faster (one Boost per module). */
  boost: 1.15,
} as const;

/** Solar Wing levels. Credits buy speed: L2 adds output, L3 adds reach. Cost base 30, x1 x3. */
export const SOLAR = {
  levels: [
    { name: 'Panel', output: 2, reach: 2, cost: { credits: 0 } as Cost },
    { name: 'Wide Wing', output: 3, reach: 2, cost: { credits: 30 } as Cost },
    { name: 'Tracker Array', output: 3, reach: 3, cost: { credits: 90 } as Cost },
  ],
} as const;
