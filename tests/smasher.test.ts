import { describe, expect, it } from 'vitest';
import {
  canSend, holdCrush, releaseHold, repairSmasher, sendToSmasher, tapCrush, tick, upgradeSmasher,
} from '../src/core/loop';
import { createInitialState } from '../src/core/state';
import type { GameState, Rock } from '../src/core/types';
import { BAL } from '../src/data/balance';
import { SMASHER } from '../src/data/smasher';

const dust = (hp: number = BAL.rock.dust.hp): Rock => ({ kind: 'dust', geode: false, hp, maxHp: BAL.rock.dust.hp, ore: BAL.rock.dust.ore });
const geode = (): Rock => ({ kind: 'dust', geode: true, hp: 52, maxHp: 52, ore: 4 });

function base(over: Partial<GameState> = {}): GameState {
  const s = createInitialState();
  return {
    ...s,
    smasher: { repaired: true, level: 1, queue: [] },
    crusher: { ...s.crusher, rock: dust(), weakT: 5, weakX: 0, weakY: 0 },
    ...over,
  };
}
const run = (s: GameState, secs: number, step = 0.05): GameState => {
  let cur = s;
  for (let t = 0; t < secs - 1e-9; t += step) cur = tick(cur, step).state;
  return cur;
};

describe('rebalanced numbers', () => {
  it('a dust rock takes 35 HP; a casual 1.6 taps/s tapper needs ~22 s without weak points', () => {
    expect(BAL.rock.dust.hp).toBe(35);
    expect(BAL.rock.dust.hp / (1.6 * BAL.tapDmg)).toBeGreaterThan(20);
  });
  it('the Smasher still needs ~15.6 s per dust rock at L1 (HP/s scaled with rock HP)', () => {
    expect(BAL.rock.dust.hp / SMASHER.levels[0].hpPerSec).toBeCloseTo(15.6, 1);
  });
});

describe('Rusty Smasher and repair', () => {
  it('starts rusty and cannot receive rocks', () => {
    const s = createInitialState();
    expect(s.smasher.repaired).toBe(false);
    expect(canSend({ ...s, crusher: { ...s.crusher, rock: dust() } })).toMatchObject({ ok: false, reason: 'rusty' });
  });
  it('repair needs the materials, then spends them and repairs once', () => {
    const s = createInitialState();
    expect(repairSmasher(s)).toEqual({ ok: false, reason: 'need_items' });
    const rich = { ...s, items: { ...s.items, plate: 10 } };
    const r = repairSmasher(rich);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.smasher.repaired).toBe(true);
      expect(r.state.items.plate).toBe(10 - 8);
      expect(repairSmasher(r.state)).toEqual({ ok: false, reason: 'already' });
    }
  });
});

describe('sendToSmasher', () => {
  it('moves the stage rock to the queue, keeps its damage, and the next Bay rock loads', () => {
    const s = base({ bay: [dust()] });
    const hurt = { ...s, crusher: { ...s.crusher, rock: dust(5) } };
    const r = sendToSmasher(hurt);
    expect(r.state.smasher.queue).toHaveLength(1);
    expect(r.state.smasher.queue[0].hp).toBe(5);
    expect(r.state.crusher.rock).toBeNull();
    expect(r.state.stats.sent).toBe(1);
    const after = tick(r.state, 0.05).state;
    expect(after.crusher.rock).not.toBeNull();
    expect(after.bay).toHaveLength(0);
  });
  it('rejects when full, with a geode, with no rock, and does not mutate the input', () => {
    const full = base({ smasher: { repaired: true, level: 1, queue: [dust(), dust()] } });
    expect(canSend(full)).toMatchObject({ ok: false, reason: 'full', label: 'Smasher full 2/2' });
    expect(sendToSmasher(full).state).toBe(full);
    const g = base();
    const withGeode = { ...g, crusher: { ...g.crusher, rock: geode() } };
    expect(canSend(withGeode)).toMatchObject({ ok: false, reason: 'geode', label: 'Crack this one yourself' });
    expect(canSend(base({ crusher: { ...createInitialState().crusher, rock: null } }))).toMatchObject({ reason: 'no_rock' });
    const before = JSON.stringify(g);
    sendToSmasher(g);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('Smasher working', () => {
  it('smashes the head rock at its HP/s and pays Ore (L1: 14 HP in 15.6 s)', () => {
    let s = base({ smasher: { repaired: true, level: 1, queue: [dust()] }, crusher: { ...createInitialState().crusher, rock: null } });
    s = run(s, 15);
    expect(s.smasher.queue).toHaveLength(1);
    expect(s.items.ore).toBe(0);
    s = run(s, 1);
    expect(s.smasher.queue).toHaveLength(0);
    expect(s.items.ore).toBe(BAL.rock.dust.ore);
    expect(s.stats.smashed).toBe(1);
  });
  it('is dt-invariant: one 10 s step equals 200 steps of 0.05 s', () => {
    const start = base({ smasher: { repaired: true, level: 3, queue: [dust(), dust(), dust()] }, crusher: { ...createInitialState().crusher, rock: null } });
    const big = tick(start, 10).state;
    const small = run(start, 10);
    expect(big.items.ore).toBe(small.items.ore);
    expect(big.smasher.queue.map((r) => Math.round(r.hp * 100))).toEqual(small.smasher.queue.map((r) => Math.round(r.hp * 100)));
  });
  it('a rusty Smasher does nothing', () => {
    const s = base({ smasher: { repaired: false, level: 1, queue: [dust()] } });
    expect(run(s, 30).items.ore).toBe(0);
  });
  it('conserves Ore: every rock pays exactly once', () => {
    let s = base({ smasher: { repaired: true, level: 4, queue: [dust(), dust(), dust(), dust(), dust()] }, crusher: { ...createInitialState().crusher, rock: null } });
    s = run(s, 60);
    expect(s.items.ore).toBe(5 * BAL.rock.dust.ore);
    expect(s.smasher.queue).toHaveLength(0);
  });
  it('upgrades cost credits, raise the queue cap, and stop at level 4', () => {
    let s = base();
    expect(upgradeSmasher(s)).toEqual({ ok: false, reason: 'need_credits' });
    s = { ...s, credits: 5000 };
    for (let lv = 2; lv <= 4; lv++) {
      const r = upgradeSmasher(s);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
      expect(s.smasher.level).toBe(lv);
    }
    expect(upgradeSmasher(s)).toEqual({ ok: false, reason: 'max_level' });
    expect(s.credits).toBe(5000 - 150 - 450 - 1350);
    expect(SMASHER.levels[3].queue).toBe(5);
  });
});

describe('auto-intake (Smasher L2+)', () => {
  const beamDone = (s: GameState): GameState => ({ ...s, beams: [{ status: 'counting', remaining: 0.01, level: 1 }] });
  it('L1: rocks go to the Bay, never the queue', () => {
    const s = tick(beamDone(base({ crusher: { ...createInitialState().crusher, rock: null } })), 0.1).state;
    expect(s.smasher.queue).toHaveLength(0);
    expect(s.crusher.rock ?? s.bay[0]).toBeTruthy();
  });
  it('L2: takes plain rocks only when the Bay already holds one, so the player keeps a rock to tap', () => {
    const l2 = { repaired: true, level: 2, queue: [] as Rock[] };
    const emptyBay = tick(beamDone(base({ smasher: l2, bay: [] })), 0.1, false).state;
    expect(emptyBay.smasher.queue).toHaveLength(0);
    const withBay = tick(beamDone(base({ smasher: l2, bay: [dust()] })), 0.1, false).state;
    expect(withBay.smasher.queue).toHaveLength(1);
  });
  it('L2: geodes always go to the Bay', () => {
    const l2 = { repaired: true, level: 2, queue: [] as Rock[] };
    const s = tick(beamDone(base({ smasher: l2, bay: [dust()] })), 0.1, true).state;
    expect(s.smasher.queue).toHaveLength(0);
    expect(s.bay.some((r) => r.geode) || s.crusher.rock?.geode).toBe(true);
  });
});

describe('hold-to-crush and heat', () => {
  const holdFor = (s: GameState, secs: number, step = 1 / 60): GameState => {
    let cur = s;
    for (let t = 0; t < secs - 1e-9; t += step) {
      cur = tick(cur, step).state;
      cur = holdCrush(cur, step, -0.9, 0.9).state; // away from the weak point
    }
    return cur;
  };
  it('does nothing until the hold delay passes, then auto-taps 8 per second at 1 dmg', () => {
    const s = base();
    const early = holdFor(s, BAL.hold.delay - 0.05);
    expect(early.crusher.rock!.hp).toBe(BAL.rock.dust.hp);
    const later = holdFor(s, BAL.hold.delay + 1);
    expect(later.stats.holdTicks).toBeGreaterThanOrEqual(7);
    expect(later.stats.holdTicks).toBeLessThanOrEqual(9);
    expect(later.flags.usedHold).toBe(true);
  });
  it('a held rock of 35 HP is cracked in about 4.4 s of holding (heat permitting), paying Ore', () => {
    // start cool and give it extra time; a pure holder may jam once on the way
    const s = holdFor(base(), 9);
    expect(s.stats.rocks).toBe(1);
    expect(s.items.ore).toBe(BAL.rock.dust.ore);
  });
  it('heat does not cool while holding, and cools again after release', () => {
    let s = holdFor(base({ crusher: { ...createInitialState().crusher, rock: dust(999), heat: 30 } }), 1);
    const hot = s.crusher.heat;
    expect(hot).toBeGreaterThan(30);
    s = releaseHold(s).state;
    expect(s.crusher.holding).toBe(false);
    s = run(s, 1);
    expect(s.crusher.heat).toBeLessThan(hot);
  });
  it('holding overheats at 100, locks out all input, and the hold ends', () => {
    let s = holdFor(base({ crusher: { ...createInitialState().crusher, rock: dust(9999) } }), 10);
    expect(s.stats.overheats).toBeGreaterThanOrEqual(1);
    const locked = { ...s, crusher: { ...s.crusher, lockout: 1.5, holding: false } };
    const hp = locked.crusher.rock!.hp;
    expect(tapCrush(locked, 0, 0).state.crusher.rock!.hp).toBe(hp);
    expect(holdCrush(locked, 1, 0, 0).state.crusher.rock!.hp).toBe(hp);
    s = run(locked, 2);
    expect(s.crusher.lockout).toBe(0);
  });
  it('dragging the held finger over the visible weak point crits (once per appearance)', () => {
    let s = base({ crusher: { ...createInitialState().crusher, rock: dust(999), weakT: 0, weakX: 0.3, weakY: 0.1 } });
    s = { ...s, crusher: { ...s.crusher, holdT: BAL.hold.delay } };
    const r = holdCrush(s, 0.13, 0.3, 0.1); // exactly one tick on the weak point
    expect(r.events.filter((e) => e.kind === 'hit' && e.crit)).toHaveLength(1);
    expect(r.state.crusher.rock!.hp).toBe(999 - BAL.weak.dmg);
    const again = holdCrush(r.state, 0.13, 0.3, 0.1);
    expect(again.events.filter((e) => e.kind === 'hit' && e.crit)).toHaveLength(0);
  });
  it('heat per rock for a pure holder (no weak-point hits) exceeds one overheat, so aiming matters', () => {
    const perRock = (BAL.rock.dust.hp / BAL.hold.dmg) * BAL.heat.perHoldTick;
    expect(perRock).toBeGreaterThan(BAL.heat.max);
    // sustained hold heats at rate x perHoldTick per second, jamming in about 3 s
    const secsToJam = BAL.heat.max / (BAL.hold.rate * BAL.heat.perHoldTick);
    expect(secsToJam).toBeGreaterThan(2);
    expect(secsToJam).toBeLessThan(4);
  });
  it('releaseHold is a no-op when nothing is held', () => {
    const s = base();
    expect(releaseHold(s).state).toBe(s);
  });
});
