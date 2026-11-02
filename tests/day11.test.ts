import { describe, expect, it } from 'vitest';
import { currentGoal } from '../src/core/goals';
import { tick } from '../src/core/loop';
import { moduleUnlocked, placeModule } from '../src/core/modules';
import { applyOffline } from '../src/core/offline';
import {
  buyAttachment, canLaunch, claimPing, collectHaul, commonFinds, finishHaul, launchRover, recallHaul, recallRover, toggleFit, tripSec,
} from '../src/core/rover';
import { parseSave } from '../src/core/save';
import { createInitialState, SAVE_VERSION } from '../src/core/state';
import { canDepart, depart } from '../src/core/travel';
import type { GameState, ModuleInstance } from '../src/core/types';
import { sellRefund } from '../src/core/units';
import { ROVER, RUINS, SITES } from '../src/data/rover';

/** Advance only the Rover-relevant clock (big steps are fine: the trip is dt-invariant). */
const run = (s: GameState, secs: number, step = 1): GameState => {
  let cur = s;
  for (let t = 0; t < secs - 1e-9; t += step) cur = tick(cur, step).state;
  return cur;
};

/** Parked at Veda Orbit with a powered Rover Bay (off-hull key, powered by the hull base) and nothing else drawing. */
function orbit(): GameState {
  const s = createInitialState(7);
  const mods: ModuleInstance[] = [
    { uid: 2, defId: 'smasher', cell: '2,1' }, // Rusty: no draw
    { uid: 9, defId: 'rover', cell: 'r9', paid: { credits: 0, items: { plate: 12, circuit: 2 } } },
  ];
  return {
    ...s, beams: [], credits: 1000,
    items: { ...s.items, plate: 100, circuit: 10, sand: 50, resin: 50 },
    ship: { ...s.ship, modules: mods },
    travel: { node: 3, dest: null, progress: 0, visited: [0, 1, 2, 3] },
  };
}

const launched = (s: GameState, site: Parameters<typeof launchRover>[1]) => {
  const out = launchRover(s, site);
  if (out.state === s) throw new Error(`launch ${site}: ${JSON.stringify(canLaunch(s))}`);
  return out.state;
};

describe('Veda Orbit and the Rover Bay', () => {
  it('the Rover Bay is offered once the ship reaches Veda Orbit, on an outside tile', () => {
    const s = createInitialState();
    expect(moduleUnlocked(s, 'rover')).toBe(false);
    expect(moduleUnlocked({ ...s, travel: { node: 3, dest: null, progress: 0, visited: [0, 1, 2, 3] } }, 'rover')).toBe(true);
    const at = { ...s, items: { ...s.items, plate: 20, circuit: 3 }, travel: { node: 3, dest: null, progress: 0, visited: [0, 1, 2, 3] } };
    const r = placeModule(at, 'rover', '2,2');
    expect(r.ok).toBe(true);
  });
  it('the Rover only goes down from orbit, from a powered Bay, one trip at a time', () => {
    const s = orbit();
    expect(canLaunch(s).ok).toBe(true);
    expect(canLaunch({ ...s, travel: { ...s.travel, node: 2 } })).toEqual({ ok: false, label: 'Only from orbit' });
    const out = launched(s, 'dunes');
    expect(canLaunch(out)).toEqual({ ok: false, label: 'Rover is out' });
    expect(launchRover(out, 'ruins').state).toBe(out);
  });
  it('goal chain: Rover Bay at Veda, then send it down, then collect', () => {
    // a ship past the whole early chain (two beams, Engine, Grapple, Melter, Fabricator), parked at Veda, no Bay yet
    const base = createInitialState(3);
    const mods: ModuleInstance[] = [
      { uid: 1, defId: 'beam', cell: '2,0' }, { uid: 2, defId: 'smasher', cell: 'x2' }, { uid: 3, defId: 'smelter', cell: 'x3' },
      { uid: 4, defId: 'beam', cell: 'x4' }, { uid: 5, defId: 'engine', cell: 'x5', level: 1 }, { uid: 6, defId: 'grapple', cell: 'x6' },
      { uid: 7, defId: 'melter', cell: 'x7' }, { uid: 8, defId: 'fab', cell: 'x8' },
      // one Wing on the hull next to where the Bay goes, the rest off the hull (supply only)
      ...[20, 21, 22, 23, 24, 25].map((uid) => ({ uid, defId: 'solar' as const, cell: uid === 20 ? '1,1' : `s${uid}`, level: uid === 20 ? 3 : 1 })),
    ];
    let s: GameState = {
      ...base, credits: 500, items: { ...base.items, plate: 40, circuit: 5 },
      flags: { ...base.flags, tappedBeam: true },
      stats: { ...base.stats, rocks: 50, sold: 5, sent: 3, smelted: 40, melted: 5, fabbed: 3 },
      ship: { ...base.ship, ownedCells: ['2,0', '2,1', '2,2', '1,1'], modules: mods },
      beams: [
        { uid: 1, kind: 'tractor', status: 'idle', remaining: 0, level: 1 }, { uid: 4, kind: 'tractor', status: 'idle', remaining: 0, level: 1 },
        { uid: 6, kind: 'grapple', status: 'idle', remaining: 0, level: 1 },
      ],
      smashers: [{ uid: 2, paid: { credits: 0 }, repaired: true, level: 1, queue: [] }],
      smelters: [{ uid: 3, paid: { credits: 0 }, level: 1, on: true, progress: 0 }],
      melters: [{ uid: 7, paid: { credits: 0 }, level: 1, on: true, progress: 0 }],
      fabs: [{ uid: 8, paid: { credits: 0 }, level: 1, on: true, progress: 0 }],
      travel: { node: 3, dest: null, progress: 0, visited: [0, 1, 2, 3] },
    };
    expect(currentGoal({ ...s, ship: { ...s.ship, modules: s.ship.modules.filter((m) => m.uid < 22) } })?.id).toBe('solar'); // short on power: a Solar Wing first
    expect(currentGoal(s)?.id).toBe('rover');
    const r = placeModule(s, 'rover', '2,2');
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    expect(currentGoal(s)?.id).toBe('rover-go');
    s = run(launched(s, 'dunes'), SITES.dunes.sec, 5);
    expect(currentGoal(s)?.id).toBe('rover-collect');
    expect(currentGoal(collectHaul(s).state)).toBeNull();
  });
});

describe('trips: yield, time, attachments', () => {
  it('a trip takes the site time and its yield is a pure function of site, fit and seed', () => {
    const s = launched(orbit(), 'dunes');
    expect(s.rover.total).toBe(SITES.dunes.sec);
    const a = commonFinds('crater', ['drill'], 12345);
    expect(commonFinds('crater', ['drill'], 12345)).toEqual(a);
    const done = run(s, SITES.dunes.sec);
    expect(done.rover.status).toBe('back');
    const sand = done.rover.haul!.items.sand!;
    expect(sand).toBeGreaterThanOrEqual(6);
    expect(sand).toBeLessThanOrEqual(9);
  });
  it('the trip is dt-invariant: 1 s steps and 10 s steps bring the same haul', () => {
    const s = launched(orbit(), 'crater');
    const a = run(s, SITES.crater.sec, 1);
    const b = run(s, SITES.crater.sec, 10);
    expect(a.rover.haul).toEqual(b.rover.haul);
  });
  it('Wheels cut the time 25%; Drill, Cargo and Battery raise the finds', () => {
    expect(tripSec('ruins', ['wheels'])).toBe(SITES.ruins.sec * ROVER.wheelsMul);
    const seed = 999;
    const base = commonFinds('crater', [], seed);
    const drill = commonFinds('crater', ['drill'], seed);
    const cargo = commonFinds('crater', ['cargo'], seed);
    const battery = commonFinds('crater', ['battery'], seed);
    expect(drill.ore).toBe(Math.floor(base.ore! * 1.25));
    expect(cargo.ore).toBe(base.ore! + 2);
    expect(battery.ore).toBe(Math.floor(base.ore! * 1.5));
    expect(commonFinds('dunes', ['battery'], seed)).toEqual(commonFinds('dunes', [], seed)); // short trips: no Battery bonus
  });
  it('attachments are bought once with materials; 3 fit; the fit is fixed at launch', () => {
    let s = orbit();
    for (const id of ['drill', 'wheels', 'cargo', 'battery'] as const) {
      const r = buyAttachment(s, id);
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    }
    expect(s.rover.owned).toHaveLength(4);
    expect(s.rover.fitted).toEqual(['drill', 'wheels', 'cargo']); // the 4th waits for a free slot
    expect(buyAttachment(s, 'drill')).toEqual({ ok: false, reason: 'owned' });
    expect(toggleFit(s, 'battery')).toBe(s); // slots full
    s = toggleFit(toggleFit(s, 'cargo'), 'battery');
    expect(s.rover.fitted).toEqual(['drill', 'wheels', 'battery']);
    const out = launched(s, 'ruins');
    expect(out.rover.total).toBe(SITES.ruins.sec * ROVER.wheelsMul);
    const changed = toggleFit(out, 'wheels');
    expect(changed.rover.tripFit).toEqual(['drill', 'wheels', 'battery']);
  });
});

describe('Ruins: Relics, Core Shards and the pity counter', () => {
  it('the first Ruins trip finds the fleet cache; every 2nd trip a Relic', () => {
    const first = finishHaul('ruins', [], 1, 0, 0, 0);
    expect(first.haul.credits).toBe(RUINS.firstVisitCredits);
    expect(first.ruinsTrips).toBe(1);
    const second = finishHaul('ruins', [], 2, 1, 1, 0);
    expect(second.haul.credits).toBe(RUINS.relicCredits);
  });
  it('the pity counter guarantees a Core Shard on the 6th Ruins trip without one, then resets', () => {
    // find a seed with no lucky shard so the pity path is what fires
    let seed = 1;
    while (finishHaul('ruins', [], seed, 3, 0, 0).haul.items.core_shard) seed += 1;
    const fifth = finishHaul('ruins', [], seed, 5, 4, 0);
    if (!fifth.haul.items.core_shard) expect(fifth.ruinsPity).toBe(5);
    const sixth = finishHaul('ruins', [], seed, 5, RUINS.shardPity - 1, 0);
    expect(sixth.haul.items.core_shard).toBe(1);
    expect(sixth.ruinsPity).toBe(0);
  });
  it('about one Core Shard per 6 Ruins trips (90 minutes of Rover time): 1 to 1.3 on average', () => {
    let shards = 0;
    const runs = 400;
    for (let k = 0; k < runs; k++) {
      let trips = 0, pity = 0;
      for (let i = 0; i < 6; i++) {
        const f = finishHaul('ruins', [], (k * 7919 + i * 104729 + 17) >>> 0, trips, pity, 0);
        shards += f.haul.items.core_shard ?? 0;
        trips = f.ruinsTrips;
        pity = f.ruinsPity;
      }
    }
    expect(shards / runs).toBeGreaterThanOrEqual(1);
    expect(shards / runs).toBeLessThanOrEqual(1.3);
  });
});

describe('pings, collect, recall, departing', () => {
  it('with a Scanner a ping shows; tapping it in time adds a Rare Crate', () => {
    let s = orbit();
    const r = buyAttachment(s, 'scanner');
    if (!r.ok) throw new Error(r.reason);
    s = launched(r.state, 'crater');
    let pinged: GameState | null = null;
    for (let t = 0; t < SITES.crater.sec && !pinged; t += 1) {
      const out = tick(s, 1);
      s = out.state;
      if (out.events.some((e) => e.kind === 'rover_ping')) pinged = s;
    }
    expect(pinged).not.toBeNull();
    expect(pinged!.rover.pingLeft).toBeGreaterThan(0);
    const c = claimPing(pinged!);
    expect(c.state.rover.crates).toBe(1);
    expect(claimPing(c.state).state).toBe(c.state); // gone once claimed
    const done = run(c.state, SITES.crater.sec);
    expect(done.rover.haul!.credits).toBeGreaterThanOrEqual(ROVER.crate.credits);
  });
  it('without a Scanner (or offline) no ping ever shows', () => {
    let s = launched(orbit(), 'crater');
    for (let t = 0; t < SITES.crater.sec; t += 1) {
      const out = tick(s, 1);
      expect(out.events.some((e) => e.kind === 'rover_ping')).toBe(false);
      s = out.state;
    }
  });
  it('collect banks the haul and brings the Rover home', () => {
    const back = run(launched(orbit(), 'dunes'), SITES.dunes.sec);
    const before = back.items.sand;
    const c = collectHaul(back).state;
    expect(c.items.sand).toBe(before + back.rover.haul!.items.sand!);
    expect(c.rover.status).toBe('home');
    expect(c.rover.trips).toBe(1);
  });
  it('Recall brings the Rover home now with half the common finds and no Ruins extras', () => {
    const out = launched(orbit(), 'ruins');
    const full = commonFinds('ruins', [], out.rover.tripSeed);
    const half = recallHaul(out)!;
    expect(half.items.resin).toBe(Math.floor(full.resin! * ROVER.recallShare));
    const r = recallRover(out).state;
    expect(r.rover.status).toBe('home');
    expect(r.rover.ruinsTrips).toBe(0);
    expect(r.items.resin).toBe(out.items.resin + half.items.resin!);
  });
  it('the ship cannot Depart with the Rover out; a waiting haul comes aboard on Depart', () => {
    const base = orbit();
    // Station Halcyon is still closed, so test from the Rings (node 2) with an Engine
    // the Engine gets uid 1 so the hull's base power (build order) reaches it before the Bay
    const eng: ModuleInstance = { uid: 1, defId: 'engine', cell: 'e1', level: 1 };
    const atRings = { ...base, ship: { ...base.ship, modules: [eng, ...base.ship.modules] }, travel: { node: 2, dest: null, progress: 0, visited: [0, 1, 2] } };
    const outState = { ...atRings, rover: { ...launched(base, 'dunes').rover } };
    expect(canDepart(outState)).toMatchObject({ ok: false, reason: 'rover' });
    const backState = { ...atRings, rover: run(launched(base, 'dunes'), SITES.dunes.sec).rover };
    const left = depart(backState).state;
    expect(left.travel.dest).toBe(3);
    expect(left.rover.status).toBe('home');
    expect(left.items.sand).toBeGreaterThan(backState.items.sand);
  });
  it('the Rover Bay cannot be sold while the Rover is out', () => {
    const s = orbit();
    expect(sellRefund(s, 9)).not.toBeNull();
    expect(sellRefund(launched(s, 'dunes'), 9)).toBeNull();
  });
});

describe('offline and saves', () => {
  it('offline the Rover finishes one trip and waits; offline matches online', () => {
    const s = { ...launched(orbit(), 'dunes'), savedAt: 1_000_000 };
    const off = applyOffline(s, 1_000_000 + 3 * 3600 * 1000);
    expect(off.state.rover.status).toBe('back');
    expect(off.state.rover.trips).toBe(1);
    expect(off.report?.roverBack).toBe('Dunes');
    const online = run(launched(orbit(), 'dunes'), SITES.dunes.sec);
    expect(off.state.rover.haul).toEqual(online.rover.haul);
  });
  it('v10 saves migrate to v11 with a Rover at home and no planet goods', () => {
    const old: Record<string, unknown> = { ...createInitialState(), version: 10 };
    delete old.rover;
    const items = { ...(old.items as Record<string, number>) };
    delete items.sand;
    delete items.resin;
    old.items = items;
    const r = parseSave(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.rover.status).toBe('home');
    expect(r.state.items.sand).toBe(0);
    expect(r.state.items.resin).toBe(0);
  });
});
