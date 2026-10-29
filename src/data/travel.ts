import type { Cost, RockKind } from '../core/types';

/** Where the beams pull rocks from: a weighted table for Tractor Beams and the one rock a Grapple pulls. */
export interface Zone {
  name: string;
  /** Tractor Beam rocks, weighted. A single entry costs no random draw. */
  tractor: { kind: RockKind; w: number }[];
  /** What a Grapple Beam pulls here ('big' where there are no Heavy rocks). */
  grapple: RockKind;
  /** Multiplies the Ore in every rock pulled here. */
  oreMul: number;
  /** Multiplies the geode chance. */
  geodeMul: number;
}

export interface RouteNode extends Zone {
  id: string;
  type: 'field' | 'orbit' | 'station' | 'jump';
  /** Seconds of cruising from the previous node at Engine level 1 (0 for the start). */
  legSec: number;
  /** False: shown on the Map but not reachable yet (later Days). */
  open: boolean;
  blurb: string;
}

/** System 1 "Cinder Reach" (provisional name). Leg times from docs/travel-shop-rover-jump-plan.md. */
export const SYSTEM = {
  id: 'cinder',
  name: 'Cinder Reach',
  nodes: [
    {
      id: 'scrapyard', name: 'Scrapyard Drift', type: 'field', legSec: 0, open: true,
      tractor: [{ kind: 'dust', w: 1 }], grapple: 'big', oreMul: 1, geodeMul: 1,
      blurb: 'Dust rocks. Where every tug starts.',
    },
    {
      id: 'belt', name: 'Rubble Belt', type: 'field', legSec: 6 * 60, open: true,
      tractor: [{ kind: 'dust', w: 0.8 }, { kind: 'ice', w: 0.2 }], grapple: 'heavy', oreMul: 1, geodeMul: 1,
      blurb: 'Ice chunks, and Heavy rocks for a Grapple Beam. Ice opens bigger hull tiles.',
    },
    {
      id: 'rings', name: 'Ring Fields of Veda', type: 'field', legSec: 10 * 60, open: true,
      tractor: [{ kind: 'dust', w: 0.75 }, { kind: 'ice', w: 0.25 }], grapple: 'heavy', oreMul: 1.25, geodeMul: 1.5,
      blurb: 'Richer rocks (+25% Ore) and more geodes.',
    },
    {
      id: 'orbit', name: 'Veda Orbit', type: 'orbit', legSec: 8 * 60, open: false,
      tractor: [{ kind: 'dust', w: 1 }], grapple: 'heavy', oreMul: 1, geodeMul: 1,
      blurb: 'A planet. Rover trips open here in a later update.',
    },
    {
      id: 'station', name: 'Station Halcyon', type: 'station', legSec: 8 * 60, open: false,
      tractor: [{ kind: 'dust', w: 1 }], grapple: 'heavy', oreMul: 1, geodeMul: 1,
      blurb: 'Trader and Dry Dock. Later update.',
    },
    {
      id: 'jump', name: 'Jump Point', type: 'jump', legSec: 8 * 60, open: false,
      tractor: [{ kind: 'dust', w: 1 }], grapple: 'heavy', oreMul: 1, geodeMul: 1,
      blurb: 'The edge of the system. The Jump comes in a later update.',
    },
  ] as RouteNode[],
} as const;

/** Between nodes the beams only find small drifting rocks at half yield, so leaving a good field costs you. */
export const VOID_DRIFT: Zone = {
  name: 'Void Drift', tractor: [{ kind: 'dust', w: 1 }], grapple: 'big', oreMul: 0.5, geodeMul: 1,
};

/** Engine levels: speed multiplier on cruising (-20% / -35% / -50% travel time). Cost base 60, x1 x3 x9. */
export const ENGINE = {
  levels: [
    { name: 'Ion Pusher', speed: 1, cost: { credits: 0 } as Cost },
    { name: 'Twin Nozzle', speed: 1.25, cost: { credits: 60 } as Cost },
    { name: 'Afterburner', speed: 1.54, cost: { credits: 180 } as Cost },
    { name: 'Fold Coil', speed: 2, cost: { credits: 540 } as Cost },
  ],
} as const;

/** Grapple Beam: slow countdown, one big rock (Heavy rocks with Ice from the Rubble Belt on). */
export const GRAPPLE = {
  countdown: 12, // seconds at level 1
  levels: [
    { name: 'Claw', cdMul: 1, cost: { credits: 0 } as Cost },
    { name: 'Steel Cable', cdMul: 0.85, cost: { credits: 80 } as Cost },
    { name: 'Twin Claw', cdMul: 0.72, cost: { credits: 240 } as Cost },
    { name: 'Mag Clamp', cdMul: 0.61, cost: { credits: 720 } as Cost },
  ],
} as const;
