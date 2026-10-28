/** Offline catch-up (locked in docs/economy-and-details.md section 6). */
export const OFFLINE = {
  /** Away for less than this and nothing is counted (and no welcome-back). Seconds. */
  minAwaySec: 120,
  /** Hard cap on counted time. Seconds (8 h). */
  capSec: 8 * 3600,
  /** Share of normal progress while away, by how long you have been away. `upToSec` is cumulative. */
  tiers: [
    { upToSec: 2 * 3600, rate: 0.3 },
    { upToSec: 8 * 3600, rate: 0.1 },
  ],
  /** Fast-forward step (seconds). Coarse on purpose: offline is an abstraction, not a replay. */
  stepSec: 0.5,
} as const;
