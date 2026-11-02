import { describe, expect, it } from 'vitest';
import { chipText, currentGoal, tileOutOfReach } from '../src/core/goals';
import { makeJob } from '../src/core/jobs';
import { nextConverterUpgrade, tick, toggleConverter, upgradeConverter } from '../src/core/loop';
import { moduleCost, moduleUnlocked, placeModule } from '../src/core/modules';
import { evaluatePower } from '../src/core/power';
import { availableQty, feedReserves, reserved, structureGoal } from '../src/core/reserve';
import { parseSave } from '../src/core/save';
import { createInitialState, SAVE_VERSION } from '../src/core/state';
import type { GameState, ModuleInstance } from '../src/core/types';
import { canSellBeam, sellModule, sellRefund } from '../src/core/units';
import { HULL_TUG } from '../src/data/hulls';
import { FAB, MELTER, MELTER_UNLOCK_TILES, MODULES } from '../src/data/modules';
import { cellKey } from '../src/core/hull';

const run = (s: GameState, secs: number, step = 0.1): GameState => {
  let cur = s;
  for (let t = 0; t < secs - 1e-9; t += step) cur = tick(cur, step).state;
  return cur;
};

/** Just a Melter and a Fabricator on off-hull keys (hull base power 3 covers 1 + 2), nothing else working. */
function converters(): GameState {
  const s = createInitialState();
  const mods: ModuleInstance[] = [
    { uid: 2, defId: 'smasher', cell: '2,1' }, // Rusty: draws nothing
    { uid: 5, defId: 'melter', cell: 'm5' },
    { uid: 6, defId: 'fab', cell: 'f6' },
  ];
  return {
    ...s,
    beams: [],
    ship: { ...s.ship, modules: mods },
    melters: [{ uid: 5, paid: MODULES.melter.costs[0], level: 1, on: true, progress: 0 }],
    fabs: [{ uid: 6, paid: MODULES.fab.costs[0], level: 1, on: true, progress: 0 }],
  };
}

/** Owns the first n template cells (the start column first). */
function hullOf(n: number): string[] {
  const start = HULL_TUG.startCells.map(cellKey);
  const rest = HULL_TUG.template.map(cellKey).filter((c) => !start.includes(c));
  return [...start, ...rest].slice(0, n);
}

/** A ship at the Rubble Belt past the early chain: second beam, Engine, Grapple, Solar Wings, n tiles. */
function belt(tiles = MELTER_UNLOCK_TILES): GameState {
  const s = createInitialState();
  const owned = hullOf(tiles);
  const mods: ModuleInstance[] = [
    { uid: 1, defId: 'beam', cell: 'x1' },
    { uid: 2, defId: 'smasher', cell: 'x2' },
    { uid: 3, defId: 'smelter', cell: 'x3' },
    { uid: 4, defId: 'beam', cell: 'x4' },
    { uid: 7, defId: 'engine', cell: 'x7', level: 1 },
    { uid: 8, defId: 'grapple', cell: 'x8' },
  ];
  return {
    ...s,
    credits: 5000,
    items: { ...s.items, ore: 300, plate: 100, ice: 40 },
    flags: { ...s.flags, tappedBeam: true },
    stats: { ...s.stats, rocks: 50, sold: 5, sent: 3, smelted: 40 },
    ship: { ...s.ship, ownedCells: owned, modules: mods },
    beams: [
      { uid: 1, kind: 'tractor', status: 'idle', remaining: 0, level: 1 },
      { uid: 4, kind: 'tractor', status: 'idle', remaining: 0, level: 1 },
      { uid: 8, kind: 'grapple', status: 'idle', remaining: 0, level: 1 },
    ],
    smashers: [{ uid: 2, paid: { credits: 0 }, repaired: true, level: 1, queue: [] }],
    smelters: [{ uid: 3, paid: MODULES.smelter.costs[0], level: 1, on: false, progress: 0 }],
    travel: { node: 1, dest: null, progress: 0, visited: [0, 1] },
  };
}

/** belt() with lots of spare power so structure goals are not about Solar Wings. */
const powered = (s: GameState): GameState => ({
  ...s,
  ship: { ...s.ship, modules: [...s.ship.modules, ...[20, 21, 22].map((uid) => ({ uid, defId: 'solar' as const, cell: `s${uid}`, level: 1 }))] },
});

describe('Ice Melter and Fabricator: batches', () => {
  it('the Ice Melter turns 2 Ice into 1 Coolant every 8 s', () => {
    let s = converters();
    s = { ...s, fabs: [{ ...s.fabs[0], on: false }], items: { ...s.items, ice: 10 } };
    s = run(s, 16.05);
    expect(s.items.coolant).toBe(2);
    expect(s.items.ice).toBe(10 - 2 * MELTER.inputs.ice!);
    expect(s.stats.melted).toBe(2);
  });
  it('the Fabricator turns 2 Plate + 1 Coolant into 1 Circuit every 20 s, and Melter Coolant can feed it', () => {
    let s = converters();
    s = { ...s, items: { ...s.items, plate: 10, ice: 4 } };
    s = run(s, 30);
    expect(s.items.circuit).toBe(1); // Coolant from the Melter at 8 s, then a 20 s batch
    expect(s.items.plate).toBe(10 - FAB.inputs.plate!);
    expect(s.stats.fabbed).toBe(1);
  });
  it('a starved converter waits and keeps no progress', () => {
    const s = run({ ...converters(), items: { ...converters().items, ice: 1 } }, 20);
    expect(s.items.coolant).toBe(0);
    expect(s.melters[0].progress).toBe(0);
  });
  it('switched OFF it stops and draws no power', () => {
    let s = { ...converters(), items: { ...converters().items, ice: 10 } };
    s = toggleConverter(s, 'melter', 0).state;
    expect(evaluatePower(s).draw).toBe(FAB.inputs.plate); // only the Fabricator (2) draws
    expect(run(s, 20).items.coolant).toBe(0);
  });
  it('without power it does nothing', () => {
    let s = { ...converters(), items: { ...converters().items, ice: 10 } };
    // a third powered module to overdraw the hull: the Fabricator was built last, so it goes dark
    s = { ...s, ship: { ...s.ship, modules: [{ uid: 1, defId: 'beam', cell: 'b1' }, ...s.ship.modules] }, beams: [{ uid: 1, kind: 'tractor', status: 'idle', remaining: 0, level: 1 }] };
    const p = evaluatePower(s);
    expect(p.unpowered).toEqual([6]);
    s = { ...s, items: { ...s.items, plate: 10, coolant: 5 } };
    expect(run(s, 25).items.circuit).toBe(0);
  });
  it('upgrades cost credits x1 x3 x9 and make batches faster', () => {
    let s = { ...converters(), credits: 2000 };
    expect(nextConverterUpgrade(s, 'melter', 0)?.credits).toBe(100);
    const r = upgradeConverter(s, 'melter', 0);
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    expect(s.melters[0].level).toBe(2);
    expect(s.credits).toBe(1900);
    expect(nextConverterUpgrade(s, 'melter', 0)?.credits).toBe(300);
    expect(nextConverterUpgrade(s, 'fab', 0)?.credits).toBe(150);
    s = { ...s, fabs: [{ ...s.fabs[0], on: false }], items: { ...s.items, ice: 20 } };
    expect(run(s, 6.45).items.coolant).toBe(1);
  });
});

describe('unlocks, goals and placement', () => {
  it('the Ice Melter is offered at the Rubble Belt with 8 hull tiles, the Fabricator once a Melter exists', () => {
    expect(moduleUnlocked(belt(MELTER_UNLOCK_TILES - 1), 'melter')).toBe(false);
    expect(moduleUnlocked({ ...belt(), travel: { node: 0, dest: null, progress: 0, visited: [0] } }, 'melter')).toBe(false);
    expect(moduleUnlocked(belt(), 'melter')).toBe(true);
    expect(moduleUnlocked(belt(), 'fab')).toBe(false);
    const free = belt().ship.ownedCells[0];
    const r = placeModule(belt(), 'melter', free);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.melters).toHaveLength(1);
    expect(r.state.items.plate).toBe(100 - 12);
    expect(r.state.items.ice).toBe(40 - 6);
    expect(moduleUnlocked(r.state, 'fab')).toBe(true);
    expect(moduleCost(r.state, 'melter')).toEqual(MODULES.melter.costs[1]);
  });
  it('goal chain: Ice Melter, then Fabricator, then the hull again', () => {
    let s = powered(belt());
    expect(structureGoal(s)?.id).toBe('melter');
    expect(currentGoal(s)?.id).toBe('melter');
    expect(reserved(s)).toEqual(MODULES.melter.costs[0].items);
    const r = placeModule(s, 'melter', s.ship.ownedCells[0]);
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    expect(structureGoal(s)?.id).toBe('fab');
    expect(currentGoal(s)?.text).toContain('Fabricator');
    s = { ...s, items: { ...s.items, coolant: 10 } };
    const f = placeModule(s, 'fab', s.ship.ownedCells[1]);
    if (!f.ok) throw new Error(f.reason);
    expect(structureGoal(f.state)?.id).toBe('expand');
  });
  it('Coolant and Circuit tiles are out of reach until their converter is offered', () => {
    const at11 = { ...belt(11), items: { ...belt(11).items, coolant: 0 } };
    expect(tileOutOfReach(at11)).toBe(true); // tile 12 needs Coolant and there is no Melter yet
    const unit = { uid: 30, paid: { credits: 0 }, level: 1, on: true, progress: 0 };
    expect(tileOutOfReach({ ...at11, melters: [unit] })).toBe(false);
    const at12 = { ...belt(12), melters: [unit] }; // tile 13 needs Circuits: no Fabricator yet
    expect(tileOutOfReach(at12)).toBe(true);
    expect(tileOutOfReach({ ...at12, fabs: [{ ...unit, uid: 31 }] })).toBe(false);
  });
  it('a full ship with no room for the Fabricator is told to make room (no dead end)', () => {
    let s = powered(belt(12));
    s = { ...s, melters: [{ uid: 30, paid: { credits: 0 }, level: 1, on: true, progress: 0 }], stats: { ...s.stats, melted: 4 } };
    const cells = s.ship.ownedCells;
    s = { ...s, ship: { ...s.ship, modules: [...s.ship.modules, ...cells.map((c, i) => ({ uid: 100 + i, defId: 'solar' as const, cell: c, level: 1 }))] } };
    expect(structureGoal(s)?.id).toBe('fab'); // its Plate and Coolant stay reserved while you make room
    expect(chipText(s)).toContain('Make room for a Fabricator');
    s = { ...s, ship: { ...s.ship, modules: s.ship.modules.filter((m) => m.uid !== 100) } };
    expect(chipText(s)).toContain('Build a Fabricator');
  });
});

describe('reserves: converters never eat the goal, Sell keeps their feed', () => {
  it('the Fabricator leaves the Plate and Coolant the goal needs alone', () => {
    // goal: the next hull tile (tile 13: 12 Plate + 2 Circuit), Fabricator on, nothing else working
    let s = powered(belt(12));
    s = {
      ...s,
      // the Fabricator gets uid 0 so the hull's base power (handed out in build order) reaches it first
      ship: { ...s.ship, modules: [...s.ship.modules, { uid: 30, defId: 'melter', cell: 'm30' }, { uid: 0, defId: 'fab', cell: 'f0' }] },
      melters: [{ uid: 30, paid: { credits: 0 }, level: 1, on: false, progress: 0 }],
      fabs: [{ uid: 0, paid: { credits: 0 }, level: 1, on: true, progress: 0 }],
      stats: { ...s.stats, melted: 5, fabbed: 1 },
      items: { ...s.items, plate: 6, coolant: 3, circuit: 0 },
    };
    expect(structureGoal(s)?.id).toBe('expand');
    expect(reserved(s)).toEqual({ plate: 6, circuit: 1 });
    // Plate is all reserved: the Fabricator cannot run
    expect(run(s, 25).items.circuit).toBe(0);
    // with spare Plate it runs, and Sell keeps back the Plate and Coolant for the missing Circuit
    s = { ...s, items: { ...s.items, plate: 30 } };
    expect(feedReserves(s)).toMatchObject({ plate: 2, coolant: 1 });
    expect(availableQty(s, 'plate')).toBe(30 - 6 - 2);
    expect(availableQty(s, 'coolant')).toBe(2);
    expect(run(s, 21).items.circuit).toBe(1);
  });
  it('the Melter feed: Sell keeps the Ice to make the Coolant the goal is short of', () => {
    let s = powered(belt(11)); // tile 12 needs 6 Plate + 2 Coolant
    s = {
      ...s,
      ship: { ...s.ship, modules: [...s.ship.modules, { uid: 30, defId: 'melter', cell: 'm30' }, { uid: 31, defId: 'fab', cell: 'f31' }] },
      melters: [{ uid: 30, paid: { credits: 0 }, level: 1, on: true, progress: 0 }],
      fabs: [{ uid: 31, paid: { credits: 0 }, level: 1, on: false, progress: 0 }],
      stats: { ...s.stats, melted: 1, fabbed: 1 },
      items: { ...s.items, coolant: 0, ice: 20 },
    };
    expect(structureGoal(s)?.id).toBe('expand');
    expect(feedReserves(s).ice).toBe(4); // 2 Coolant short x 2 Ice
    expect(availableQty(s, 'ice')).toBe(16);
  });
});

describe('selling: converters and Tractor Beams', () => {
  it('a Melter sells for 75% of its price and upgrades', () => {
    let s = belt();
    const r = placeModule(s, 'melter', s.ship.ownedCells[0]);
    if (!r.ok) throw new Error(r.reason);
    s = upgradeConverter({ ...r.state, credits: 1000 }, 'melter', 0).ok ? (upgradeConverter({ ...r.state, credits: 1000 }, 'melter', 0) as { state: GameState }).state : r.state;
    const uid = s.melters[0].uid;
    expect(sellRefund(s, uid)).toEqual({ credits: 75, items: { plate: 9, ice: 4 } });
    const sold = sellModule(s, uid);
    if (!sold.ok) throw new Error(sold.reason);
    expect(sold.state.melters).toHaveLength(0);
    expect(sold.state.ship.modules.some((m) => m.uid === uid)).toBe(false);
  });
  it('a Tractor Beam can be sold while another stays; the last one cannot', () => {
    const s = belt();
    expect(canSellBeam(s, 4)).toBe(true);
    expect(sellRefund(s, 4)).toEqual({ credits: 45, items: { ore: 7 } }); // 75% of 60 credits + 10 Ore (pre-Day-10 beam)
    const r = sellModule(s, 4);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.beams.map((b) => b.uid)).toEqual([1, 8]);
    expect(canSellBeam(r.state, 1)).toBe(false);
    expect(sellRefund(r.state, 1)).toBeNull();
    expect(sellModule(r.state, 1).ok).toBe(false);
  });
  it('a newly built beam remembers its price', () => {
    const s = belt();
    const cell = s.ship.ownedCells.find((c) => !s.ship.modules.some((m) => m.cell === c) && placeModule(s, 'beam', c).ok)!;
    const r = placeModule(s, 'beam', cell);
    if (!r.ok) throw new Error(r.reason);
    const m = r.state.ship.modules[r.state.ship.modules.length - 1];
    expect(m.paid).toEqual(MODULES.beam.costs[2]);
  });
});

describe('jobs and saves', () => {
  it('no Coolant jobs before an Ice Melter; some after', () => {
    const base = { ...belt(), jobs: { ...belt().jobs, unlocked: true } };
    let none = base;
    for (let i = 0; i < 40; i++) {
      const j = makeJob(none, i % 2 ? 'standard' : 'quick')!;
      expect(j.wants.coolant).toBeUndefined();
      none = { ...none, jobs: { ...none.jobs, seed: (none.jobs.seed * 1103515245 + 12345) >>> 0 } };
    }
    let s = { ...base, melters: [{ uid: 30, paid: { credits: 0 }, level: 1, on: true, progress: 0 }] };
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      const copy = structuredClone(s);
      const j = makeJob(copy, i % 2 ? 'standard' : 'quick')!;
      if ((j.wants.coolant ?? 0) > 0) seen += 1;
      s = copy;
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('v9 saves migrate to v10 with no Melters or Fabricators', () => {
    const old: Record<string, unknown> = { ...createInitialState(), version: 9 };
    delete old.melters;
    delete old.fabs;
    const st = old.stats as Record<string, number>;
    old.stats = { ...st, melted: undefined, fabbed: undefined };
    const r = parseSave(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.melters).toEqual([]);
    expect(r.state.fabs).toEqual([]);
    expect(r.state.stats.melted).toBe(0);
  });
});

describe('Patch 10.1: easier hull tiles and clear requirements', () => {
  it('tileNeeds lists every requirement with what you have and where to get more', async () => {
    const { tileNeeds } = await import('../src/core/goals');
    const s = { ...belt(11), credits: 100, items: { ...belt(11).items, plate: 3, coolant: 0 } };
    const n = tileNeeds(s)!;
    expect(n.number).toBe(12);
    expect(n.rows.map((r) => [r.what, r.need, r.have])).toEqual([['credits', HULL_TUG.tileCosts[8].credits, 100], ['plate', 6, 3], ['coolant', 2, 0]]);
    expect(n.rows[2].hint).toContain('Build an Ice Melter');
    const withMelter = { ...s, melters: [{ uid: 30, paid: { credits: 0 }, level: 1, on: true, progress: 0 }] };
    expect(tileNeeds(withMelter)!.rows[2].hint).toContain('Your Ice Melter');
    const atStart = { ...createInitialState(), ship: { ...createInitialState().ship, ownedCells: hullOf(9) } };
    expect(tileNeeds(atStart)!.rows.find((r) => r.what === 'ice')!.hint).toContain('Fly to the Rubble Belt');
    expect(tileNeeds({ ...s, ship: { ...s.ship, ownedCells: hullOf(18) } })).toBeNull();
  });
  it('every module has 6 levels, each dearer than the last', async () => {
    const tables = [
      (await import('../src/data/modules')).BEAM.levels, (await import('../src/data/modules')).SMELTER.levels,
      MELTER.levels, FAB.levels, (await import('../src/data/smasher')).SMASHER.levels,
      (await import('../src/data/hand')).HAND.levels, (await import('../src/data/travel')).ENGINE.levels,
      (await import('../src/data/travel')).GRAPPLE.levels,
    ];
    for (const t of tables) {
      expect(t).toHaveLength(6);
      for (let i = 2; i < t.length; i++) expect(t[i].cost.credits).toBeGreaterThan(t[i - 1].cost.credits);
    }
    expect((await import('../src/data/power')).SOLAR.levels).toHaveLength(5);
  });
  it('the Ice Melter now opens at 8 tiles', () => {
    expect(MELTER_UNLOCK_TILES).toBe(8);
    expect(moduleUnlocked(belt(8), 'melter')).toBe(true);
  });
});
