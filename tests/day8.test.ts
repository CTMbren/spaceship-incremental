import { describe, expect, it } from 'vitest';
import { buyTile } from '../src/core/actions';
import { currentGoal } from '../src/core/goals';
import { canSend, tapAllBeams, tapBeam, tapCrush, tick, toggleSmelter, upgradeBeam, upgradeModule } from '../src/core/loop';
import { isRearCell, placeModule } from '../src/core/modules';
import { applyOffline, segments } from '../src/core/offline';
import { distances, evaluatePower } from '../src/core/power';
import { parseSave, serialize } from '../src/core/save';
import { createInitialState, SAVE_VERSION } from '../src/core/state';
import { canDepart, depart, engineSpeed, etaSec, inTransit, zoneOf } from '../src/core/travel';
import type { GameState, ModuleInstance, Rock } from '../src/core/types';
import { moveModule, sellModule, sellRefund } from '../src/core/units';
import { BAL } from '../src/data/balance';
import { OFFLINE } from '../src/data/offline';
import { POWER, SOLAR } from '../src/data/power';
import { SMASHER } from '../src/data/smasher';
import { ENGINE, GRAPPLE, SYSTEM, VOID_DRIFT } from '../src/data/travel';

const run = (s: GameState, secs: number, step = 0.05): GameState => {
  let cur = s;
  for (let t = 0; t < secs - 1e-9; t += step) cur = tick(cur, step).state;
  return cur;
};
const dust = (): Rock => ({ kind: 'dust', geode: false, hp: 35, maxHp: 35, ore: 4 });

/** The 1x3 start with every early structure done: Smelter on, Smasher repaired, first sell and smash done. */
function early(): GameState {
  const s = createInitialState();
  return {
    ...s, credits: 5000, items: { ...s.items, ore: 200, plate: 200, ice: 50 },
    flags: { ...s.flags, tappedBeam: true },
    stats: { ...s.stats, rocks: 5, sold: 2, sent: 1, smelted: 3 },
    smashers: [{ ...s.smashers[0], repaired: true }],
    smelters: [{ uid: 3, paid: { credits: 0, items: { ore: 25 } }, level: 1, on: true, progress: 0 }],
    ship: { ...s.ship, modules: [...s.ship.modules, { uid: 3, defId: 'smelter', cell: '2,2' }] },
  };
}
const own = (s: GameState, ...cells: string[]): GameState => ({ ...s, ship: { ...s.ship, ownedCells: [...s.ship.ownedCells, ...cells] } });
const placed = (s: GameState, id: Parameters<typeof placeModule>[1], cell: string): GameState => {
  const r = placeModule(s, id, cell);
  if (!r.ok) throw new Error(`place ${id} at ${cell}: ${r.reason}`);
  return r.state;
};
const lastUid = (s: GameState): number => s.ship.modules[s.ship.modules.length - 1].uid;
/** Park the ship at a node as if it had flown there. */
const at = (s: GameState, node: number): GameState => ({ ...s, travel: { node, dest: null, progress: 0, visited: Array.from({ length: node + 1 }, (_, i) => i) } });

describe('power: hull base, draw and who gets it', () => {
  it('the hull supplies 3: beam, Smasher and Smelter run; a second beam has no power and does not fire', () => {
    const s = placed(own(early(), '1,1'), 'beam', '1,1');
    const p = evaluatePower(s);
    expect(p.supply).toBe(POWER.hullBase);
    expect(p.draw).toBe(4);
    expect(p.powered.has(1) && p.powered.has(2) && p.powered.has(3)).toBe(true);
    expect(p.unpowered).toEqual([lastUid(s)]);
    const fired = tapAllBeams(s).state;
    expect(fired.beams.map((b) => b.status)).toEqual(['counting', 'idle']);
    expect(tapBeam(s, 1).state).toBe(s); // tapping the dark beam does nothing
  });
  it('a Rusty Smasher and a Smelter switched OFF draw nothing', () => {
    const s = createInitialState();
    expect(evaluatePower(s).draw).toBe(1); // only the beam: the Smasher is rusty
    const off = toggleSmelter(early()).state;
    expect(evaluatePower(off).draw).toBe(2);
  });
  it('a Solar Wing powers modules within its reach (path distance through owned tiles), nearest first', () => {
    // row y=1: (0,1) solar ... modules further along a corridor
    const owned = new Set(['0,0', '1,0', '2,0', '3,0', '4,0']);
    expect([...distances(owned, '0,0', 2).entries()]).toEqual([['0,0', 0], ['1,0', 1], ['2,0', 2]]);
    // a U shape: straight-line close, path far
    const u = new Set(['0,0', '0,1', '0,2', '1,2', '2,2', '2,1', '2,0']);
    expect(distances(u, '0,0', 6).get('2,0')).toBe(6);
  });
  it('Solar output covers what it can; the hull base then fills the gaps in build order', () => {
    let s = own(early(), '1,1', '3,1', '1,2', '3,2');
    s = placed(s, 'solar', '1,2'); // next to the Smelter (2,2)
    s = placed(s, 'beam', '1,1');
    s = placed(s, 'beam', '3,1');
    const p = evaluatePower(s);
    expect(p.supply).toBe(POWER.hullBase + SOLAR.levels[0].output);
    expect(p.draw).toBe(5);
    expect(p.unpowered).toEqual([]);
  });
  it('unpowered modules stop: a beam pauses its countdown, the Smasher and Smelter do no work', () => {
    let s = placed(own(early(), '1,1'), 'beam', '1,1');
    s = { ...s, beams: s.beams.map((b) => ({ ...b, status: 'counting' as const, remaining: 0.5 })) };
    s = run(s, 2);
    expect(s.beams[1].status).toBe('counting'); // the dark beam's countdown is frozen
    expect(s.beams[1].remaining).toBeCloseTo(0.5, 6);
    // with a second Smasher hogging power, the third one sits idle
    let t = own(early(), '1,1', '1,0');
    t = placed(t, 'smasher', '1,1'); // 4th draw: unpowered
    const sm = t.smashers[1];
    t = { ...t, smashers: t.smashers.map((m) => (m.uid === sm.uid ? { ...m, queue: [dust()] } : m)) };
    const after = run(t, 20);
    expect(after.smashers[1].queue).toHaveLength(1);
    expect(after.smashers[1].queue[0].hp).toBe(35);
  });
  it('Smash only feeds Smashers that have power', () => {
    const s0 = early();
    // turn the only Smasher dark: Smelter + two extra beams on base power before it (lower uids win)
    const s = {
      ...s0, crusher: { ...s0.crusher, rock: dust() },
      ship: { ...s0.ship, modules: s0.ship.modules.map((m) => (m.uid === 2 ? { ...m, uid: 20 } : m)).concat([{ uid: 4, defId: 'beam', cell: 'x4' }]) },
      smashers: [{ ...s0.smashers[0], uid: 20 }],
      beams: [...s0.beams, { uid: 4, kind: 'tractor' as const, status: 'idle' as const, remaining: 0, level: 1 }],
    } as GameState;
    expect(evaluatePower(s).unpowered).toEqual([20]);
    expect(canSend(s)).toMatchObject({ ok: false, reason: 'unpowered' });
  });
  it('Boost: a powered module touching a Solar Wing works 15% faster', () => {
    let s = own(early(), '1,1');
    s = placed(s, 'solar', '1,1'); // touches the Smasher at (2,1)
    expect(evaluatePower(s).boosted.has(2)).toBe(true);
    const plain = { ...early(), smashers: [{ ...early().smashers[0], queue: [dust()] }] };
    const boosted = { ...s, smashers: [{ ...s.smashers[0], queue: [dust()] }] };
    const t = BAL.rock.dust.hp / SMASHER.levels[0].hpPerSec; // ~13 s unboosted
    expect(run(plain, t / POWER.boost + 0.2).smashers[0].queue).toHaveLength(1);
    expect(run(boosted, t / POWER.boost + 0.2).smashers[0].queue).toHaveLength(0);
  });
  it('Solar Wings need an outside tile, cost Plate, and level up (output, then reach)', () => {
    let s = own(early(), '1,1', '3,1', '1,2', '3,2', '2,3');
    expect(placeModule(s, 'solar', '2,2')).toMatchObject({ ok: false }); // occupied
    s = placed(s, 'solar', '1,1');
    expect(s.items.plate).toBe(200 - 6);
    const uid = lastUid(s);
    const up = upgradeModule(s, uid);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.state.credits).toBe(5000 - SOLAR.levels[1].cost.credits);
    expect(evaluatePower(up.state).supply).toBe(POWER.hullBase + SOLAR.levels[1].output);
  });
});

describe('travel: Engine, Depart, Void Drift, arrival', () => {
  /** early() plus a second beam, two Solar Wings and an Engine on a back tile. */
  function engined(): GameState {
    let s = own(early(), '1,1', '3,1', '3,2', '2,3');
    s = placed(s, 'solar', '1,1');
    s = placed(s, 'beam', '3,1');
    s = placed(s, 'solar', '3,2');
    s = placed(s, 'engine', '2,3');
    return s;
  }
  it('the Engine needs a back tile and comes after the second beam', () => {
    const s = own(early(), '1,1', '2,3');
    expect(isRearCell(new Set(s.ship.ownedCells), '2,3')).toBe(true);
    expect(isRearCell(new Set(s.ship.ownedCells), '2,2')).toBe(false); // (2,3) is behind it now
    expect(placeModule(s, 'engine', '2,3')).toEqual({ ok: false, reason: 'locked' }); // one beam only
    const b2 = placed(own(early(), '1,1', '1,0', '2,3'), 'beam', '1,1');
    expect(placeModule(b2, 'engine', '1,0')).toEqual({ ok: false, reason: 'not_rear' });
    expect(placeModule(b2, 'engine', '2,3').ok).toBe(true);
  });
  it('canDepart explains what is missing', () => {
    expect(canDepart(early())).toMatchObject({ ok: false, reason: 'no_engine' });
    const s = engined();
    expect(canDepart(s)).toEqual({ ok: true });
    const dark = { ...s, ship: { ...s.ship, modules: s.ship.modules.filter((m) => m.defId !== 'solar') } };
    expect(canDepart(dark)).toMatchObject({ ok: false, reason: 'unpowered' });
    const moving = depart(s).state;
    expect(canDepart(moving)).toMatchObject({ ok: false, reason: 'moving' });
    expect(canDepart(at(s, 2))).toMatchObject({ ok: false, reason: 'locked' }); // Veda Orbit opens later
  });
  it('cruising pulls Void Drift rocks (half Ore) and arrives after the leg time; levels go faster', () => {
    const s = depart(engined()).state;
    expect(inTransit(s)).toBe(true);
    expect(zoneOf(s)).toBe(VOID_DRIFT);
    const eta = etaSec(s)!;
    expect(eta).toBeCloseTo(SYSTEM.nodes[1].legSec / engineSpeed(s), 6);
    const fired = run(tapBeam(s).state, BAL.beamCountdown + 0.2);
    expect(fired.crusher.rock?.ore).toBe(Math.round(BAL.rock.dust.ore * VOID_DRIFT.oreMul));
    const arrived = tick(s, eta + 0.01);
    expect(arrived.state.travel).toMatchObject({ node: 1, dest: null, visited: [0, 1] });
    expect(arrived.events).toContainEqual({ kind: 'arrived', node: 1 });
    const fast = upgradeModule(engined(), engined().ship.modules.find((m) => m.defId === 'engine')!.uid);
    if (!fast.ok) return;
    expect(etaSec(depart(fast.state).state)!).toBeCloseTo(eta / ENGINE.levels[1].speed, 6);
  });
  it('arrival is dt-invariant', () => {
    const s = depart(engined()).state;
    const eta = etaSec(s)!;
    expect(tick(s, eta + 1).state.travel.node).toBe(1);
    expect(run(s, eta + 1, 0.5).travel.node).toBe(1);
    expect(run(s, eta - 1, 0.5).travel.node).toBe(0);
  });
  it('without power the ship drifts in place', () => {
    const s = depart(engined()).state;
    const e = s.ship.modules.find((m) => m.defId === 'engine')!;
    const noSolar = { ...s, ship: { ...s.ship, modules: s.ship.modules.filter((m) => m.defId !== 'solar') } };
    expect(evaluatePower(noSolar).powered.has(e.uid)).toBe(false);
    expect(engineSpeed(noSolar)).toBe(0);
    expect(etaSec(noSolar)).toBeNull();
    expect(run(noSolar, 30, 0.5).travel.progress).toBe(0);
  });
  it('the Engine cannot be sold mid-cruise; parked it refunds 75%', () => {
    const s = engined();
    const uid = s.ship.modules.find((m) => m.defId === 'engine')!.uid;
    expect(sellRefund(depart(s).state, uid)).toBeNull();
    expect(sellRefund(s, uid)).toEqual({ credits: 0, items: { plate: 9 } });
    const sold = sellModule(s, uid);
    expect(sold.ok && sold.state.ship.modules.some((m) => m.defId === 'engine')).toBe(false);
  });
});

describe('zones: Ice, Heavy rocks and the Grapple Beam', () => {
  it('the Rubble Belt mixes Ice chunks into Tractor rocks (about 20%)', () => {
    let s = at(early(), 1);
    let ice = 0;
    const n = 600;
    for (let i = 0; i < n; i++) {
      s = { ...s, beams: [{ ...s.beams[0], status: 'counting', remaining: 0.01 }], bay: [], crusher: { ...s.crusher, rock: null } };
      s = tick(s, 0.05, false).state;
      if (s.crusher.rock?.kind === 'ice') ice++;
    }
    expect(ice / n).toBeGreaterThan(0.12);
    expect(ice / n).toBeLessThan(0.28);
  });
  it('the Scrapyard draws no extra random number for rock kind (old seeds play the same)', () => {
    const s = { ...createInitialState(9), beams: [{ uid: 1, kind: 'tractor' as const, status: 'counting' as const, remaining: 0.01, level: 1 }] };
    const out = tick(s, 0.05).state;
    expect(out.crusher.rock?.kind).toBe('dust');
    expect(out.rng).not.toBe(s.rng);
  });
  it('the Grapple is offered at the Belt, pulls Heavy rocks with Ice there and big rocks elsewhere', () => {
    let s = own(early(), '1,1', '1,0');
    s = placed(s, 'solar', '1,0');
    expect(placeModule(s, 'grapple', '1,1')).toEqual({ ok: false, reason: 'locked' });
    s = placed(at(s, 1), 'grapple', '1,1');
    expect(s.beams[1]).toMatchObject({ kind: 'grapple', level: 1 });
    const fired = tapBeam(s, 1).state;
    expect(evaluatePower(s).boosted.has(s.beams[1].uid)).toBe(true); // the Solar Wing next to it
    expect(fired.beams[1].remaining).toBeCloseTo(GRAPPLE.countdown / POWER.boost, 6);
    const landed = run(fired, GRAPPLE.countdown + 0.2);
    const rock = landed.crusher.rock ?? landed.bay[0];
    expect(rock).toMatchObject({ kind: 'heavy', ore: BAL.rock.heavy.ore, ice: 2 });
    const back = { ...landed, travel: { ...landed.travel, node: 0 }, crusher: { ...landed.crusher, rock: null }, bay: [] };
    const big = run(tapBeam(back, 1).state, GRAPPLE.countdown + 0.2);
    expect((big.crusher.rock ?? big.bay[0])).toMatchObject({ kind: 'big', ore: BAL.rock.big.ore, ice: 0 });
  });
  it('Grapple levels shorten its countdown', () => {
    let s = own(at(early(), 1), '1,1', '1,0');
    s = placed(placed(s, 'solar', '1,0'), 'grapple', '1,1');
    const up = upgradeBeam(s, 1);
    if (!up.ok) throw new Error('up');
    expect(up.state.credits).toBe(5000 - GRAPPLE.levels[1].cost.credits);
    expect(tapBeam(up.state, 1).state.beams[1].remaining).toBeCloseTo((GRAPPLE.countdown * GRAPPLE.levels[1].cdMul) / POWER.boost, 6);
  });
  it('cracking a rock with Ice adds Ice; Ice buys tile 10', () => {
    const s0 = early();
    const iceRock: Rock = { kind: 'ice', geode: false, hp: 1, maxHp: 35, ore: 1, ice: 2 };
    const s = { ...s0, items: { ...s0.items, ice: 0 }, crusher: { ...s0.crusher, rock: iceRock, weakT: 5 } };
    const out = tapCrush(s, 0.9, 0.9);
    expect(out.state.items.ice).toBe(2);
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'crushed', ice: 2 }));
    // a 9-tile ship can buy tile 10 with Ice
    const nine = { ...out.state, ship: { ...out.state.ship, ownedCells: ['2,0', '2,1', '2,2', '1,0', '1,1', '1,2', '3,1', '3,2', '2,3'] }, items: { ...out.state.items, plate: 6, ice: 3 }, credits: 1000 };
    const r = buyTile(nine, { x: 1, y: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.items.ice).toBe(0);
  });
});

describe('offline (Patch 7.2 + travel)', () => {
  it('splits time away at the tier edge and the Smelter cut-off', () => {
    expect(segments(3 * 3600)).toEqual([
      { realSec: OFFLINE.smelterSec, rate: 0.3, smelt: true },
      { realSec: 2 * 3600 - OFFLINE.smelterSec, rate: 0.3, smelt: false },
      { realSec: 3600, rate: 0.1, smelt: false },
    ]);
    expect(segments(600)).toEqual([{ realSec: 600, rate: 0.3, smelt: true }]);
  });
  it('travel runs at full speed while away (a 6 minute leg is done after 10 minutes away)', () => {
    let s = own(early(), '1,1', '3,1', '3,2', '2,3');
    s = placed(placed(placed(placed(s, 'solar', '1,1'), 'beam', '3,1'), 'solar', '3,2'), 'engine', '2,3');
    s = { ...depart(s).state, savedAt: 1_000_000 };
    const { state, report } = applyOffline(s, 1_000_000 + 10 * 60 * 1000);
    expect(state.travel.node).toBe(1);
    expect(report!.arrived).toEqual(['Rubble Belt']);
    expect(report!.stillCruising).toBe(false);
    // away 3 minutes: still on the way
    const short = applyOffline(s, 1_000_000 + 3 * 60 * 1000);
    expect(short.report!.stillCruising).toBe(true);
    expect(short.state.travel.progress).toBeGreaterThan(150);
  });
  it('an 8 hour return keeps Ore: Smelters go cold after 30 minutes', () => {
    const s0 = early();
    const s = { ...s0, items: { ...s0.items, ore: 0, plate: 0 }, savedAt: 5_000 };
    const { state, report } = applyOffline(s, 5_000 + 8 * 3600 * 1000);
    expect(report!.smeltersCooled).toBe(true);
    expect(state.items.ore).toBeGreaterThan(state.items.plate * 3); // more raw Ore than smelted
    expect(state.items.ore).toBeGreaterThan(300);
  });
});

describe('goal chain (Day 8)', () => {
  it('asks for a Solar Wing before the second beam when the hull power is used up', () => {
    let s = own(early(), '1,1', '3,1', '1,0', '2,3');
    expect(currentGoal(s)?.id).toBe('solar'); // the hull's 3 power are used up
    s = placed(s, 'solar', '1,1');
    expect(currentGoal(s)?.id).toBe('beam2');
    s = placed(s, 'beam', '3,1');
    // 3 + 2 supply, 4 draw: 1 spare, but the Engine draws 2, so the chain asks for more power first
    expect(evaluatePower(s).supply - evaluatePower(s).draw).toBe(1);
    expect(currentGoal(s)?.id).toBe('solar');
  });
  it('asks for a Solar Wing before the Engine when power is short, then Depart, cruise, Grapple', () => {
    let s = own(early(), '1,1', '3,1', '1,0', '3,2', '2,3');
    s = placed(s, 'solar', '1,1');
    s = placed(s, 'beam', '3,1');
    // 1 spare, the Engine draws 2
    expect(currentGoal(s)?.id).toBe('solar');
    s = placed(s, 'solar', '3,2');
    expect(currentGoal(s)?.id).toBe('engine');
    s = placed(s, 'engine', '2,3');
    expect(currentGoal(s)?.id).toBe('depart');
    s = depart(s).state;
    expect(currentGoal(s)?.id).toBe('cruise');
    s = tick(s, etaSec(s)! + 0.1).state;
    expect(currentGoal(s)?.id).toBe('grapple');
    s = placed(s, 'grapple', '1,0');
    expect(currentGoal(s)).toBeNull();
  });
});

describe('save v8', () => {
  it('v7 -> v8: beams get their module uid and kind, travel starts at the Scrapyard; idempotent', () => {
    const s7 = JSON.parse(serialize(early())) as Record<string, unknown> & { beams: Record<string, unknown>[]; travel?: unknown; flags: Record<string, unknown> };
    s7.version = 7;
    s7.beams = s7.beams.map(({ uid: _u, kind: _k, ...b }) => b);
    delete s7.travel;
    delete s7.flags.powerNotice;
    const r = parseSave(JSON.stringify(s7));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.beams[0]).toMatchObject({ uid: 1, kind: 'tractor' });
    expect(r.state.travel).toEqual({ node: 0, dest: null, progress: 0, visited: [0] });
    expect(r.state.flags.powerNotice).toBe(0); // 3 draw, 3 supply: no gift needed
    const again = parseSave(serialize(r.state));
    expect(again.ok && again.state).toEqual(r.state);
  });
  it('a ship that now lacks power gets the Plate for the Solar Wings it needs, once', () => {
    let big = own(early(), '1,0', '1,1', '1,2', '3,1', '3,2');
    big = placed(placed(big, 'beam', '1,1'), 'beam', '3,1');
    big = placed(placed(big, 'smasher', '1,2'), 'smelter', '3,2'); // 7 draw, 3 supply
    const v7 = JSON.parse(serialize(big)) as Record<string, unknown> & { flags: Record<string, unknown> };
    v7.version = 7;
    delete v7.flags.powerNotice;
    delete v7.travel;
    const r = parseSave(JSON.stringify(v7));
    if (!r.ok) throw new Error('parse');
    expect(r.state.flags.powerNotice).toBe(6 + 6); // 2 Solar Wings
    expect(r.state.items.plate).toBe(big.items.plate + 12);
    expect(parseSave(serialize(r.state)).ok && (parseSave(serialize(r.state)) as { state: GameState }).state.items.plate).toBe(r.state.items.plate);
  });
  it('Move keeps placement rules for Solar (outside) and Engine (back) tiles', () => {
    let s = own(early(), '1,1', '3,1', '2,3', '1,2');
    s = placed(placed(placed(s, 'solar', '1,1'), 'beam', '3,1'), 'engine', '2,3');
    const e: ModuleInstance = s.ship.modules.find((m) => m.defId === 'engine')!;
    expect(moveModule(s, e.uid, '1,2')).toMatchObject({ ok: true }); // (1,3) is open behind it
    const blocked = own(s, '1,3');
    expect(moveModule(blocked, e.uid, '1,2')).toEqual({ ok: false, reason: 'not_rear' });
  });
});

describe('a full ship that cannot grow yet', () => {
  it('asks to make room instead of an Expand hull it cannot pay for (tile 10 needs Ice before the Belt)', async () => {
    const { chipText, tileOutOfReach } = await import('../src/core/goals');
    const nine = ['1,0', '1,1', '1,2', '3,1', '3,2', '2,3'];
    let s = own(early(), ...nine);
    s = placed(placed(s, 'beam', '1,1'), 'beam', '3,1');
    s = placed(placed(s, 'smasher', '1,0'), 'smasher', '1,2');
    s = placed(placed(s, 'smelter', '3,2'), 'smelter', '2,3');
    s = { ...s, items: { ...s.items, ice: 0 } };
    expect(tileOutOfReach(s)).toBe(true);
    expect(currentGoal(s)).toMatchObject({ id: 'make-room', text: expect.stringMatching(/Sell or Move/) });
    // once the ship has been to the Belt, Ice is just something to collect
    expect(tileOutOfReach(at(s, 1))).toBe(false);
    void chipText;
  });
});

describe('power lines (graphics pass)', () => {
  it('says which Solar Wing (or the hull, 0) powers each module', () => {
    let s = own(early(), '1,1', '3,1');
    s = placed(placed(s, 'solar', '1,1'), 'beam', '3,1');
    const p = evaluatePower(s);
    const solar = s.ship.modules.find((m) => m.defId === 'solar')!.uid;
    expect([...p.from.values()].filter((v) => v === solar).length).toBe(SOLAR.levels[0].output);
    expect([...p.from.values()].filter((v) => v === 0).length).toBe(p.powered.size - SOLAR.levels[0].output);
    for (const uid of p.powered) expect(p.from.has(uid)).toBe(true);
  });
});
