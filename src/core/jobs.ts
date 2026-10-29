import { BAL, PRICES } from '../data/balance';
import { CLIENTS, JOBS, LOCAL_WANTS, RANK, RANKS, SALVAGER_PAY, type JobKind } from '../data/jobs';
import { reservedQty } from './reserve';
import { nextRandom } from './rng';
import { hasVisited, inTransit, ROUTE } from './travel';
import type { GameEvent, GameState, ItemId, Job, JobsState } from './types';

/** Items a job can ask for, in display order. */
export const JOB_ITEMS: readonly ItemId[] = ['ore', 'plate', 'ice'];

export function initialJobs(seed: number): JobsState {
  return { unlocked: false, rep: 0, rankPaid: 0, seed, slots: [], refill: [], skipCd: [], rate: {}, made: {}, seen: {}, done: 0 };
}

// ---- reputation ------------------------------------------------------------------------------

/** Current rank (index into RANKS). */
export function rankOf(rep: number): number {
  let r = 0;
  RANKS.forEach((k, i) => { if (rep >= k.rep) r = i; });
  return r;
}
export const rank = (s: GameState): number => rankOf(s.jobs.rep);
/** Rep still needed for the next rank, or null at the top. */
export const repToNext = (s: GameState): number | null => {
  const next = RANKS[rank(s) + 1];
  return next ? next.rep - s.jobs.rep : null;
};

/** Bay size: 3, plus one from the Hauler rank. */
export const baySize = (s: GameState): number => BAL.baySlots + (rank(s) >= RANK.bay ? 1 : 0);
/** Job slots: 3, plus one from the Salvager rank. */
export const slotKinds = (s: GameState): JobKind[] => (rank(s) >= RANK.slot ? [...JOBS.slots, JOBS.extraSlot] : [...JOBS.slots]);

// ---- production rate (what job sizes follow) ----------------------------------------------------

/** Count raw production (mutates s). Called where Ore, Plate and Ice are made. */
export function noteMade(s: GameState, item: ItemId, qty: number): void {
  if (qty > 0) s.jobs.made[item] = (s.jobs.made[item] ?? 0) + qty;
}

/** Fold what was made since the last call into the per-minute averages (mutates s). dt-invariant enough for sizing. */
function trackRate(s: GameState, dt: number): void {
  const k = Math.min(1, dt / JOBS.rateWindowSec);
  for (const item of JOB_ITEMS) {
    const made = s.jobs.made[item] ?? 0;
    const fresh = made - (s.jobs.seen[item] ?? 0);
    s.jobs.seen[item] = made;
    const r = s.jobs.rate[item] ?? 0;
    s.jobs.rate[item] = r * (1 - k) + (fresh * 60) / JOBS.rateWindowSec;
  }
}

/** Per-minute rate a job assumes for an item: what the player makes, but never below 70% of par. */
export const sizingRate = (s: GameState, item: ItemId): number =>
  Math.max(s.jobs.rate[item] ?? 0, (JOBS.par[item] ?? 0) * JOBS.floorMul);

// ---- generating jobs ----------------------------------------------------------------------------

function rand(s: GameState): number {
  const [v, next] = nextRandom(s.jobs.seed);
  s.jobs.seed = next;
  return v;
}

function roundUp(item: ItemId, n: number): number {
  if (item !== 'ore' && n < 20) return Math.max(1, Math.ceil(n));
  return Math.max(JOBS.roundTo, Math.ceil(n / JOBS.roundTo) * JOBS.roundTo);
}

const canMakePlate = (s: GameState): boolean => s.smelters.length > 0 || s.stats.smelted > 0;
const canGetIce = (s: GameState): boolean => s.items.ice > 0 || hasVisited(s, 'belt');

/** Credits a job pays: its sell value times the kind's premium (+10% from the Salvager rank). */
export function jobPay(s: GameState, kind: JobKind, wants: Job['wants']): number {
  const value = Object.entries(wants).reduce((n, [k, v]) => n + PRICES[k as ItemId] * (v ?? 0), 0);
  return Math.round(value * JOBS.kinds[kind].payMul * (rank(s) >= RANK.slot ? SALVAGER_PAY : 1));
}

/** A new job of this kind, sized to the player's output (mutates the jobs RNG). Null: no Local job while cruising. */
export function makeJob(s: GameState, kind: JobKind): Job | null {
  const k = JOBS.kinds[kind];
  let shares: Partial<Record<ItemId, number>>;
  let node: number | undefined;
  let client: string;
  if (kind === 'local') {
    if (inTransit(s)) return null;
    node = s.travel.node;
    const id = ROUTE[node].id;
    shares = LOCAL_WANTS[id] ?? { ore: 1.5 };
    client = (CLIENTS[id] as string | undefined) ?? 'Field crew';
  } else {
    const pool = CLIENTS.generic as string[];
    client = pool[Math.floor(rand(s) * pool.length)];
    if (kind === 'quick') {
      const opts: [ItemId, number][] = [['ore', 2], ...(canMakePlate(s) ? [['plate', 1] as [ItemId, number]] : []), ...(canGetIce(s) ? [['ice', 1] as [ItemId, number]] : [])];
      const total = opts.reduce((n, [, w]) => n + w, 0);
      let r = rand(s) * total;
      let pick: ItemId = 'ore';
      for (const [item, w] of opts) { r -= w; if (r < 0) { pick = item; break; } }
      shares = { [pick]: 1 };
    } else {
      shares = { ore: 1, ...(canMakePlate(s) ? { plate: 1 } : {}) };
      if (canGetIce(s) && rand(s) < 0.3) shares.ice = 1;
    }
  }
  const wants: Job['wants'] = {};
  for (const [item, w] of Object.entries(shares) as [ItemId, number][]) {
    wants[item] = roundUp(item, sizingRate(s, item) * k.minutes * JOBS.share * w);
  }
  return { kind, client, ...(node !== undefined ? { node } : {}), wants, delivered: {}, credits: jobPay(s, kind, wants), rep: k.rep };
}

/** Units of `item` a job still needs. */
export const stillNeeds = (job: Job, item: ItemId): number => Math.max(0, (job.wants[item] ?? 0) - (job.delivered[item] ?? 0));

/** Units of `item` the player can hand over (the goal's own materials stay, like Sell). */
export const handOver = (s: GameState, item: ItemId): number => Math.max(0, Math.floor(s.items[item]) - (s.flags.holdForGoal ? reservedQty(s, item) : 0));

export type DeliverCheck =
  | { ok: true; completes: boolean }
  | { ok: false; reason: 'empty' | 'away' | 'nothing'; label: string };

/** Can the player deliver to this slot now (in part or in full)? */
export function canDeliver(s: GameState, slot: number): DeliverCheck {
  const job = s.jobs.slots[slot];
  if (!job) return { ok: false, reason: 'empty', label: 'No job here' };
  if (job.node !== undefined && (inTransit(s) || s.travel.node !== job.node)) {
    return { ok: false, reason: 'away', label: `Deliver at ${ROUTE[job.node].name}` };
  }
  const items = JOB_ITEMS.filter((i) => stillNeeds(job, i) > 0);
  const moving = items.some((i) => handOver(s, i) > 0);
  if (!moving) return { ok: false, reason: 'nothing', label: 'Nothing to hand over yet' };
  return { ok: true, completes: items.every((i) => handOver(s, i) >= stillNeeds(job, i)) };
}

/** Pay out a finished job and grant any rank it reaches (mutates s). */
function complete(s: GameState, slot: number, events: GameEvent[]): void {
  const job = s.jobs.slots[slot]!;
  const before = rank(s);
  s.credits += job.credits;
  s.jobs.rep += job.rep;
  s.jobs.done += 1;
  s.jobs.slots[slot] = null;
  s.jobs.refill[slot] = JOBS.refillSec;
  events.push({ kind: 'job_done', slot, credits: job.credits, rep: job.rep });
  const after = rank(s);
  for (let r = Math.max(before, s.jobs.rankPaid) + 1; r <= after; r++) {
    if (r === RANK.partner) s.items.core_shard += 1; // one-time gift
    s.jobs.rankPaid = r;
    events.push({ kind: 'rank_up', rank: r });
  }
}

/** Hand over what the player has toward a job (partial delivery is fine). Delivered items are locked in the job. */
export function deliverJob(state: GameState, slot: number): { state: GameState; events: GameEvent[] } {
  if (!canDeliver(state, slot).ok) return { state, events: [] };
  const s = structuredClone(state);
  const job = s.jobs.slots[slot]!;
  const events: GameEvent[] = [];
  for (const item of JOB_ITEMS) {
    const n = Math.min(stillNeeds(job, item), handOver(s, item));
    if (n <= 0) continue;
    s.items[item] -= n;
    job.delivered[item] = (job.delivered[item] ?? 0) + n;
  }
  events.push({ kind: 'job_progress', slot });
  if (JOB_ITEMS.every((i) => stillNeeds(job, i) === 0)) complete(s, slot, events);
  return { state: s, events };
}

/** Give back what was delivered to a job that is going away (mutates s). */
function refund(s: GameState, job: Job): void {
  for (const [k, v] of Object.entries(job.delivered)) s.items[k as ItemId] += v ?? 0;
}

export const canSkip = (s: GameState, slot: number): boolean => !!s.jobs.slots[slot] && (s.jobs.skipCd[slot] ?? 0) <= 0;

/** Swap a job for a new one (free, then a 30 minute cooldown). Anything already delivered comes back. */
export function skipJob(state: GameState, slot: number): { state: GameState; events: GameEvent[] } {
  if (!canSkip(state, slot)) return { state, events: [] };
  const s = structuredClone(state);
  const kinds = slotKinds(s);
  refund(s, s.jobs.slots[slot]!);
  s.jobs.slots[slot] = makeJob(s, kinds[slot]);
  s.jobs.skipCd[slot] = JOBS.skipCooldownSec;
  return { state: s, events: [{ kind: 'job_posted', slot }] };
}

/** When the board opens: after the second Tractor Beam. */
export const jobsReady = (s: GameState): boolean => s.beams.filter((b) => b.kind === 'tractor').length >= 2;

/**
 * Advance the board by dt seconds of play (mutates s): measure output, open the board, count down refills and
 * skip cooldowns, post new jobs, and swap a Local job for the field the ship is now parked at.
 */
export function jobsStep(s: GameState, dt: number, events: GameEvent[], track = true): void {
  if (track) trackRate(s, dt);
  if (!s.jobs.unlocked) {
    if (!jobsReady(s)) return;
    s.jobs.unlocked = true;
    events.push({ kind: 'jobs_open' });
  }
  const kinds = slotKinds(s);
  for (let i = 0; i < kinds.length; i++) {
    if (s.jobs.slots[i] === undefined) s.jobs.slots[i] = null;
    s.jobs.refill[i] = Math.max(0, (s.jobs.refill[i] ?? 0) - dt);
    s.jobs.skipCd[i] = Math.max(0, (s.jobs.skipCd[i] ?? 0) - dt);
    const job = s.jobs.slots[i];
    // a Local job belongs to one field: once parked somewhere else, it is replaced (deliveries come back)
    if (job && job.node !== undefined && !inTransit(s) && job.node !== s.travel.node) {
      refund(s, job);
      s.jobs.slots[i] = null;
      s.jobs.refill[i] = 0;
    }
    if (!s.jobs.slots[i] && s.jobs.refill[i] <= 0) {
      const fresh = makeJob(s, kinds[i]);
      if (fresh) {
        s.jobs.slots[i] = fresh;
        events.push({ kind: 'job_posted', slot: i });
      }
    }
  }
}

/** Jobs the player could finish right now (the dot on the Jobs tab). */
export const finishableJobs = (s: GameState): number =>
  s.jobs.slots.filter((_, i) => { const c = canDeliver(s, i); return c.ok && c.completes; }).length;
