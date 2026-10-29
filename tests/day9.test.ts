import { describe, expect, it } from 'vitest';
import {
  baySize, canDeliver, canSkip, deliverJob, finishableJobs, jobPay, makeJob, rank, sizingRate, skipJob, slotKinds,
} from '../src/core/jobs';
import { bayRoom, tapCrush, tick } from '../src/core/loop';
import { placeModule } from '../src/core/modules';
import { reservedQty } from '../src/core/reserve';
import { applyOffline } from '../src/core/offline';
import { parseSave, serialize } from '../src/core/save';
import { createInitialState, SAVE_VERSION } from '../src/core/state';
import { depart, etaSec } from '../src/core/travel';
import type { GameState, Job } from '../src/core/types';
import { BAL } from '../src/data/balance';
import { JOBS, RANK, RANKS, SALVAGER_PAY } from '../src/data/jobs';

const run = (s: GameState, secs: number, step = 0.5): GameState => {
  let cur = s;
  for (let t = 0; t < secs - 1e-9; t += step) cur = tick(cur, step).state;
  return cur;
};
const place = (s: GameState, id: Parameters<typeof placeModule>[1], cell: string): GameState => {
  const r = placeModule(s, id, cell);
  if (!r.ok) throw new Error(`${id} ${cell}: ${r.reason}`);
  return r.state;
};
const own = (s: GameState, ...c: string[]): GameState => ({ ...s, ship: { ...s.ship, ownedCells: [...s.ship.ownedCells, ...c] } });

/** A ship with the Smelter, a repaired Smasher, a Solar Wing and its second beam: the board can open. */
function boardShip(): GameState {
  const b = createInitialState(4);
  let s: GameState = {
    ...b, credits: 3000, items: { ...b.items, ore: 400, plate: 80, ice: 30 },
    flags: { ...b.flags, tappedBeam: true }, stats: { ...b.stats, rocks: 50, sold: 3, sent: 2, smelted: 10 },
    smashers: [{ ...b.smashers[0], repaired: true }],
    smelters: [{ uid: 3, paid: { credits: 0, items: { ore: 25 } }, level: 1, on: false, progress: 0 }],
    ship: { ...b.ship, modules: [...b.ship.modules, { uid: 3, defId: 'smelter', cell: '2,2' }] },
  };
  s = own(s, '1,1', '3,1', '1,0', '1,2', '3,2', '2,3');
  s = place(place(s, 'solar', '1,1'), 'beam', '3,1');
  return s;
}
const opened = (): GameState => tick(boardShip(), 0.1).state;
/** Put a hand-made job in a slot. */
const withJob = (s: GameState, slot: number, job: Partial<Job>): GameState => {
  const slots = [...s.jobs.slots];
  slots[slot] = { kind: 'standard', client: 'Test', wants: {}, delivered: {}, credits: 100, rep: 3, ...job };
  return { ...s, jobs: { ...s.jobs, slots } };
};

describe('Job Board: opening and job sizes', () => {
  it('opens with the second Tractor Beam and posts Quick, Standard and Local jobs', () => {
    const before = tick(createInitialState(), 0.1).state;
    expect(before.jobs.unlocked).toBe(false);
    const out = tick(boardShip(), 0.1);
    expect(out.state.jobs.unlocked).toBe(true);
    expect(out.events).toContainEqual({ kind: 'jobs_open' });
    expect(out.state.jobs.slots.map((j) => j?.kind)).toEqual(['quick', 'standard', 'local']);
    expect(out.state.jobs.slots[2]?.node).toBe(0);
  });
  it('a Standard job asks for Ore and Plate sized to the output, paid at 1.5x their sell value', () => {
    const s = { ...opened(), jobs: { ...opened().jobs, rate: { ore: 30, plate: 4 } } };
    const job = makeJob(s, 'standard')!;
    // 30 Ore/min x 8 min x 0.35 = 84 -> 85; 4 Plate/min x 8 x 0.35 = 11.2 -> 12
    expect(job.wants).toMatchObject({ ore: 85, plate: 12 });
    expect(job.credits).toBe(Math.round((85 * 1 + 12 * 8 + (job.wants.ice ?? 0) * 3) * 1.5));
    expect(job.rep).toBe(3);
  });
  it('sizes follow the player: a faster ship gets bigger jobs, a slow start never drops below 70% of par', () => {
    const base = opened();
    const slow = { ...base, jobs: { ...base.jobs, rate: { ore: 1 } } };
    const fast = { ...base, jobs: { ...base.jobs, rate: { ore: 120 } } };
    expect(sizingRate(slow, 'ore')).toBe(JOBS.par.ore! * JOBS.floorMul);
    expect(makeJob(fast, 'standard')!.wants.ore!).toBeGreaterThan(makeJob(slow, 'standard')!.wants.ore! * 3);
  });
  it('the production average rises when the player makes Ore (and offline time does not move it)', () => {
    let s = opened();
    const r0 = s.jobs.rate.ore ?? 0;
    s = { ...s, crusher: { ...s.crusher, rock: { kind: 'dust', geode: false, hp: 1, maxHp: 35, ore: 40 }, weakT: 5 } };
    s = tapCrush(s, 0.9, 0.9).state;
    s = tick(s, 1).state;
    expect(s.jobs.rate.ore!).toBeGreaterThan(r0);
    const away = applyOffline({ ...s, savedAt: 1000 }, 1000 + 3600 * 1000).state;
    expect(away.jobs.rate.ore).toBeCloseTo(s.jobs.rate.ore!, 6);
  });
});

describe('Job Board: delivering', () => {
  it('partial delivery locks the items in the job; finishing pays credits and Reputation', () => {
    let s = withJob(opened(), 1, { wants: { ore: 500, plate: 10 }, credits: 900, rep: 3 });
    const { ore, plate } = s.items;
    expect(canDeliver(s, 1)).toEqual({ ok: true, completes: false });
    s = deliverJob(s, 1).state;
    expect(s.items.ore).toBe(0);
    expect(s.items.plate).toBe(plate - 10);
    expect(s.jobs.slots[1]!.delivered).toEqual({ ore, plate: 10 });
    // the Smelter cannot reach Ore sitting in a job
    expect(run({ ...s, smelters: s.smelters.map((m) => ({ ...m, on: true })) }, 30).jobs.slots[1]!.delivered.ore).toBe(ore);
    s = { ...s, items: { ...s.items, ore: 500 - ore + 50 } };
    expect(canDeliver(s, 1)).toEqual({ ok: true, completes: true });
    const credits = s.credits;
    const done = deliverJob(s, 1);
    expect(done.state.items.ore).toBe(50);
    expect(done.state.credits).toBe(credits + 900);
    expect(done.state.jobs.rep).toBe(3);
    expect(done.state.jobs.slots[1]).toBeNull();
    expect(done.events).toContainEqual({ kind: 'job_done', slot: 1, credits: 900, rep: 3 });
  });
  it('an empty slot gets a new job after 10 minutes of play', () => {
    const s = deliverJob(withJob(opened(), 0, { wants: { ore: 10 } }), 0).state;
    expect(run(s, JOBS.refillSec - 5).jobs.slots[0]).toBeNull();
    expect(run(s, JOBS.refillSec + 1).jobs.slots[0]).not.toBeNull();
  });
  it('keeps back what the current goal needs while "Hold materials for my goal" is on', () => {
    const s0 = opened();
    const keep = reservedQty(s0, 'plate'); // the next goal (the Engine) needs Plate
    expect(keep).toBeGreaterThan(0);
    const s = withJob({ ...s0, items: { ...s0.items, plate: keep + 3 } }, 0, { wants: { plate: 50 } });
    expect(deliverJob(s, 0).state.items.plate).toBe(keep);
    const free = deliverJob({ ...s, flags: { ...s.flags, holdForGoal: false } }, 0).state;
    expect(free.items.plate).toBe(0);
  });
  it('a Local job is delivered only where it was posted, and is replaced at the next field (deliveries come back)', () => {
    let s = withJob(opened(), 2, { kind: 'local', node: 0, wants: { ore: 999 } });
    s = deliverJob(s, 2).state;
    const held = s.jobs.slots[2]!.delivered.ore!;
    s = own(s, '2,3');
    s = place(place(s, 'solar', '3,2'), 'engine', '2,3');
    s = depart(s).state;
    expect(canDeliver(s, 2)).toMatchObject({ ok: false, reason: 'away' });
    const oreBefore = s.items.ore;
    s = tick(s, etaSec(s)! + 0.1).state;
    expect(s.travel.node).toBe(1);
    expect(s.jobs.slots[2]!.node).toBe(1);
    expect(s.jobs.slots[2]!.wants.ice).toBeGreaterThan(0); // the Belt wants Ice
    expect(s.items.ore).toBeGreaterThanOrEqual(oreBefore + held);
  });
  it('Skip swaps a job for free once, then waits 30 minutes; deliveries come back', () => {
    let s = withJob(opened(), 1, { wants: { ore: 999 } });
    const ore = s.items.ore;
    s = deliverJob(s, 1).state;
    expect(s.items.ore).toBe(0);
    s = skipJob(s, 1).state;
    expect(s.items.ore).toBe(ore);
    expect(s.jobs.slots[1]!.client).not.toBe('Test');
    expect(canSkip(s, 1)).toBe(false);
    expect(canSkip(run(s, JOBS.skipCooldownSec + 1, 5), 1)).toBe(true);
  });
  it('the Jobs tab dot counts jobs that could be finished now', () => {
    const s = withJob(withJob(opened(), 0, { wants: { ore: 10 } }), 1, { wants: { ore: 9999 } });
    expect(finishableJobs({ ...s, jobs: { ...s.jobs, slots: [s.jobs.slots[0], s.jobs.slots[1], null] } })).toBe(1);
  });
});

describe('Reputation ranks', () => {
  const finishWith = (s: GameState, rep: number): ReturnType<typeof deliverJob> => deliverJob(withJob(s, 0, { wants: { ore: 1 }, rep }), 0);
  it('Hauler (5): the Bay holds 4 rocks', () => {
    const s = opened();
    expect(baySize(s)).toBe(BAL.baySlots);
    const out = finishWith(s, RANKS[RANK.bay].rep);
    expect(out.events).toContainEqual({ kind: 'rank_up', rank: RANK.bay });
    expect(baySize(out.state)).toBe(BAL.baySlots + 1);
    expect(bayRoom(out.state)).toBe(BAL.baySlots + 1);
  });
  it('Salvager (15): a fourth job slot, and jobs pay 10% more', () => {
    const s = { ...opened(), jobs: { ...opened().jobs, rep: RANKS[RANK.slot].rep } };
    expect(slotKinds(s)).toHaveLength(4);
    const wants = { ore: 100 };
    expect(jobPay(s, 'quick', wants)).toBe(Math.round(100 * 1.3 * SALVAGER_PAY));
    expect(tick(s, 0.1).state.jobs.slots).toHaveLength(4);
  });
  it('Contractor (35): the Auto-Winch can be built; it fires the beams touching it', () => {
    let s = own(opened(), '3,0', '0,2');
    expect(placeModule(s, 'winch', '3,0')).toEqual({ ok: false, reason: 'locked' });
    s = { ...s, jobs: { ...s.jobs, rep: RANKS[RANK.winch].rep } };
    // a winch touching no beam does nothing
    const lonely = place(s, 'winch', '1,2');
    expect(run(lonely, 2).beams.every((b) => b.status === 'idle')).toBe(true);
    // at (3,0) it touches both Tractor Beams, (2,0) and (3,1): they fire on their own, again and again
    const winched = place(s, 'winch', '3,0');
    const fired = tick(winched, 0.1).state;
    expect(fired.beams.every((b) => b.status !== 'idle')).toBe(true);
    const later = run(winched, 20, 0.1);
    expect(later.bay.length + (later.crusher.rock ? 1 : 0)).toBeGreaterThanOrEqual(BAL.baySlots); // the Bay filled up hands-free
  });
  it('Fleet Partner (70): a Core Shard, given once', () => {
    const s = { ...opened(), jobs: { ...opened().jobs, rep: 69, rankPaid: RANK.winch } };
    const out = finishWith(s, 1);
    expect(rank(out.state)).toBe(RANK.partner);
    expect(out.state.items.core_shard).toBe(s.items.core_shard + 1);
    const again = finishWith(out.state, 1);
    expect(again.state.items.core_shard).toBe(out.state.items.core_shard);
  });
  it('several ranks at once pay every gift', () => {
    const out = finishWith(opened(), 100);
    expect(out.events.filter((e) => e.kind === 'rank_up').map((e) => (e as { rank: number }).rank)).toEqual([1, 2, 3, 4]);
    expect(out.state.items.core_shard).toBe(1);
  });
});

describe('Job Board: determinism and saves', () => {
  it('the board has its own RNG: posting jobs does not change the rocks', () => {
    const a = opened();
    expect(a.rng).toBe(boardShip().rng);
    expect(JSON.stringify(run(a, 60))).toBe(JSON.stringify(run(a, 60)));
  });
  it('v8 -> v9 adds a closed board that opens on the next tick; idempotent', () => {
    const v8 = JSON.parse(serialize(boardShip())) as Record<string, unknown>;
    v8.version = 8;
    delete v8.jobs;
    const r = parseSave(JSON.stringify(v8));
    if (!r.ok) throw new Error('parse');
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.jobs.unlocked).toBe(false);
    expect(tick(r.state, 0.1).state.jobs.unlocked).toBe(true);
    const again = parseSave(serialize(r.state));
    expect(again.ok && again.state).toEqual(r.state);
  });
});
