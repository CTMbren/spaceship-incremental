import { describe, expect, it } from 'vitest';
import { buyTile } from '../src/core/actions';
import { chipText, currentGoal, tileNeeds } from '../src/core/goals';
import { cellKey, nextTileCost, unlockableCells, templateStats } from '../src/core/hull';
import { sellAll, sellQty, tapCrush } from '../src/core/loop';
import { reserved, sellValue, structureGoal } from '../src/core/reserve';
import { parseSave } from '../src/core/save';
import { createInitialState, SAVE_VERSION } from '../src/core/state';
import {
  atStation, buyPack, buyPaint, convertHull, dockCheck, packCost, paintOwned, sellPrice, setPaint, trimColor,
} from '../src/core/station';
import { canDepart } from '../src/core/travel';
import type { GameState, ModuleInstance, Rock } from '../src/core/types';
import { BAL, PRICES } from '../src/data/balance';
import { HULL_HAULER, HULL_TUG, HULLS } from '../src/data/hulls';
import { DRY_DOCK, PAINTS, TRADER } from '../src/data/station';

const ALL_TUG = HULL_TUG.template.map(cellKey);
const at = (s: GameState, node: number): GameState => ({ ...s, travel: { node, dest: null, progress: 0, visited: Array.from({ length: node + 1 }, (_, i) => i) } });

/** Docked at Station Halcyon with a full Tug, rich enough for anything. */
function docked(): GameState {
  const s = createInitialState(5);
  return at({
    ...s, credits: 10000,
    items: { ...s.items, plate: 100, sand: 40, resin: 40, core_shard: 5, circuit: 20, coolant: 20 },
    flags: { ...s.flags, tappedBeam: true },
    stats: { ...s.stats, rocks: 50, sold: 5, sent: 3, smelted: 40 },
    ship: { ...s.ship, ownedCells: ALL_TUG },
  }, 4);
}

describe('Station Halcyon and the Trader', () => {
  it('the Station is the 5th stop and is open; the Jump Point is still closed', () => {
    expect(atStation(docked())).toBe(true);
    expect(atStation(at(docked(), 3))).toBe(false);
    expect(canDepart(docked())).toMatchObject({ ok: false }); // no Engine here, and the Jump Point is closed anyway
  });
  it('refined and planet goods sell for 20% more while docked; Ore and Ice do not', () => {
    const s = docked();
    expect(sellPrice(s, 'plate')).toBeCloseTo(PRICES.plate * TRADER.sellBonus);
    expect(sellPrice(s, 'resin')).toBeCloseTo(PRICES.resin * TRADER.sellBonus);
    expect(sellPrice(s, 'ore')).toBe(PRICES.ore);
    expect(sellPrice(at(s, 3), 'plate')).toBe(PRICES.plate);
    const one = { ...s, items: { ...s.items, plate: 10 }, ship: { ...s.ship, ownedCells: ALL_TUG }, flags: { ...s.flags, holdForGoal: false } };
    const out = sellQty(one, 'plate', 10).state;
    expect(out.credits - one.credits).toBe(Math.round(10 * PRICES.plate * TRADER.sellBonus));
    expect(sellValue(one, ['plate'])).toBe(out.credits - one.credits);
  });
  it('the Trader sells packs of 5 materials and planet goods for credits, docked only', () => {
    const s = docked();
    const r = buyPack(s, 'circuit');
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.items.circuit).toBe(s.items.circuit + TRADER.pack);
    expect(r.state.credits).toBe(s.credits - TRADER.buy.circuit! * TRADER.pack);
    expect(buyPack(at(s, 3), 'circuit')).toEqual({ ok: false, reason: 'not_docked' });
    expect(buyPack(s, 'core_shard')).toEqual({ ok: false, reason: 'not_for_sale' });
    expect(buyPack({ ...s, credits: 10 }, 'sand')).toEqual({ ok: false, reason: 'need_credits' });
    expect(packCost('resin')).toEqual({ credits: TRADER.buy.resin! * TRADER.pack });
  });
  it('paints: bought at the Trader with goods, worn anywhere; Fleet Gold comes with the rank', () => {
    let s = docked();
    expect(paintOwned(s, 'tug')).toBe(true);
    expect(paintOwned(s, 'violet')).toBe(false);
    expect(trimColor(s)).toBe(PAINTS.tug.color);
    const r = buyPaint(s, 'violet');
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    expect(s.items.sand).toBe(40 - 6);
    expect(trimColor(s)).toBe(PAINTS.violet.color);
    expect(buyPaint(s, 'violet')).toEqual({ ok: false, reason: 'owned' });
    expect(buyPaint(s, 'gold')).toEqual({ ok: false, reason: 'locked' });
    s = setPaint(at(s, 3), 'tug');
    expect(trimColor(s)).toBe(PAINTS.tug.color);
    const partner = { ...s, jobs: { ...s.jobs, rep: 999 } };
    expect(paintOwned(partner, 'gold')).toBe(true);
    expect(trimColor({ ...partner, station: { paints: [], paint: null } })).toBe(PAINTS.gold.color); // Day 9 behaviour kept
  });
});

describe('Dry Dock and the Hauler', () => {
  it('the Hauler has 28 cells and contains every Tug cell, so nothing moves', () => {
    expect(templateStats(HULL_HAULER).cells).toBe(28);
    const hauler = new Set(HULL_HAULER.template.map(cellKey));
    expect(ALL_TUG.every((c) => hauler.has(c))).toBe(true);
    expect(HULL_HAULER.tileCosts).toHaveLength(25);
    expect(HULL_HAULER.tileCosts.slice(0, 15)).toEqual(HULL_TUG.tileCosts);
    for (let i = 16; i < 25; i++) expect(HULL_HAULER.tileCosts[i].credits).toBeGreaterThanOrEqual(HULL_HAULER.tileCosts[i - 1].credits);
    expect(HULL_HAULER.tileCosts[24].items?.core_shard).toBe(1);
  });
  it('converts the Tug at the Station for credits, Plate, planet goods and 2 Core Shards', () => {
    const s = { ...docked(), ship: { ...docked().ship, modules: [...docked().ship.modules] } };
    expect(dockCheck(s)).toEqual({ ok: true });
    expect(dockCheck(at(s, 3))).toEqual({ ok: false, reason: 'not_docked' });
    expect(dockCheck({ ...s, items: { ...s.items, core_shard: 1 } })).toEqual({ ok: false, reason: 'need_items' });
    const r = convertHull(s);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.ship.hullId).toBe('hauler');
    expect(r.state.ship.ownedCells).toEqual(s.ship.ownedCells);
    expect(r.state.ship.modules).toEqual(s.ship.modules);
    expect(r.state.items.core_shard).toBe(5 - DRY_DOCK.hauler.items!.core_shard!);
    expect(r.state.credits).toBe(10000 - DRY_DOCK.hauler.credits);
    expect(dockCheck(r.state)).toEqual({ ok: false, reason: 'done' });
    expect(r.events).toContainEqual({ kind: 'hull_converted', hull: 'hauler' });
  });
  it('after the conversion tile 19 can be bought on the new stern rows', () => {
    const r = convertHull(docked());
    if (!r.ok) throw new Error(r.reason);
    const def = HULLS[r.state.ship.hullId];
    const next = unlockableCells(def, new Set(r.state.ship.ownedCells));
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((c) => c.y >= 4)).toBe(true);
    expect(nextTileCost(def, 18)).toEqual(HULL_HAULER.tileCosts[15]);
    const b = buyTile(r.state, next[0]);
    expect(b.ok).toBe(true);
    expect(tileNeeds(b.ok ? b.state : r.state)?.number).toBe(20);
  });
  it('goal chain: a full Tug that has seen the Station works toward the Dry Dock', () => {
    // a ship past the whole early chain (beams, Engine, Grapple, Melter, Fabricator, Rover Bay), docked, Tug full
    const base = docked();
    const mods: ModuleInstance[] = [
      { uid: 1, defId: 'beam', cell: '2,0' }, { uid: 2, defId: 'smasher', cell: 'x2' }, { uid: 3, defId: 'smelter', cell: 'x3' },
      { uid: 4, defId: 'beam', cell: 'x4' }, { uid: 5, defId: 'engine', cell: 'x5', level: 1 }, { uid: 6, defId: 'grapple', cell: 'x6' },
      { uid: 7, defId: 'melter', cell: 'x7' }, { uid: 8, defId: 'fab', cell: 'x8' }, { uid: 9, defId: 'rover', cell: 'x9' },
    ];
    const s: GameState = {
      ...base,
      ship: { ...base.ship, modules: mods },
      beams: [
        { uid: 1, kind: 'tractor', status: 'idle', remaining: 0, level: 1 }, { uid: 4, kind: 'tractor', status: 'idle', remaining: 0, level: 1 },
        { uid: 6, kind: 'grapple', status: 'idle', remaining: 0, level: 1 },
      ],
      smashers: [{ uid: 2, paid: { credits: 0 }, repaired: true, level: 1, queue: [] }],
      smelters: [{ uid: 3, paid: { credits: 0 }, level: 1, on: true, progress: 0 }],
      melters: [{ uid: 7, paid: { credits: 0 }, level: 1, on: true, progress: 0 }],
      fabs: [{ uid: 8, paid: { credits: 0 }, level: 1, on: true, progress: 0 }],
      stats: { ...base.stats, melted: 5, fabbed: 3 },
      rover: { ...base.rover, trips: 3 },
    };
    expect(structureGoal(s)?.id).toBe('drydock');
    expect(reserved(s)).toEqual(DRY_DOCK.hauler.items);
    expect(chipText({ ...s, travel: { node: 3, dest: null, progress: 0, visited: [0, 1, 2, 3] } })).toContain('Dry Dock');
    const r = convertHull(s);
    if (!r.ok) throw new Error(r.reason);
    expect(structureGoal(r.state)?.id).toBe('expand');
    expect(currentGoal(r.state)?.id).not.toBe('drydock');
  });
});

describe('Core Shards from geodes (Day 12 tuning)', () => {
  it('geodes hold a Shard at 1.5%, and the 40th geode in a row without one always does', () => {
    expect(BAL.geode.shardChance).toBe(0.015);
    expect(BAL.geode.pity).toBe(40);
    const geode: Rock = { kind: 'dust', geode: true, hp: 1, maxHp: 50, ore: 4 };
    const s = { ...createInitialState(1), pity: BAL.geode.pity - 1, crusher: { ...createInitialState().crusher, rock: geode, weakT: 5 } };
    const out = tapCrush(s, 0.9, 0.9);
    expect(out.state.items.core_shard).toBe(1);
    expect(out.state.pity).toBe(0);
  });
});

describe('saves', () => {
  it('v11 saves migrate to v12 with no paints; a Hauler save loads', () => {
    const old: Record<string, unknown> = { ...createInitialState(), version: 11 };
    delete old.station;
    const r = parseSave(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.station).toEqual({ paints: [], paint: null });
    const conv = convertHull(docked());
    if (!conv.ok) throw new Error(conv.reason);
    const back = parseSave(JSON.stringify(conv.state));
    expect(back.ok && back.state.ship.hullId).toBe('hauler');
  });
  it('selling everything at the Station uses Station prices', () => {
    const s = { ...docked(), flags: { ...docked().flags, holdForGoal: false } };
    const v = sellValue(s);
    expect(sellAll(s).state.credits - s.credits).toBe(v);
  });
});
