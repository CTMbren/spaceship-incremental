import type { ItemId } from '../core/types';

/** All core-loop numbers. Rock-grain rebalance applied (rocks take ~1.75x longer to break). */
export const BAL = {
  baySlots: 3,
  beamCountdown: 4, // seconds, Tractor Beam level 1
  rock: { dust: { hp: 14, ore: 4 } },
  geode: {
    rate: 0.08, // chance any rock is a geode
    hpMul: 1.5,
    jackpotOreMul: 19, // credits = ore * oreprice * this (about 76)
    shardChance: 0.04,
    pity: 12, // every 12th geode is guaranteed to hold a Core Shard
  },
  weak: {
    cycle: 1.2, // a weak point cycle, seconds
    active: 0.8, // visible part of the cycle
    hitRadius: 0.62, // as a fraction of the rock radius
    maxOffset: 0.55, // how far from the rock centre it can appear
    dmg: 3,
  },
  tapDmg: 1,
  hold: {
    delay: 0.18, // seconds before a held finger starts auto-tapping (below the iOS long-press menu)
    rate: 4, // auto-taps per second
    dmg: 1,
    slack: 30, // px beyond the rock radius the finger may drift before the hold ends (scene)
  },
  heat: {
    perTap: 3,
    perHoldTick: 4,
    onWeakHit: -6,
    cool: 12, // per second, only while not holding
    max: 100,
    lockout: 2,
    resetTo: 40,
  },
  startCredits: 120,
} as const;

export const PRICES: Record<ItemId, number> = {
  ore: 1, ice: 3, plate: 8, coolant: 16, circuit: 60, core_shard: 150,
};
