import { describe, expect, it } from 'vitest';
import { cargoRows, sellMode } from '../src/core/cargo';
import { fmtNum, formatVersion } from '../src/core/format';
import { bayRoom, sellAll, sellSelected, sellSurplus, setHoldForGoal, tapAllBeams, tapBeam, tick } from '../src/core/loop';
import { parseSave, serialize } from '../src/core/save';
import { availableQty, sellValue } from '../src/core/reserve';
import { createInitialState } from '../src/core/state';
import type { GameState, Rock } from '../src/core/types';
import { BAL, PRICES } from '../src/data/balance';

const dust = (): Rock => ({ kind: 'dust', geode: false, hp: 35, maxHp: 35, ore: 4 });
const run = (s: GameState, secs: number, step = 0.05): GameState => {
  let cur = s;
  for (let t = 0; t < secs - 1e-9; t += step) cur = tick(cur, step).state;
  return cur;
};
const withBeams = (n: number, s = createInitialState()): GameState => ({
  ...s, beams: Array.from({ length: n }, () => ({ status: 'idle' as const, remaining: 0, level: 1 })),
});

describe('Bay room and Fire', () => {
  it('room = slots - rocks in the Bay - rocks on their way', () => {
    let s = createInitialState();
    expect(bayRoom(s)).toBe(BAL.baySlots);
    s = { ...s, bay: [dust()] };
    expect(bayRoom(s)).toBe(2);
    s = tapBeam(s).state; // one more on its way
    expect(bayRoom(s)).toBe(1);
  });
  it('Fire stays available until the Bay is full, then does nothing', () => {
    let s = withBeams(1);
    s = { ...s, crusher: { ...s.crusher, rock: dust() } };
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      s = run(tapBeam(s).state, BAL.beamCountdown + 0.2);
      seen.push(s.bay.length);
    }
    expect(seen).toEqual([1, 2, 3, 3, 3]); // the 4th and 5th taps are ignored: the Bay is full
    expect(tapBeam(s).state).toBe(s);
    expect(bayRoom(s)).toBe(0);
  });
  it('Fire fires as many beams as there is room for', () => {
    let s = withBeams(3);
    s = { ...s, bay: [dust(), dust()] }; // 1 slot free
    const out = tapAllBeams(s).state;
    expect(out.beams.map((b) => b.status)).toEqual(['counting', 'idle', 'idle']);
    expect(tapAllBeams(out).state).toBe(out); // no room left, nothing happens
  });
  it('a tap on a beam tile with no room does not fire it', () => {
    let s = withBeams(2);
    s = { ...s, bay: [dust(), dust(), dust()] };
    expect(tapBeam(s, 1).state).toBe(s);
  });
  it('with Smasher level 2 the Bay feeds the Smasher even with one beam', () => {
    let s = withBeams(1);
    s = { ...s, smashers: [{ uid: 2, paid: { credits: 0 }, repaired: true, level: 2, queue: [] }], bay: [dust()], crusher: { ...s.crusher, rock: dust() } };
    s = tick(tapBeam(s).state, BAL.beamCountdown + 0.1).state;
    expect(s.smashers[0].queue.length + s.stats.smashed).toBeGreaterThan(0);
    expect(s.bay).toHaveLength(1); // the player keeps a rock to tap
  });
  it('rock_arrived says where the rock went', () => {
    const s = tapBeam(createInitialState()).state;
    const out = tick(s, BAL.beamCountdown + 0.1);
    expect(out.events.find((e) => e.kind === 'rock_arrived')).toMatchObject({ to: 'bay' });
  });
});

describe('selling: switch, rows, selected', () => {
  const base = (): GameState => {
    const s = createInitialState();
    return { ...s, stats: { ...s.stats, sold: 3, rocks: 5, smelted: 0 }, items: { ...s.items, ore: 12, plate: 11, core_shard: 2 } };
  };
  it('the very first sale sells everything; later sales keep the goal materials', () => {
    const s = base(); // goal: Smelter? (not built) -> reserves 25 Ore
    expect(availableQty(s, 'ore')).toBe(0);
    expect(availableQty(s, 'plate')).toBe(11);
  });
  it('the Hold switch OFF releases the reserve', () => {
    const s = base();
    const off = setHoldForGoal(s, false).state;
    expect(off.flags.holdForGoal).toBe(false);
    expect(availableQty(off, 'ore')).toBe(12);
    expect(sellValue(off)).toBe(12 * PRICES.ore + 11 * PRICES.plate);
    expect(setHoldForGoal(off, false).state).toBe(off);
  });
  it('selling selected rows equals the sum of single sells, and never sells Shards', () => {
    const off = setHoldForGoal(base(), false).state;
    const both = sellSelected(off, ['ore', 'plate', 'core_shard']).state;
    const one = sellSurplus(sellSurplus(off, 'ore').state, 'plate').state;
    expect(both.credits).toBe(one.credits);
    expect(both.items.core_shard).toBe(2);
    expect(both.items.ore).toBe(0);
    expect(sellSelected(off, ['plate']).state.items.ore).toBe(12);
    expect(sellAll(off).state.credits).toBe(both.credits);
  });
  it('value shown for a selection matches what is paid', () => {
    const off = setHoldForGoal(base(), false).state;
    for (const items of [['ore'], ['plate'], ['ore', 'plate']] as const) {
      expect(sellSelected(off, items).state.credits - off.credits).toBe(sellValue(off, items));
    }
  });
  it('sellMode is quick until the Smelter is built (or Plate exists), then cargo', () => {
    const s = createInitialState();
    expect(sellMode(s)).toBe('quick');
    expect(sellMode({ ...s, items: { ...s.items, ore: 50 } })).toBe('quick');
    expect(sellMode({ ...s, smelters: [{ uid: 3, paid: { credits: 0 }, level: 1, on: true, progress: 0 }] })).toBe('cargo');
    expect(sellMode({ ...s, stats: { ...s.stats, smelted: 1 } })).toBe('cargo');
    expect(sellMode({ ...s, items: { ...s.items, plate: 1 } })).toBe('cargo');
  });
  it('cargo rows list owned items and explain what is kept', () => {
    const s = base();
    const rows = cargoRows(s);
    expect(rows.map((r) => r.item)).toEqual(['ore', 'plate', 'core_shard']);
    const ore = rows[0];
    expect(ore).toMatchObject({ count: 12, surplus: 0, kept: 12, forSale: true });
    expect(ore.keptNote).toContain('the Smelter');
    expect(rows[2]).toMatchObject({ forSale: false, surplus: 0 });
    const released = cargoRows(setHoldForGoal(s, false).state);
    expect(released[0]).toMatchObject({ surplus: 12, kept: 0, keptNote: '' });
  });
  it('the Ore row explains smelting once a Smelter exists', () => {
    const s = { ...base(), smelters: [{ uid: 3, paid: { credits: 0 }, level: 1, on: true, progress: 0 }] };
    expect(cargoRows(s)[0].tip).toBe('Smelter: 3 Ore makes 1 Plate worth 8 credits');
  });
  it('rows with the Smasher repair goal show the Plate that is kept', () => {
    const b = base();
    const s = { ...b, smelters: [{ uid: 3, paid: { credits: 0 }, level: 1, on: true, progress: 0 }] };
    const plate = cargoRows(s).find((r) => r.item === 'plate')!;
    expect(plate.kept).toBe(8);
    expect(plate.surplus).toBe(3);
    expect(plate.keptNote).toBe('Kept 8 for the Smasher repair');
  });
});

describe('format helpers', () => {
  it('fmtNum', () => {
    expect([0, 7, 999, 1000, 1234, 9999, 15000, 253000, 1_200_000].map(fmtNum)).toEqual(['0', '7', '999', '1k', '1.2k', '9.9k', '15k', '253k', '1.2M']);
  });
  it('formatVersion', () => {
    expect(formatVersion('0.6.1', 'e2c9fbb', '2026-10-28T04:07:26Z')).toBe('v0.6.1 (e2c9fbb, Oct 28)');
    expect(formatVersion('0.6.1', 'dev', 'nonsense')).toBe('v0.6.1');
  });
});

describe('save v5 -> v7 and Paste save', () => {
  it('adds holdForGoal = true and is idempotent', () => {
    const v5 = JSON.parse(JSON.stringify(createInitialState())) as Record<string, unknown>;
    v5.version = 5;
    (v5.flags as Record<string, unknown>) = { tappedBeam: true, usedHold: false };
    const r = parseSave(JSON.stringify(v5));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version).toBe(7);
    expect(r.state.flags).toEqual({ tappedBeam: true, usedHold: false, holdForGoal: true });
    const again = parseSave(serialize(r.state));
    expect(again.ok && again.state).toEqual(r.state);
  });
  it('rejects text that is not a save, corrupt JSON and saves from a newer version', () => {
    expect(parseSave('hello').ok).toBe(false);
    expect(parseSave('{"a":1}').ok).toBe(false);
    expect(parseSave('[]').ok).toBe(false);
    expect(parseSave('').ok).toBe(false);
    expect(parseSave(null).ok).toBe(false);
    expect(parseSave(JSON.stringify({ ...createInitialState(), version: 99 })).ok).toBe(false);
    expect(parseSave(JSON.stringify({ version: 6, credits: 'x', items: {}, ship: { ownedCells: [] } })).ok).toBe(false);
  });
  it('a copied save round-trips exactly', () => {
    const s = { ...createInitialState(), credits: 4321, handLevel: 3 };
    const r = parseSave(serialize(s));
    expect(r.ok && r.state).toEqual(s);
  });
});

describe('menu help and wording', () => {
  it('help covers every topic and uses the Smash wording, not Send', async () => {
    const { HELP } = await import('../src/data/help');
    const titles = HELP.map((c) => c.title).join(' | ');
    for (const word of ['Fire', 'Smash', 'Smelter', 'Selling', 'Workshop', 'away']) expect(titles).toContain(word);
    for (const c of HELP) {
      expect(c.lines.length).toBeGreaterThan(0);
      expect(c.lines.join(' ')).not.toMatch(/\bSend\b/);
    }
  });
  it('the Smash goal says Smash', async () => {
    const { currentGoal } = await import('../src/core/goals');
    const base = createInitialState();
    const s = { ...base, flags: { ...base.flags, tappedBeam: true }, stats: { ...base.stats, rocks: 1, sold: 1, smelted: 1 }, smelters: [{ uid: 3, paid: { credits: 0 }, level: 1, on: true, progress: 0 }], smashers: [{ ...base.smashers[0], repaired: true }],
      ship: { ...base.ship, modules: [...base.ship.modules, { uid: 3, defId: 'smelter' as const, cell: '2,2' }] } };
    expect(currentGoal(s)?.id).toBe('send');
    expect(currentGoal(s)?.text).toMatch(/Smash/);
  });
});

describe('goal chip after the tutorial', () => {
  it('points at an Open outside tile before suggesting more hull', async () => {
    const { chipText } = await import('../src/core/goals');
    const b = createInitialState();
    const s: GameState = {
      ...b, flags: { ...b.flags, tappedBeam: true }, stats: { ...b.stats, rocks: 1, sold: 1, sent: 1 },
      smelters: [{ uid: 3, paid: { credits: 0 }, level: 1, on: true, progress: 0 }], smashers: [{ ...b.smashers[0], repaired: true }],
      beams: [{ status: 'idle', remaining: 0, level: 1 }, { status: 'idle', remaining: 0, level: 1 }],
      ship: { ...b.ship, ownedCells: [...b.ship.ownedCells, '1,1'], modules: [...b.ship.modules, { uid: 3, defId: 'smelter' as const, cell: '2,2' }] },
    };
    expect(chipText(s)).toMatch(/Open tile/);
    expect(chipText(s)).not.toMatch(/Expand/);
  });
});

describe('sell a few', () => {
  it('sellQty sells at most the surplus, keeps the goal reserve, and is a no-op for nothing or Shards', async () => {
    const { sellQty } = await import('../src/core/loop');
    const s0 = createInitialState();
    const s = { ...s0, stats: { ...s0.stats, sold: 3, rocks: 5 }, flags: { ...s0.flags, holdForGoal: false }, items: { ...s0.items, ore: 12, core_shard: 2 } };
    const one = sellQty(s, 'ore', 1);
    expect(one.state.items.ore).toBe(11);
    expect(one.state.credits).toBe(s.credits + PRICES.ore);
    expect(one.events[0]).toMatchObject({ kind: 'sold', item: 'ore', qty: 1 });
    expect(sellQty(s, 'ore', 50).state.items.ore).toBe(0);
    expect(sellQty(s, 'ore', 0).state).toBe(s);
    expect(sellQty(s, 'core_shard', 1).state).toBe(s);
    const held = { ...s, flags: { ...s.flags, holdForGoal: true } }; // the goal keeps Ore back, so nothing is sellable
    expect(sellQty(held, 'ore', 1).state).toBe(held);
  });
});
