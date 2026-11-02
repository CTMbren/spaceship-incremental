import type { Cost, ItemId } from '../core/types';

/**
 * Day 11: the Rover (docs/travel-shop-rover-jump-plan.md, Session 3). At a planet Orbit the Rover Bay sends a
 * Rover down to one of three Sites. One trip at a time, no fail states. Sites never run out; rare finds are
 * limited by trip time and a pity counter. All Rover numbers live here.
 */
export type SiteId = 'dunes' | 'crater' | 'ruins';
export type AttachmentId = 'drill' | 'wheels' | 'cargo' | 'battery' | 'scanner';

export interface SiteDef {
  name: string;
  /** Trip length, seconds (before Wheels). */
  sec: number;
  blurb: string;
  /** Common finds: [min, max] per trip, rolled from the trip seed. */
  gives: Partial<Record<ItemId, [number, number]>>;
  /** Extra finds that may turn up (chance per trip, how many). */
  chance?: { item: ItemId; p: number; n: number }[];
}

export const SITES: Record<SiteId, SiteDef> = {
  dunes: {
    name: 'Dunes', sec: 4 * 60, blurb: 'Glass Sand and old hull Plate.',
    gives: { sand: [6, 9], plate: [4, 6] },
  },
  crater: {
    name: 'Crater', sec: 8 * 60, blurb: 'Ore, Ice, Amber Resin, sometimes a Circuit.',
    gives: { ore: [40, 60], ice: [10, 16], resin: [2, 4] },
    chance: [{ item: 'circuit', p: 0.5, n: 1 }],
  },
  ruins: {
    name: 'Ruins', sec: 15 * 60, blurb: 'Amber Resin, Relics and a chance of a Core Shard.',
    gives: { resin: [4, 7], sand: [3, 5] },
  },
};

export const SITE_IDS: readonly SiteId[] = ['dunes', 'crater', 'ruins'];

export const RUINS = {
  /** Base chance of a Core Shard per Ruins trip; a hit resets the pity counter. */
  shardChance: 0.05,
  /** Every Nth Ruins trip without a Shard is guaranteed one. */
  shardPity: 6,
  /** Every Nth Ruins trip brings home a Relic, sold to collectors for this many credits. */
  relicEvery: 2,
  relicCredits: 150,
  /** The first Ruins trip finds an old fleet cache. */
  firstVisitCredits: 400,
} as const;

export interface AttachmentDef {
  name: string;
  blurb: string;
  cost: Cost;
}

/** Attachments: bought once, then any 3 fit on the Rover (swap while it is home). */
export const ATTACHMENTS: Record<AttachmentId, AttachmentDef> = {
  drill: { name: 'Drill', blurb: '+25% of every common find', cost: { credits: 0, items: { plate: 8, sand: 6 } } },
  wheels: { name: 'Wheels', blurb: 'Trips take 25% less time', cost: { credits: 0, items: { plate: 6, sand: 8 } } },
  cargo: { name: 'Cargo Rack', blurb: '+2 of every common find (best on short trips)', cost: { credits: 0, items: { plate: 10, resin: 4 } } },
  battery: { name: 'Battery', blurb: '+50% of every common find on Crater and Ruins trips', cost: { credits: 0, items: { circuit: 2, resin: 6 } } },
  scanner: { name: 'Scanner', blurb: 'Shows gold pings: tap one in time for a Rare Crate', cost: { credits: 0, items: { circuit: 2, sand: 4, resin: 2 } } },
};

export const ATTACHMENT_IDS: readonly AttachmentId[] = ['drill', 'wheels', 'cargo', 'battery', 'scanner'];

export const ROVER = {
  slots: 3,
  drillMul: 1.25,
  wheelsMul: 0.75,
  cargoFlat: 2,
  batteryMul: 1.5,
  /** Battery counts on trips at least this long (Crater and Ruins). */
  batteryMinSec: 8 * 60,
  /** Recall brings the Rover home now with this share of the common finds (no Relic, Shard or cache). */
  recallShare: 0.5,
  /** Scanner pings: the first comes this many trip-seconds in (random in range), then one every interval. */
  ping: { first: [30, 90] as [number, number], every: [60, 120] as [number, number], window: 8 },
  /** What a Rare Crate holds. */
  crate: { credits: 80, items: { sand: 3, resin: 3 } as Partial<Record<ItemId, number>> },
} as const;
