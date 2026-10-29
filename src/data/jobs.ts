import type { ItemId } from '../core/types';

export type JobKind = 'quick' | 'standard' | 'local';

/**
 * Job Board (Day 9, docs/job-board-and-reputation-plan.md). Jobs ask for materials and pay a premium over
 * selling, plus Reputation. Job size follows the player's own output so it never asks for an hour of work.
 */
export const JOBS = {
  /** Slots, in order. The Salvager rank adds a fourth (a Standard job). */
  slots: ['quick', 'standard', 'local'] as JobKind[],
  extraSlot: 'standard' as JobKind,
  kinds: {
    /** `minutes` of the player's output, times `share` (jobs should not eat everything you make). */
    quick: { minutes: 3, payMul: 1.3, rep: 1 },
    standard: { minutes: 8, payMul: 1.5, rep: 2 },
    local: { minutes: 6, payMul: 1.8, rep: 3 },
  } as Record<JobKind, { minutes: number; payMul: number; rep: number }>,
  /** Share of the player's output a job asks for (8 min x 0.35 of 30 Ore/min = about 85 Ore). */
  share: 0.35,
  /** Production per minute a job assumes at least (x floorMul), so a slow start still gets real jobs. */
  par: { ore: 30, plate: 4, ice: 4 } as Partial<Record<ItemId, number>>,
  floorMul: 0.7,
  /** Amounts round up to this step (5 Ore, not 47). Plate and Ice under 20 round to 1. */
  roundTo: 5,
  /** Seconds of play before an empty slot gets a new job. */
  refillSec: 10 * 60,
  /** A free Skip per slot, then this cooldown (seconds of play). */
  skipCooldownSec: 30 * 60,
  /** How fast the measured production rate follows changes (seconds; an exponential average). */
  rateWindowSec: 5 * 60,
} as const;

/** Reputation ranks. Reached once, never lost (they survive the Jump later). */
export const RANKS = [
  { name: 'Rookie', rep: 0, perk: '' },
  { name: 'Hauler', rep: 5, perk: 'The Bay holds one more rock' },
  { name: 'Salvager', rep: 14, perk: 'A fourth job slot, and jobs pay 10% more' },
  { name: 'Contractor', rep: 28, perk: 'Auto-Winch blueprint: a module that fires the beams next to it for you' },
  { name: 'Fleet Partner', rep: 50, perk: 'Gold hull trim and a Core Shard' },
] as const;

/** Rank numbers (index into RANKS) where each perk starts. */
export const RANK = { bay: 1, slot: 2, winch: 3, partner: 4 } as const;
/** Salvager and up: jobs pay this much more. */
export const SALVAGER_PAY = 1.1;

/** Who posts jobs. Local jobs come from the field the ship is parked at. */
export const CLIENTS = {
  generic: ['Dock repair crew', 'Tug union hall', 'Scrap broker', 'Hull welders', 'Relief convoy', 'Beacon keepers'],
  scrapyard: 'Scrapyard reclaimers',
  belt: "Belt miners' co-op",
  rings: 'Veda ring surveyors',
} as Record<string, string | string[]>;

/** What a Local job asks for at each field (shares of the job; the rest of the field's items do not appear). */
export const LOCAL_WANTS: Record<string, Partial<Record<ItemId, number>>> = {
  scrapyard: { ore: 1.5 },
  belt: { ice: 1, ore: 0.5 },
  rings: { plate: 1, ice: 1 },
};
