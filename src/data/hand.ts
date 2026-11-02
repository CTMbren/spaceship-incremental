import type { Cost } from '../core/types';

/** Hand Tools: the player's own skill upgrades (Workshop). Cost base 40, x1 x3 x9. */
export const HAND = {
  levels: [
    { name: 'Bare Hands', blurb: 'Your own two hands', cost: { credits: 0 } as Cost, dmgMul: 1, heatMax: 100, cool: 12, lockout: 2, jackpotMul: 1 },
    { name: 'Hardened Teeth', blurb: 'Hits 25% harder', cost: { credits: 40 } as Cost, dmgMul: 1.25, heatMax: 100, cool: 12, lockout: 2, jackpotMul: 1 },
    { name: 'Heat Baffles', blurb: 'Heat cap 120, cools faster, shorter jam', cost: { credits: 120 } as Cost, dmgMul: 1.25, heatMax: 120, cool: 15, lockout: 1.5, jackpotMul: 1 },
    { name: 'Jackpot Drum', blurb: 'Geode jackpots pay 25% more', cost: { credits: 360 } as Cost, dmgMul: 1.25, heatMax: 120, cool: 15, lockout: 1.5, jackpotMul: 1.25 },
    { name: 'Shock Gauntlet', blurb: 'Hits 50% harder than bare hands', cost: { credits: 1080 } as Cost, dmgMul: 1.5, heatMax: 120, cool: 15, lockout: 1.5, jackpotMul: 1.25 },
    { name: 'Cryo Grip', blurb: 'Heat cap 150, cools much faster, 1 s jam', cost: { credits: 3240 } as Cost, dmgMul: 1.5, heatMax: 150, cool: 20, lockout: 1, jackpotMul: 1.25 },
  ],
} as const;
