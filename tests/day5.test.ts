import { describe, expect, it } from 'vitest';
import { currentGoal } from '../src/core/goals';
import {
  handStats, sellAll, tapAllBeams, tapCrush, tick, toggleSmelter, upgradeBeam, upgradeHand, upgradeSmelter,
} from '../src/core/loop';
import { freeCells, freeEdgeCells, isEdgeCell, placeModule } from '../src/core/modules';
import { availableQty, reserved, sellValue, structureGoal } from '../src/core/reserve';
import { deserialize } from '../src/core/save';
import { createInitialState } from '../src/core/state';
import type { GameState, Rock } from '../src/core/types';
import { BAL, PRICES } from '../src/data/balance';
import { HAND } from '../src/data/hand';
import { BEAM, MODULES, SMELTER } from '../src/data/modules';

const run = (s: GameState, secs: number, step = 0.05): GameState => {
  let cur = s;
  for (let t = 0; t < secs - 1e-9; t += step) cur = tick(cur, step).state;
  return cur;
};
const withItems = (s: GameState, items: Partial<GameState['items']>, credits = s.credits): GameState => ({
  ...s, credits, items: { ...s.items, ...items },
});
const smelterState = (over: Partial<GameState> = {}): GameState => {
  const s = createInitialState();
  return {
    ...s,
    smelter: { built: true, level: 1, on: true, progress: 0 },
    stats: { ...s.stats, sold: 1 },
    ...over,
  };
};
const rock = (hp: number = BAL.rock.dust.hp): Rock => ({ kind: 'dust', geode: false, hp, maxHp: hp, ore: BAL.rock.dust.ore });

describe('module placement', () => {
  it('the start owns three tiles: Beam, Smasher, and one free tile', () => {
    const s = createInitialState();
    expect(s.ship.modules.map((m) => `${m.defId}@${m.cell}`)).toEqual(['beam@2,0', 'smasher@2,1']);
    expect(freeCells(s)).toEqual(['2,2']);
  });
  it('the Smelter costs 25 Ore, goes on a free tile, and only one can exist', () => {
    const s = createInitialState();
    expect(placeModule(s, 'smelter', '2,2')).toEqual({ ok: false, reason: 'need_items' });
    const rich = withItems(s, { ore: 30 });
    const r = placeModule(rich, 'smelter', '2,2');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.items.ore).toBe(5);
    expect(r.state.smelter.built).toBe(true);
    expect(rich.smelter.built).toBe(false); // input untouched
    const again = withItems(r.state, { ore: 30 }, 0);
    expect(placeModule(again, 'smelter', '2,2')).toEqual({ ok: false, reason: 'occupied' });
    expect(placeModule({ ...again, ship: { ...again.ship, ownedCells: [...again.ship.ownedCells, '1,1'] } }, 'smelter', '1,1'))
      .toEqual({ ok: false, reason: 'at_limit' });
  });
  it('rejects tiles that are occupied or not owned', () => {
    const s = withItems(createInitialState(), { ore: 30 });
    expect(placeModule(s, 'smelter', '2,1')).toEqual({ ok: false, reason: 'occupied' });
    expect(placeModule(s, 'smelter', '4,4')).toEqual({ ok: false, reason: 'not_owned' });
  });
  it('a Tractor Beam needs an edge tile (a side facing empty space)', () => {
    const block = ['1,1', '2,1', '3,1', '1,2', '2,2', '3,2', '1,3', '2,3', '3,3'];
    const owned = new Set(block);
    expect(isEdgeCell(owned, '2,2')).toBe(false);
    expect(isEdgeCell(owned, '1,1')).toBe(true);
    const s = { ...withItems(createInitialState(), { ore: 50 }, 500), ship: { ...createInitialState().ship, ownedCells: block, modules: [{ uid: 1, defId: 'beam' as const, cell: '1,1' }] } };
    expect(placeModule(s, 'beam', '2,2')).toEqual({ ok: false, reason: 'not_edge' });
    expect(placeModule(s, 'beam', '3,3').ok).toBe(true);
  });
  it('beams cost 60 credits + 10 Ore, then 140 credits + 6 Plate, and cap at 3', () => {
    let s = { ...createInitialState(), ship: { ...createInitialState().ship, ownedCells: ['2,0', '2,1', '2,2', '1,1', '3,1', '1,0'] } };
    expect(placeModule(withItems(s, { ore: 10 }, 59), 'beam', '1,1')).toEqual({ ok: false, reason: 'need_credits' });
    const r1 = placeModule(withItems(s, { ore: 10 }, 60), 'beam', '1,1');
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    s = r1.state;
    expect(s.beams).toHaveLength(2);
    expect(s.beams[1]).toEqual({ status: 'idle', remaining: 0, level: 1 });
    expect(s.credits).toBe(0);
    const r2 = placeModule(withItems(s, { plate: 6 }, 140), 'beam', '3,1');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.beams).toHaveLength(3);
    expect(placeModule(withItems(r2.state, { plate: 6 }, 999), 'beam', '1,0')).toEqual({ ok: false, reason: 'at_limit' });
    expect(MODULES.beam.costs).toHaveLength(3);
  });
});

describe('Smelter', () => {
  it('turns 3 Ore into 1 Plate every 6 s at level 1 and conserves value', () => {
    const s = smelterState({ items: { ...createInitialState().items, ore: 30 } });
    const out = run(s, 6.05);
    expect(out.items.plate).toBe(1);
    expect(out.items.ore).toBe(27);
    const later = run(s, 30);
    expect(later.items.ore + later.items.plate * SMELTER.batchIn).toBe(30);
    expect(later.items.plate).toBe(5);
  });
  it('is dt-invariant', () => {
    const s = smelterState({ items: { ...createInitialState().items, ore: 200 } });
    const big = tick(s, 60).state;
    const small = run(s, 60, 0.05);
    expect(big.items.plate).toBe(small.items.plate);
    expect(big.items.ore).toBe(small.items.ore);
    expect(big.smelter.progress).toBeCloseTo(small.smelter.progress, 6);
  });
  it('never touches Ore reserved for the current goal', () => {
    // Smelter built, Smasher unrepaired: the goal needs Plate, so Ore is free. After repair, tile 4 needs 4 Ore.
    const base = smelterState({ smasher: { repaired: true, level: 1, queue: [] }, stats: { ...createInitialState().stats, sold: 1, sent: 1 } });
    const s = { ...base, beams: [...base.beams, { status: 'idle' as const, remaining: 0, level: 1 }], items: { ...base.items, ore: 10 } };
    expect(structureGoal(s)?.id).toBe('expand');
    expect(reserved(s).ore).toBe(4);
    const out = run(s, 120);
    expect(out.items.ore).toBeGreaterThanOrEqual(4);
    expect(out.items.ore).toBeLessThan(4 + SMELTER.batchIn);
    expect(out.items.plate).toBe(2); // (10 - 4) / 3
  });
  it('stops when switched off and when starved, and keeps no half batch', () => {
    const s = smelterState({ items: { ...createInitialState().items, ore: 12 } });
    const off = toggleSmelter(s).state;
    expect(off.smelter.on).toBe(false);
    expect(run(off, 30).items.plate).toBe(0);
    const starved = run({ ...s, items: { ...s.items, ore: 2 } }, 30);
    expect(starved.items.plate).toBe(0);
    expect(starved.smelter.progress).toBe(0);
  });
  it('levels are 25% faster each and cost 40 / 120 / 360 credits', () => {
    for (let i = 1; i < SMELTER.levels.length; i++) {
      expect(SMELTER.levels[i - 1].secPerBatch / SMELTER.levels[i].secPerBatch).toBeCloseTo(1.25, 1);
    }
    expect(SMELTER.levels.map((l) => l.cost.credits)).toEqual([0, 40, 120, 360]);
    let s = smelterState({ credits: 40 });
    const r = upgradeSmelter(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.smelter.level).toBe(2);
    expect(s.credits).toBe(0);
    expect(upgradeSmelter(s)).toEqual({ ok: false, reason: 'need_credits' });
    const fast = run({ ...s, items: { ...s.items, ore: 30 } }, 4.85);
    expect(fast.items.plate).toBe(1);
  });
  it('cannot be upgraded before it is built', () => {
    expect(upgradeSmelter(createInitialState()).ok).toBe(false);
  });
});

describe('Tractor Beam levels and Fire all', () => {
  it('higher beam levels deliver richer rocks (+25% Ore per level)', () => {
    const ores = BEAM.levels.map((_, i) => {
      const s = { ...createInitialState(), beams: [{ status: 'counting' as const, remaining: 0.01, level: i + 1 }] };
      return tick(s, 0.1).state.crusher.rock!.ore;
    });
    expect(ores).toEqual([4, 5, 6, 7]);
  });
  it('upgrade costs 25 / 75 / 225 credits and stops at level 4', () => {
    let s = createInitialState();
    s = { ...s, credits: 1000 };
    const costs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = s.credits;
      const r = upgradeBeam(s, 0);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      costs.push(before - r.state.credits);
      s = r.state;
    }
    expect(costs).toEqual([25, 75, 225]);
    expect(s.beams[0].level).toBe(4);
    expect(upgradeBeam(s, 0)).toEqual({ ok: false, reason: 'max_level' });
    expect(upgradeBeam(s, 5)).toEqual({ ok: false, reason: 'max_level' });
  });
  it('Fire all starts every idle beam, and is locked while a rock is in the stage', () => {
    let s = createInitialState();
    s = { ...s, beams: [...s.beams, { status: 'idle', remaining: 0, level: 1 }] };
    const fired = tapAllBeams(s).state;
    expect(fired.beams.map((b) => b.status)).toEqual(['counting', 'counting']);
    expect(fired.flags.tappedBeam).toBe(true);
    const busy = { ...s, crusher: { ...s.crusher, rock: rock() } };
    expect(tapAllBeams(busy).state).toBe(busy);
  });
  it('two beams fire together: one rock for the stage and one waiting in the Bay', () => {
    let s = createInitialState();
    s = { ...s, beams: [...s.beams, { status: 'idle', remaining: 0, level: 1 }] };
    const out = run(tapAllBeams(s).state, BAL.beamCountdown + 0.2);
    expect(out.crusher.rock).not.toBeNull();
    expect(out.bay).toHaveLength(1);
    expect(out.beams.map((b) => b.status)).toEqual(['idle', 'idle']);
  });
});

describe('Hand Tools', () => {
  const hot = (level: number): GameState => {
    const s = createInitialState();
    return { ...s, handLevel: level, crusher: { ...s.crusher, rock: rock(999), weakT: 5 } };
  };
  it('level 2 hits 25% harder', () => {
    const base = tapCrush(hot(1), -0.9, 0.9).state.crusher.rock!.hp;
    const l2 = tapCrush(hot(2), -0.9, 0.9).state.crusher.rock!.hp;
    expect(999 - base).toBe(1);
    expect(999 - l2).toBeCloseTo(1.25, 6);
  });
  it('level 3 raises the heat cap to 120, cools at 15/s and locks out for 1.5 s', () => {
    expect(handStats(hot(3))).toMatchObject({ heatMax: 120, cool: 15, lockout: 1.5 });
    const s = hot(3);
    const near = { ...s, crusher: { ...s.crusher, heat: 100 } };
    expect(tapCrush(near, -0.9, 0.9).events.some((e) => e.kind === 'overheat')).toBe(false); // 103 < 120
    const edge = { ...s, crusher: { ...s.crusher, heat: 118 } };
    const r = tapCrush(edge, -0.9, 0.9);
    expect(r.events.some((e) => e.kind === 'overheat')).toBe(true);
    expect(r.state.crusher.lockout).toBe(1.5);
    const cool = run({ ...s, crusher: { ...s.crusher, heat: 60 } }, 2);
    expect(cool.crusher.heat).toBeCloseTo(60 - 2 * 15, 0);
  });
  it('level 4 pays 25% bigger geode jackpots', () => {
    const geode: Rock = { kind: 'dust', geode: true, hp: 1, maxHp: 1, ore: 4 };
    const mk = (level: number) => {
      const s = createInitialState();
      return { ...s, handLevel: level, crusher: { ...s.crusher, rock: geode, weakT: 5 } };
    };
    const base = tapCrush(mk(1), -0.9, 0.9).state.credits - BAL.startCredits;
    const l4 = tapCrush(mk(4), -0.9, 0.9).state.credits - BAL.startCredits;
    expect(l4 / base).toBeCloseTo(1.25, 1);
  });
  it('upgrades cost 40 / 120 / 360 credits and stop at level 4', () => {
    expect(HAND.levels.map((l) => l.cost.credits)).toEqual([0, 40, 120, 360]);
    let s = { ...createInitialState(), credits: 39 };
    expect(upgradeHand(s)).toEqual({ ok: false, reason: 'need_credits' });
    s = { ...s, credits: 1000 };
    for (let i = 0; i < 3; i++) {
      const r = upgradeHand(s);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(s.handLevel).toBe(4);
    expect(s.credits).toBe(1000 - 520);
    expect(upgradeHand(s)).toEqual({ ok: false, reason: 'max_level' });
  });
});

describe('selling and reserved materials', () => {
  it('the very first sell sells everything (tutorial): nothing is reserved', () => {
    const s = withItems(createInitialState(), { ore: 9 });
    expect(reserved(s)).toEqual({});
    const r = sellAll(s);
    expect(r.state.items.ore).toBe(0);
    expect(r.state.credits).toBe(BAL.startCredits + 9);
  });
  it('after that, Sell keeps back the Ore for the Smelter goal (25) and sells the rest', () => {
    const s0 = createInitialState();
    const s = { ...withItems(s0, { ore: 30 }), stats: { ...s0.stats, sold: 5 } };
    expect(structureGoal(s)).toMatchObject({ id: 'smelter' });
    expect(availableQty(s, 'ore')).toBe(5);
    expect(sellValue(s)).toBe(5);
    const r = sellAll(s);
    expect(r.state.items.ore).toBe(25);
    expect(r.state.credits).toBe(BAL.startCredits + 5);
  });
  it('sells Plate above the repair reserve and never sells Core Shards', () => {
    const base = smelterState();
    const s = withItems(base, { plate: 12, ore: 6, core_shard: 2 });
    expect(structureGoal(s)).toMatchObject({ id: 'repair' });
    expect(reserved(s).plate).toBe(8);
    const r = sellAll(s);
    expect(r.state.items.plate).toBe(8);
    expect(r.state.items.core_shard).toBe(2);
    expect(r.state.credits).toBe(s.credits + 4 * PRICES.plate + 6 * PRICES.ore);
    expect(sellAll(r.state).events).toEqual([]);
  });
  it('the Smasher repair now costs 8 Plate', () => {
    const base = smelterState();
    const s = { ...base, flags: { ...base.flags, tappedBeam: true }, stats: { ...base.stats, rocks: 1 } };
    expect(currentGoal(s)).toMatchObject({ id: 'repair' });
    expect(currentGoal(s)?.text).toContain('8 Plate');
  });
  it('free edge tiles appear when the hull grows', () => {
    const s = createInitialState();
    expect(freeEdgeCells(s)).toEqual(['2,2']);
  });
});

describe('save v3 -> v4', () => {
  it('adds modules, smelter, hand level, beam levels and keeps progress; idempotent', () => {
    const v3 = createInitialState() as unknown as Record<string, unknown>;
    const old = {
      ...v3, version: 3, credits: 777,
      ship: { hullId: 'tug', ownedCells: ['2,0', '2,1', '2,2', '1,1'] },
      beams: [{ status: 'idle', remaining: 0 }],
      smelter: undefined, handLevel: undefined, stats: { rocks: 12, geodes: 1, sold: 20, taps: 50, holdTicks: 3, sent: 2, smashed: 1, overheats: 0 },
      smasher: { repaired: true, level: 2, queue: [] },
    };
    const s = deserialize(JSON.stringify(old));
    expect(s.version).toBe(4);
    expect(s.credits).toBe(777);
    expect(s.ship.modules.map((m) => m.defId)).toEqual(['beam', 'smasher']);
    expect(s.ship.ownedCells).toHaveLength(4);
    expect(s.beams[0].level).toBe(1);
    expect(s.smelter).toEqual({ built: false, level: 1, on: true, progress: 0 });
    expect(s.handLevel).toBe(1);
    expect(s.stats.smelted).toBe(0);
    expect(s.stats.rocks).toBe(12);
    expect(s.smasher).toEqual({ repaired: true, level: 2, queue: [] });
    expect(deserialize(JSON.stringify(s))).toEqual(s);
  });
});
