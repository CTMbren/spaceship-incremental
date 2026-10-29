import { OFFLINE } from '../data/offline';
import { ROUTE } from './travel';
import { canSend, sendToSmasher, tapAllBeams, tick } from './loop';
import { ITEM_IDS } from './state';
import { smasherReady } from './units';
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
  /** True when Smelters were running and went cold part-way through (Patch 7.2). */
  smeltersCooled: boolean;
  /** Names of the route nodes the ship reached while away (travel runs at full speed). */
  arrived: string[];
  /** Still cruising: seconds of real time left to the next node (null when parked or stalled). */
  stillCruising: boolean;
}

/** A stretch of time away with one production rate (and whether Smelters still run). */
export interface Segment {
  realSec: number;
  rate: number;
  smelt: boolean;
}

/**
 * Split the counted time away into stretches: the tier boundaries (30% then 10%) and the Smelter cut-off
 * (Smelters go cold after OFFLINE.smelterSec of real time). Pure.
 */
export function segments(countedSec: number): Segment[] {
  const cuts = new Set<number>([0, countedSec]);
  for (const t of OFFLINE.tiers) if (t.upToSec < countedSec) cuts.add(t.upToSec);
  if (OFFLINE.smelterSec < countedSec) cuts.add(OFFLINE.smelterSec);
  const pts = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (b - a <= 0) continue;
    const tier = OFFLINE.tiers.find((t) => a < t.upToSec) ?? OFFLINE.tiers[OFFLINE.tiers.length - 1];
    out.push({ realSec: b - a, rate: tier.rate, smelt: a < OFFLINE.smelterSec });
  }
  return out;
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
 * Hands-free play on the real rules, stretch by stretch: each stretch runs `realSec x rate` seconds of
 * production. Beams fire on their own, rocks go to the Smasher, Smelters run until they go cold. Travel runs at
 * full speed (one real second of cruising per real second away). No geodes arrive (they need hands). Nothing is
 * sold. With a Rusty Smasher the ship only smelts what it already holds.
 */
function fastForward(start: GameState, segs: Segment[]): { state: GameState; arrived: number[] } {
  let s = start;
  const arrived: number[] = [];
  for (const seg of segs) {
    const effective = seg.realSec * seg.rate;
    const opts = { travelMul: 1 / seg.rate, smelt: seg.smelt, trackRate: false };
    const steps = Math.floor(effective / OFFLINE.stepSec);
    const rest = effective - steps * OFFLINE.stepSec;
    for (let i = 0; i <= steps; i++) {
      const dt = i < steps ? OFFLINE.stepSec : rest;
      if (dt <= 1e-9) break;
      if (smasherReady(s)) {
        if (s.crusher.rock && canSend(s).ok) s = sendToSmasher(s).state;
        s = tapAllBeams(s).state; // fires as many beams as the Bay has room for
      }
      const out = tick(s, dt, false, opts);
      s = out.state;
      for (const e of out.events) if (e.kind === 'arrived') arrived.push(e.node);
    }
  }
  return { state: s, arrived };
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
  const ff = fastForward(state, segments(counted));
  const after = stamp(ff.state, nowMs);
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
      smasherRusty: !smasherReady(state),
      geodeWaiting: !!after.crusher.rock?.geode,
      smeltersCooled: counted > OFFLINE.smelterSec && state.smelters.some((m) => m.on),
      arrived: ff.arrived.map((n) => ROUTE[n].name),
      stillCruising: after.travel.dest !== null,
    },
  };
}
