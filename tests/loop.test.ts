import { describe, expect, it } from 'vitest';
import { currentGoal } from '../src/core/goals';
import { sell, tapBeam, tapCrush, tick, weakActive } from '../src/core/loop';
import { nextRandom } from '../src/core/rng';
import { deserialize } from '../src/core/save';
import { createInitialState } from '../src/core/state';
import type { GameState } from '../src/core/types';
import { BAL } from '../src/data/balance';

const run = (s: GameState, seconds: number, step = 0.05, geode?: boolean): GameState => {
  let cur = s;
  for (let t = 0; t < seconds - 1e-9; t += step) cur = tick(cur, step, geode).state;
  return cur;
};

describe('rng', () => {
  it('is deterministic and in [0,1)', () => {
    const [a, s1] = nextRandom(42);
    const [b] = nextRandom(42);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(nextRandom(s1)[0]).not.toBe(a);
  });
});

describe('beam and Bay', () => {
  it('tap starts a countdown; a rock arrives in the Bay (then the crusher) when it ends', () => {
    let s = tapBeam(createInitialState()).state;
    expect(s.beams[0].status).toBe('counting');
    expect(s.flags.tappedBeam).toBe(true);
    s = run(s, BAL.beamCountdown - 0.5);
    expect(s.beams[0].status).toBe('counting');
    expect(s.crusher.rock).toBeNull();
    s = run(s, 1);
    expect(s.beams[0].status).toBe('idle');
    expect(s.crusher.rock).not.toBeNull(); // auto-loaded from the Bay
  });
  it('ignores a second tap while counting', () => {
    const a = tapBeam(createInitialState()).state;
    const b = tapBeam(run(a, 1)).state;
    expect(b.beams[0].remaining).toBeCloseTo(BAL.beamCountdown - 1, 1);
  });
  it('blocks when the Bay is full and delivers once a slot frees', () => {
    let s = createInitialState();
    const rock = { kind: 'dust' as const, geode: false, hp: 99, maxHp: 99, ore: 3 };
    s = { ...s, bay: [rock, rock, rock], crusher: { ...s.crusher, rock } };
    s = run(tapBeam(s).state, BAL.beamCountdown + 0.5);
    expect(s.beams[0].status).toBe('blocked');
    expect(s.bay).toHaveLength(3);
    s = { ...s, crusher: { ...s.crusher, rock: null } }; // crusher takes a rock, freeing a slot
    s = run(s, 0.2);
    expect(s.beams[0].status).toBe('idle');
  });
  it('a huge dt does not break anything', () => {
    const s = tick(tapBeam(createInitialState()).state, 3600).state;
    expect(s.beams[0].status).toBe('idle');
    expect(s.bay.length + (s.crusher.rock ? 1 : 0)).toBe(1);
  });
});

function withRock(geode = false): GameState {
  let s = run(tapBeam(createInitialState()).state, BAL.beamCountdown + 0.2, 0.05, geode);
  s = { ...s, crusher: { ...s.crusher, weakT: 0, weakX: 0.3, weakY: 0 } };
  return s;
}

describe('crusher', () => {
  it('a normal tap does 1 damage and adds heat', () => {
    const s = withRock();
    const hp = s.crusher.rock!.hp;
    const r = tapCrush(s, -0.8, 0.5); // far from the weak point
    expect(r.state.crusher.rock!.hp).toBe(hp - BAL.tapDmg);
    expect(r.state.crusher.heat).toBe(BAL.heat.perTap);
    expect(r.events[0]).toEqual({ kind: 'hit', crit: false });
  });
  it('hitting the visible weak point is a 3x crit and removes heat', () => {
    const s = withRock();
    expect(weakActive(s)).toBe(true);
    const hp = s.crusher.rock!.hp;
    const r = tapCrush(s, 0.3, 0.05);
    expect(r.state.crusher.rock!.hp).toBe(hp - BAL.weak.dmg);
    expect(r.events[0]).toEqual({ kind: 'hit', crit: true });
    expect(r.state.crusher.heat).toBe(0);
  });
  it('the weak point cannot be hit while hidden', () => {
    const s = withRock();
    const hidden = { ...s, crusher: { ...s.crusher, weakT: BAL.weak.active + 0.1 } };
    expect(tapCrush(hidden, 0.3, 0).events[0]).toEqual({ kind: 'hit', crit: false });
  });
  it('crushing a dust rock yields Ore and counts it', () => {
    let s = withRock();
    for (let i = 0; i < 40 && s.crusher.rock; i++) s = tapCrush(s, -0.9, 0.9).state;
    expect(s.crusher.rock).toBeNull();
    expect(s.items.ore).toBe(BAL.rock.dust.ore);
    expect(s.stats.rocks).toBe(1);
  });
  it('overheats at 100 heat and locks out, then recovers', () => {
    let s = withRock();
    s = { ...s, crusher: { ...s.crusher, rock: { ...s.crusher.rock!, hp: 999, maxHp: 999 }, heat: 98 } };
    const r = tapCrush(s, -0.9, 0.9);
    expect(r.events.some((e) => e.kind === 'overheat')).toBe(true);
    expect(r.state.crusher.lockout).toBe(BAL.heat.lockout);
    const hp = r.state.crusher.rock!.hp;
    expect(tapCrush(r.state, -0.9, 0.9).state.crusher.rock!.hp).toBe(hp); // locked out
    const later = run(r.state, BAL.heat.lockout + 0.1);
    expect(later.crusher.lockout).toBe(0);
  });
  it('heat cools over time', () => {
    const s = withRock();
    const hot = { ...s, crusher: { ...s.crusher, heat: 60 } };
    expect(run(hot, 2).crusher.heat).toBeCloseTo(60 - 2 * BAL.heat.cool, 0);
  });
  it('a geode pays a jackpot; every 12th geode guarantees a Core Shard', () => {
    let s = withRock(true);
    expect(s.crusher.rock!.geode).toBe(true);
    for (let i = 0; i < 60 && s.crusher.rock; i++) s = tapCrush(s, -0.9, 0.9).state;
    expect(s.stats.geodes).toBe(1);
    expect(s.credits).toBe(BAL.startCredits + BAL.rock.dust.ore * BAL.geode.jackpotOreMul);
    // pity
    let p = withRock(true);
    p = { ...p, pity: BAL.geode.pity - 1 };
    for (let i = 0; i < 60 && p.crusher.rock; i++) p = tapCrush(p, -0.9, 0.9).state;
    expect(p.items.core_shard).toBe(1);
    expect(p.pity).toBe(0);
  });
  it('geode frequency is near the configured rate over many rocks', () => {
    let s = createInitialState(7);
    let geodes = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      s = { ...s, beams: [{ status: 'counting', remaining: 0.01 }], bay: [], crusher: { ...s.crusher, rock: null } };
      s = tick(s, 0.1).state;
      if (s.crusher.rock?.geode) geodes++;
    }
    expect(geodes / n).toBeGreaterThan(BAL.geode.rate * 0.6);
    expect(geodes / n).toBeLessThan(BAL.geode.rate * 1.5);
  });
  it('is deterministic for the same seed', () => {
    const a = JSON.stringify(run(tapBeam(createInitialState(5)).state, 10));
    const b = JSON.stringify(run(tapBeam(createInitialState(5)).state, 10));
    expect(a).toBe(b);
  });
});

describe('sell and goals', () => {
  it('sells all Ore at its price and does not mutate the input', () => {
    const s = { ...createInitialState(), items: { ...createInitialState().items, ore: 7 } };
    const before = JSON.stringify(s);
    const r = sell(s, 'ore');
    expect(r.state.items.ore).toBe(0);
    expect(r.state.credits).toBe(BAL.startCredits + 7);
    expect(r.state.stats.sold).toBe(7);
    expect(JSON.stringify(s)).toBe(before);
    expect(sell(r.state, 'ore').events).toEqual([]);
  });
  it('goal chain: tap beam, crush, sell, then the hull goal takes over', () => {
    let s = createInitialState();
    expect(currentGoal(s)?.id).toBe('tap-beam');
    s = tapBeam(s).state;
    expect(currentGoal(s)?.id).toBe('crush');
    s = { ...s, stats: { ...s.stats, rocks: 1 } };
    expect(currentGoal(s)?.id).toBe('sell');
    s = { ...s, stats: { ...s.stats, sold: 1 } };
    expect(currentGoal(s)).toBeNull();
  });
});

describe('save migration', () => {
  it('upgrades a v1 save and keeps credits, items and hull', () => {
    const v1 = JSON.stringify({
      version: 1, credits: 321, items: { ore: 5 },
      ship: { hullId: 'tug', ownedCells: ['2,0', '2,1', '2,2', '1,2'] },
    });
    const s = deserialize(v1);
    expect(s.version).toBe(2);
    expect(s.credits).toBe(321);
    expect(s.items.ore).toBe(5);
    expect(s.items.ice).toBe(0);
    expect(s.ship.ownedCells).toHaveLength(4);
    expect(s.beams).toHaveLength(1);
  });
});
