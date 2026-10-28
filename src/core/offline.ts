import { OFFLINE } from '../data/offline';
import { canSend, sendToSmasher, tapAllBeams, tick } from './loop';
import { ITEM_IDS } from './state';
import type { GameState, ItemId } from './types';

export interface OfflineReport {
  /** Real time away, seconds (uncapped). */
  awaySec: number;
  /** Time that counts, after the 8 h cap. */
  countedSec: number;
  /** Seconds of normal-speed play the away time was worth (tiers applied). */
  effectiveSec: number;
  capped: boolean;
  /** Seconds counted at each tier rate, for the welcome-back copy. */
  tierSec: number[];
  rocksSmashed: number;
  /** Net item changes (can be negative, e.g. Ore turned into Plate). */
  items: Partial<Record<ItemId, number>>;
  /** Welcome-back hints. */
  smasherRusty: boolean;
  geodeWaiting: boolean;
}

/** Seconds of play that `awaySec` of real time is worth. Pure. */
export function effectiveSeconds(awaySec: number): { counted: number; effective: number; tierSec: number[] } {
  const counted = Math.min(Math.max(0, awaySec), OFFLINE.capSec);
  let from = 0;
  let effective = 0;
  const tierSec: number[] = [];
  for (const t of OFFLINE.tiers) {
    const span = Math.max(0, Math.min(counted, t.upToSec) - from);
    tierSec.push(span);
    effective += span * t.rate;
    from = t.upToSec;
  }
  return { counted, effective, tierSec };
}

/** Stamp the time the game was last seen (epoch ms; injected so core stays clock-free). */
export const stamp = (s: GameState, nowMs: number): GameState => ({ ...s, savedAt: nowMs });

/**
 * Hands-free play for `effective` seconds on the real rules: beams fire on their own, rocks go to the
 * Smasher, the Smelter runs. No geodes arrive (they need hands). Nothing is sold. With a Rusty Smasher the
 * ship only smelts what it already holds.
 */
function fastForward(start: GameState, effective: number): GameState {
  let s = start;
  const steps = Math.floor(effective / OFFLINE.stepSec);
  const rest = effective - steps * OFFLINE.stepSec;
  for (let i = 0; i <= steps; i++) {
    const dt = i < steps ? OFFLINE.stepSec : rest;
    if (dt <= 0) break;
    if (s.smasher.repaired) {
      if (s.crusher.rock && canSend(s).ok) s = sendToSmasher(s).state;
      s = tapAllBeams(s).state; // fires as many beams as the Bay has room for
    }
    s = tick(s, dt, false).state;
  }
  return s;
}

/**
 * Catch the game up to `nowMs`. Returns the new state (stamped `nowMs`) and a report, or a null report when
 * there is nothing to say (first run, clock went backwards, or away under the minimum).
 */
export function applyOffline(state: GameState, nowMs: number): { state: GameState; report: OfflineReport | null } {
  const stamped = stamp(state, nowMs);
  if (state.savedAt <= 0) return { state: stamped, report: null };
  const awaySec = (nowMs - state.savedAt) / 1000;
  if (awaySec < OFFLINE.minAwaySec) return { state: stamped, report: null };
  const { counted, effective, tierSec } = effectiveSeconds(awaySec);
  const after = stamp(fastForward(state, effective), nowMs);
  const items: Partial<Record<ItemId, number>> = {};
  for (const id of ITEM_IDS) {
    const d = after.items[id] - state.items[id];
    if (Math.abs(d) >= 1e-9) items[id] = Math.round(d * 1000) / 1000;
  }
  return {
    state: after,
    report: {
      awaySec,
      countedSec: counted,
      effectiveSec: effective,
      capped: awaySec > OFFLINE.capSec,
      tierSec,
      rocksSmashed: after.stats.smashed - state.stats.smashed,
      items,
      smasherRusty: !state.smasher.repaired,
      geodeWaiting: !!after.crusher.rock?.geode,
    },
  };
}
