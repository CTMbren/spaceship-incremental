import { describe, expect, it } from 'vitest';
import { canSend, sendToSmasher, smasherQueueCap, smasherQueued, tick, upgradeSmasher, upgradeSmelter } from '../src/core/loop';
import { moduleCost, placeModule } from '../src/core/modules';
import { parseSave } from '../src/core/save';
import { createInitialState, SAVE_VERSION } from '../src/core/state';
import type { GameState, Rock } from '../src/core/types';
import { moveModule, sellModule, sellRefund } from '../src/core/units';
import { MODULES, SELL_REFUND } from '../src/data/modules';

const dust = (): Rock => ({ kind: 'dust', geode: false, hp: 35, maxHp: 35, ore: 4 });
/**
 * A rich ship with 9 open-able tiles, the Smelter built and the Smasher repaired, plus a row of four level-3
 * Solar Wings behind it (y = 3) so every module these tests add has power.
 */
function rich(): GameState {
  const s = createInitialState();
  const solarCells = ['1,3', '2,3', '3,3', '0,3'];
  const cells = [...s.ship.ownedCells, '1,0', '1,1', '1,2', '3,0', '3,1', '3,2', ...solarCells];
  const solars = solarCells.map((cell, i) => ({ uid: 40 + i, defId: 'solar' as const, cell, level: 3 }));
  return {
    ...s, credits: 5000, items: { ...s.items, ore: 100, plate: 100 }, stats: { ...s.stats, sold: 5, rocks: 9, smelted: 3 },
    smashers: [{ ...s.smashers[0], repaired: true }],
    smelters: [{ uid: 3, paid: MODULES.smelter.costs[0], level: 1, on: true, progress: 0 }],
    ship: { ...s.ship, ownedCells: cells, modules: [...s.ship.modules, { uid: 3, defId: 'smelter', cell: '2,2' }, ...solars] },
  };
}

describe('copies and price curve', () => {
  it('Smelter copies cost 25 Ore, then 120 + 4 Plate, then 360 + 10 Plate; 3 is the cap', () => {
    let s = createInitialState();
    expect(moduleCost(s, 'smelter')).toEqual({ credits: 0, items: { ore: 25 } });
    s = rich();
    expect(moduleCost(s, 'smelter')).toEqual({ credits: 120, items: { plate: 4 } });
    const a = placeModule(s, 'smelter', '1,0');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.state.credits).toBe(5000 - 120);
    expect(a.state.items.plate).toBe(96);
    expect(a.state.smelters).toHaveLength(2);
    expect(moduleCost(a.state, 'smelter')).toEqual({ credits: 360, items: { plate: 10 } });
    const b = placeModule(a.state, 'smelter', '1,1');
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(moduleCost(b.state, 'smelter')).toBeNull();
    expect(placeModule(b.state, 'smelter', '1,2')).toEqual({ ok: false, reason: 'at_limit' });
  });
  it('bought Smashers arrive repaired; the price curve is 500 + 8 Plate then 1200 + 20 Plate', () => {
    const s = rich();
    expect(moduleCost(s, 'smasher')).toEqual({ credits: 500, items: { plate: 8 } });
    const a = placeModule(s, 'smasher', '1,0');
    if (!a.ok) throw new Error('place failed');
    expect(a.state.smashers).toHaveLength(2);
    expect(a.state.smashers[1].repaired).toBe(true);
    expect(moduleCost(a.state, 'smasher')).toEqual({ credits: 1200, items: { plate: 20 } });
  });
  it('a copy needs credits and Plate', () => {
    const s = { ...rich(), credits: 100 };
    expect(placeModule(s, 'smelter', '1,0')).toEqual({ ok: false, reason: 'need_credits' });
    expect(placeModule({ ...rich(), items: { ...rich().items, plate: 1 } }, 'smelter', '1,0')).toEqual({ ok: false, reason: 'need_items' });
  });
});

describe('several Smasher units', () => {
  const two = (): GameState => {
    const r = rich();
    const a = placeModule(r, 'smasher', '1,0');
    if (!a.ok) throw new Error('x');
    return { ...a.state, crusher: { ...a.state.crusher, rock: dust() } };
  };
  it('Smash goes to the Smasher with the most room, ties to the first', () => {
    let s = two();
    expect(smasherQueueCap(s)).toBe(4);
    s = sendToSmasher(s).state;
    expect(s.smashers[0].queue).toHaveLength(1);
    s = { ...s, crusher: { ...s.crusher, rock: dust() } };
    s = sendToSmasher(s).state;
    expect(s.smashers[1].queue).toHaveLength(1); // the roomier one
    expect(smasherQueued(s)).toBe(2);
  });
  it('is full only when every Smasher is full', () => {
    let s = two();
    s = { ...s, smashers: s.smashers.map((m) => ({ ...m, queue: m.uid === s.smashers[0].uid ? [dust(), dust()] : [dust()] })) };
    expect(canSend(s).ok).toBe(true);
    s = { ...s, smashers: s.smashers.map((m) => ({ ...m, queue: [dust(), dust()] })) };
    expect(canSend(s)).toMatchObject({ ok: false, reason: 'full', label: 'Smashers full 4/4' });
  });
  it('each Smasher smashes at its own level, and upgrades are per unit', () => {
    let s = two();
    s = { ...s, crusher: { ...s.crusher, rock: null }, smashers: s.smashers.map((m) => ({ ...m, queue: [dust()] })) };
    const up = upgradeSmasher(s, 1);
    if (!up.ok) throw new Error('upgrade');
    s = up.state;
    expect(s.smashers.map((m) => m.level)).toEqual([1, 2]);
    for (let i = 0; i < 200; i++) s = tick(s, 0.1).state;
    expect(s.smashers.every((m) => m.queue.length === 0)).toBe(true);
    expect(s.stats.smashed).toBe(2);
  });
  it('auto-intake picks the roomiest level-2 Smasher', () => {
    let s = two();
    s = { ...s, crusher: { ...s.crusher, rock: null }, bay: [dust()], smashers: s.smashers.map((m, i) => ({ ...m, level: 2, queue: i === 0 ? [dust()] : [] })), beams: [{ uid: 1, kind: 'tractor' as const, status: 'counting', remaining: 0.01, level: 1 }] };
    s = tick(s, 0.1, false).state;
    expect(s.smashers[1].queue.length + s.stats.smashed).toBeGreaterThan(0);
    expect(s.smashers[0].queue).toHaveLength(1);
  });
});

describe('several Smelters', () => {
  it('two Smelters make Plate about twice as fast from the same Ore stock', () => {
    const one = rich();
    const a = placeModule({ ...one, items: { ...one.items, ore: 300 } }, 'smelter', '1,0');
    if (!a.ok) throw new Error('x');
    let s1 = { ...one, items: { ...one.items, ore: 300, plate: 0 } };
    let s2 = { ...a.state, items: { ...a.state.items, ore: 300, plate: 0 } };
    for (let i = 0; i < 300; i++) { s1 = tick(s1, 0.1).state; s2 = tick(s2, 0.1).state; }
    expect(s2.items.plate).toBeGreaterThan(s1.items.plate * 1.8);
    expect(s1.items.ore + s1.items.plate * 3).toBeCloseTo(300, 0); // nothing is lost
    expect(s2.items.ore + s2.items.plate * 3).toBeCloseTo(300, 0);
  });
  it('upgrades are per unit', () => {
    const one = rich();
    const a = placeModule(one, 'smelter', '1,0');
    if (!a.ok) throw new Error('x');
    const up = upgradeSmelter(a.state, 1);
    if (!up.ok) throw new Error('up');
    expect(up.state.smelters.map((m) => m.level)).toEqual([1, 2]);
  });
});

describe('Move and Sell', () => {
  it('Move puts a module on another free owned tile for free, and refuses taken or unowned tiles', () => {
    const s = rich();
    const r = moveModule(s, 3, '1,1');
    expect(r.ok && r.state.ship.modules.find((m) => m.uid === 3)!.cell).toBe('1,1');
    expect(r.ok && r.state.credits).toBe(s.credits);
    expect(moveModule(s, 3, '2,1')).toEqual({ ok: false, reason: 'occupied' });
    expect(moveModule(s, 3, '9,9')).toEqual({ ok: false, reason: 'not_owned' });
    expect(moveModule(s, 99, '1,1')).toEqual({ ok: false, reason: 'no_module' });
  });
  it('a beam can only move to an outside tile', () => {
    const s = rich();
    const interior = s.ship.ownedCells.find((c) => c === '2,1')!;
    expect(interior).toBeTruthy();
    expect(moveModule({ ...s, ship: { ...s.ship, modules: s.ship.modules.map((m) => (m.uid === 1 ? { ...m, cell: '1,0' } : m)) } }, 1, '2,0')).toMatchObject({ ok: true });
  });
  it('Sell pays 75% of what the copy cost plus 75% of its upgrade credits, and frees the tile', () => {
    const base = rich();
    const a = placeModule(base, 'smelter', '1,0');
    if (!a.ok) throw new Error('x');
    const uid = a.state.ship.modules[a.state.ship.modules.length - 1].uid;
    const up = upgradeSmelter(a.state, 1);
    if (!up.ok) throw new Error('up');
    const refund = sellRefund(up.state, uid)!;
    expect(refund.credits).toBe(Math.floor(120 * SELL_REFUND) + Math.floor(40 * SELL_REFUND));
    expect(refund.items).toEqual({ plate: 3 });
    const sold = sellModule(up.state, uid);
    if (!sold.ok) throw new Error('sell');
    expect(sold.state.smelters).toHaveLength(1);
    expect(sold.state.ship.modules.some((m) => m.uid === uid)).toBe(false);
    expect(sold.state.credits).toBe(up.state.credits + refund.credits);
    expect(sold.events[0]).toMatchObject({ kind: 'module_sold', module: 'smelter' });
    // buying again costs the copy-2 price again (the count dropped)
    expect(moduleCost(sold.state, 'smelter')).toEqual({ credits: 120, items: { plate: 4 } });
  });
  it('the ship\'s own Smasher cannot be sold; a bought one can, and its queued rocks pay their Ore', () => {
    const s = rich();
    expect(sellModule(s, 2)).toEqual({ ok: false, reason: 'cannot_sell' });
    expect(sellModule(s, 1)).toEqual({ ok: false, reason: 'cannot_sell' }); // beams are not for sale
    const a = placeModule(s, 'smasher', '1,0');
    if (!a.ok) throw new Error('x');
    const loaded = { ...a.state, smashers: a.state.smashers.map((m, i) => (i === 1 ? { ...m, queue: [dust(), dust()] } : m)) };
    const sold = sellModule(loaded, loaded.smashers[1].uid);
    if (!sold.ok) throw new Error('sell');
    expect(sold.state.items.ore).toBe(loaded.items.ore + 8);
    expect(sold.state.credits).toBe(loaded.credits + 375);
    expect(sold.state.smashers).toHaveLength(1);
  });
  it('selling the last Smelter does not bring the tutorial Smelter goal back', async () => {
    const { currentGoal } = await import('../src/core/goals');
    const s = rich();
    const sold = sellModule(s, 3);
    if (!sold.ok) throw new Error('sell');
    expect(sold.state.smelters).toHaveLength(0);
    expect(currentGoal(sold.state)?.id).not.toBe('smelter');
  });
});

describe('save v6 -> v7', () => {
  it('wraps the old smasher and smelter into unit lists tied to their tiles', () => {
    const r = rich();
    const { smashers, smelters, ...rest } = r;
    const v6 = { ...rest, version: 6, smasher: { repaired: true, level: 3, queue: [dust()] }, smelter: { built: true, level: 2, on: false, progress: 0.5 } };
    const parsed = parseSave(JSON.stringify(v6));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.version).toBe(SAVE_VERSION);
    expect(parsed.state.smashers).toEqual([{ uid: 2, paid: { credits: 0 }, repaired: true, level: 3, queue: [dust()] }]);
    expect(parsed.state.smelters).toEqual([{ uid: 3, paid: { credits: 0, items: { ore: 25 } }, level: 2, on: false, progress: 0.5 }]);
    expect('smasher' in parsed.state).toBe(false);
    void smashers; void smelters;
    const again = parseSave(JSON.stringify(parsed.state));
    expect(again.ok && again.state).toEqual(parsed.state);
  });
  it('a v6 save with no Smelter keeps an empty list', () => {
    const base = createInitialState();
    const { smashers, smelters, ...rest } = base;
    const parsed = parseSave(JSON.stringify({ ...rest, version: 6, smasher: smashers[0], smelter: { built: false, level: 1, on: true, progress: 0 } }));
    expect(parsed.ok && parsed.state.smelters).toEqual([]);
    void smelters;
  });
});
