import { ATTACHMENTS, ROVER, RUINS, SITES, type AttachmentId, type SiteId } from '../data/rover';
import { SYSTEM } from '../data/travel';
import { canAfford } from './actions';
import { evaluatePower } from './power';
import { nextRandom } from './rng';
import type { GameEvent, GameState, Haul, ItemId, RoverState } from './types';

/** Day 11: the Rover. Pure functions on GameState; the trip runs in tick() through roverStep(). */

export function initialRover(seed: number): RoverState {
  return {
    status: 'home', site: null, t: 0, total: 0, seed, tripSeed: 0,
    owned: [], fitted: [], tripFit: [], ruinsTrips: 0, ruinsPity: 0,
    nextPing: 0, pingLeft: 0, crates: 0, haul: null, trips: 0,
  };
}

/** A tiny RNG over a seed held in a local variable (the trip seed never changes, so rolls are repeatable). */
function rng(seed: number): () => number {
  let st = seed >>> 0;
  return () => {
    const [v, next] = nextRandom(st);
    st = next;
    return v;
  };
}

function roverRand(s: GameState): number {
  const [v, next] = nextRandom(s.rover.seed);
  s.rover.seed = next;
  return v;
}

const between = (r: () => number, [lo, hi]: readonly [number, number]): number => lo + Math.floor(r() * (hi - lo + 1));

export const bayModule = (s: GameState) => s.ship.modules.find((m) => m.defId === 'rover');

/** Parked at a planet Orbit (the Rover can only go down from orbit). */
export const atOrbit = (s: GameState): boolean => s.travel.dest === null && SYSTEM.nodes[s.travel.node]?.type === 'orbit';

/** Trip length in seconds for a site with this fit. */
export const tripSec = (site: SiteId, fit: readonly AttachmentId[]): number =>
  SITES[site].sec * (fit.includes('wheels') ? ROVER.wheelsMul : 1);

/** Multiplier and flat bonus on common finds for a site with this fit. */
function yieldMods(site: SiteId, fit: readonly AttachmentId[]): { mul: number; flat: number } {
  let mul = 1;
  if (fit.includes('drill')) mul *= ROVER.drillMul;
  if (fit.includes('battery') && SITES[site].sec >= ROVER.batteryMinSec) mul *= ROVER.batteryMul;
  return { mul, flat: fit.includes('cargo') ? ROVER.cargoFlat : 0 };
}

/** The common finds of a trip: a pure function of site, fit and trip seed (also what Recall halves). */
export function commonFinds(site: SiteId, fit: readonly AttachmentId[], tripSeed: number): Partial<Record<ItemId, number>> {
  const r = rng(tripSeed);
  const { mul, flat } = yieldMods(site, fit);
  const out: Partial<Record<ItemId, number>> = {};
  for (const [k, range] of Object.entries(SITES[site].gives) as [ItemId, [number, number]][]) {
    out[k] = Math.floor(between(r, range) * mul) + flat;
  }
  for (const c of SITES[site].chance ?? []) if (r() < c.p) out[c.item] = (out[c.item] ?? 0) + c.n;
  return out;
}

const addItems = (a: Partial<Record<ItemId, number>>, b: Partial<Record<ItemId, number>>, k = 1) => {
  for (const [i, n] of Object.entries(b) as [ItemId, number][]) a[i] = (a[i] ?? 0) + Math.floor(n * k);
};

/**
 * Everything a finished trip brings home, and the Ruins counters after it. Pure: site, fit, trip seed,
 * counters before the trip and the crates caught. Ruins: a Relic every 2nd trip, a Core Shard at 5% or on the
 * 6th trip without one (a hit resets the count), an old fleet cache on the very first trip.
 */
export function finishHaul(site: SiteId, fit: readonly AttachmentId[], tripSeed: number, ruinsTrips: number, ruinsPity: number, crates: number) {
  const items = commonFinds(site, fit, tripSeed);
  const haul: Haul = { credits: 0, items, notes: [] };
  if (site === 'ruins') {
    ruinsTrips += 1;
    ruinsPity += 1;
    const r = rng(tripSeed ^ 0x5a5a5a5a);
    if (ruinsPity >= RUINS.shardPity || r() < RUINS.shardChance) {
      items.core_shard = (items.core_shard ?? 0) + 1;
      ruinsPity = 0;
      haul.notes.push('A Core Shard in the rubble!');
    }
    if (ruinsTrips % RUINS.relicEvery === 0) {
      haul.credits += RUINS.relicCredits;
      haul.notes.push(`A Relic, sold to collectors for ${RUINS.relicCredits} credits`);
    }
    if (ruinsTrips === 1) {
      haul.credits += RUINS.firstVisitCredits;
      haul.notes.push(`An old fleet cache: ${RUINS.firstVisitCredits} credits`);
    }
  }
  if (crates > 0) {
    haul.credits += ROVER.crate.credits * crates;
    addItems(items, ROVER.crate.items, crates);
    haul.notes.push(`${crates} Rare Crate${crates > 1 ? 's' : ''}`);
  }
  return { haul, ruinsTrips, ruinsPity };
}

export type RoverCheck = { ok: true } | { ok: false; label: string };

export function canLaunch(s: GameState): RoverCheck {
  const bay = bayModule(s);
  if (!bay) return { ok: false, label: 'Build a Rover Bay' };
  if (s.rover.status === 'out') return { ok: false, label: 'Rover is out' };
  if (s.rover.status === 'back') return { ok: false, label: 'Collect first' };
  if (!atOrbit(s)) return { ok: false, label: 'Only from orbit' };
  if (!evaluatePower(s).powered.has(bay.uid)) return { ok: false, label: 'Bay has no power' };
  return { ok: true };
}

type Out = { state: GameState; events: GameEvent[] };

/** Send the Rover down to a site with the attachments fitted now. */
export function launchRover(state: GameState, site: SiteId): Out {
  if (!canLaunch(state).ok) return { state, events: [] };
  const s = structuredClone(state);
  const rv = s.rover;
  rv.tripSeed = Math.floor(roverRand(s) * 0x7fffffff);
  rv.tripFit = [...rv.fitted];
  rv.site = site;
  rv.t = 0;
  rv.total = tripSec(site, rv.tripFit);
  rv.crates = 0;
  rv.pingLeft = 0;
  rv.nextPing = between(() => roverRand(s), ROVER.ping.first);
  rv.status = 'out';
  return { state: s, events: [] };
}

/**
 * Advance a trip by dt seconds (mutates s). Pings show only when `pings` is true (the player is here) and the
 * Scanner is fitted; offline they pass unseen. A finished trip waits in the Bay as 'back' until collected, so
 * time away completes one trip at most.
 */
export function roverStep(s: GameState, dt: number, events: GameEvent[], pings: boolean): void {
  const rv = s.rover;
  if (rv.status !== 'out' || !rv.site) return;
  rv.t += dt;
  rv.pingLeft = Math.max(0, rv.pingLeft - dt);
  while (rv.t >= rv.nextPing && rv.nextPing < rv.total) {
    if (pings && rv.tripFit.includes('scanner')) {
      rv.pingLeft = ROVER.ping.window;
      events.push({ kind: 'rover_ping' });
    }
    rv.nextPing += between(() => roverRand(s), ROVER.ping.every);
  }
  if (rv.t >= rv.total - 1e-9) {
    const f = finishHaul(rv.site, rv.tripFit, rv.tripSeed, rv.ruinsTrips, rv.ruinsPity, rv.crates);
    rv.haul = f.haul;
    rv.ruinsTrips = f.ruinsTrips;
    rv.ruinsPity = f.ruinsPity;
    rv.t = rv.total;
    rv.pingLeft = 0;
    rv.status = 'back';
    rv.trips += 1;
    events.push({ kind: 'rover_back', site: SITES[rv.site].name });
  }
}

/** Tap a gold ping in time: a Rare Crate joins this trip's haul. */
export function claimPing(state: GameState): Out {
  if (state.rover.status !== 'out' || state.rover.pingLeft <= 0) return { state, events: [] };
  const s = structuredClone(state);
  s.rover.crates += 1;
  s.rover.pingLeft = 0;
  return { state: s, events: [{ kind: 'rover_crate' }] };
}

function bank(s: GameState, haul: Haul): void {
  s.credits += haul.credits;
  for (const [k, v] of Object.entries(haul.items) as [ItemId, number][]) s.items[k] += v;
}

/** Take the haul of a returned Rover into the hold. */
export function collectHaul(state: GameState): Out {
  if (state.rover.status !== 'back' || !state.rover.haul) return { state, events: [] };
  const s = structuredClone(state);
  bank(s, s.rover.haul!);
  s.rover = { ...s.rover, status: 'home', haul: null, site: null, t: 0, total: 0, crates: 0 };
  return { state: s, events: [] };
}

/** What Recall would bring home now: half the common finds (rounded down) plus any crates caught. */
export function recallHaul(s: GameState): Haul | null {
  const rv = s.rover;
  if (rv.status !== 'out' || !rv.site) return null;
  const items: Partial<Record<ItemId, number>> = {};
  addItems(items, commonFinds(rv.site, rv.tripFit, rv.tripSeed), ROVER.recallShare);
  const haul: Haul = { credits: ROVER.crate.credits * rv.crates, items, notes: [] };
  if (rv.crates > 0) addItems(items, ROVER.crate.items, rv.crates);
  return haul;
}

/** Bring the Rover home now with half its finds. Ruins counters do not move (no Relic, Shard or cache). */
export function recallRover(state: GameState): Out {
  const haul = recallHaul(state);
  if (!haul) return { state, events: [] };
  const s = structuredClone(state);
  bank(s, haul);
  s.rover = { ...s.rover, status: 'home', haul: null, site: null, t: 0, total: 0, crates: 0, pingLeft: 0 };
  return { state: s, events: [] };
}

export function buyAttachment(state: GameState, id: AttachmentId): { ok: true; state: GameState } | { ok: false; reason: 'owned' | 'need_credits' | 'need_items' } {
  if (state.rover.owned.includes(id)) return { ok: false, reason: 'owned' };
  const cost = ATTACHMENTS[id].cost;
  const afford = canAfford(state, cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = structuredClone(state);
  s.credits -= cost.credits;
  for (const [k, v] of Object.entries(cost.items ?? {})) s.items[k as ItemId] -= v ?? 0;
  s.rover.owned.push(id);
  if (s.rover.fitted.length < ROVER.slots) s.rover.fitted.push(id); // fit it straight away if a slot is free
  return { ok: true, state: s };
}

/** Fit or take off an owned attachment (the change counts from the next trip). */
export function toggleFit(state: GameState, id: AttachmentId): GameState {
  const rv = state.rover;
  if (!rv.owned.includes(id)) return state;
  const on = rv.fitted.includes(id);
  if (!on && rv.fitted.length >= ROVER.slots) return state;
  const s = structuredClone(state);
  s.rover.fitted = on ? s.rover.fitted.filter((a) => a !== id) : [...s.rover.fitted, id];
  return s;
}
