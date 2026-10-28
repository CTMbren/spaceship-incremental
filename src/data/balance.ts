import type { ItemId } from '../core/types';

/** All core-loop numbers. Tuned from docs/economy-and-details.md; change here, not in code. */
export const BAL = {
  baySlots: 3,
  beamCountdown: 4, // seconds, Tractor Beam level 1
  rock: { dust: { hp: 8, ore: 3 } },
  geode: {
    rate: 0.08, // chance any rock is a geode
    hpMul: 1.5,
    jackpotOreMul: 25, // credits = ore * oreprice * this
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
  heat: { perTap: 5, onWeakHit: -8, cool: 15, max: 100, lockout: 2, resetTo: 50 },
  startCredits: 120,
} as const;

export const PRICES: Record<ItemId, number> = {
  ore: 1, ice: 3, plate: 8, coolant: 16, circuit: 60, core_shard: 150,
};
