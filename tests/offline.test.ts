import { describe, expect, it } from 'vitest';
import { applyOffline, effectiveSeconds, stamp } from '../src/core/offline';
import { deserialize, serialize } from '../src/core/save';
import { createInitialState } from '../src/core/state';
import type { GameState, Rock } from '../src/core/types';
import { OFFLINE } from '../src/data/offline';

const H = 3600;
const T0 = 1_800_000_000_000;
const repaired = (): GameState => {
  const s = createInitialState();
  return stamp({ ...s, smasher: { ...s.smasher, repaired: true } }, T0);
};
const later = (s: GameState, sec: number) => applyOffline(s, T0 + sec * 1000);
const geode: Rock = { kind: 'dust', geode: true, hp: 53, maxHp: 53, ore: 4 };

describe('offline tiers', () => {
  it('30% for the first 2 hours, 10% up to 8 hours, nothing after', () => {
    expect(effectiveSeconds(1 * H).effective).toBeCloseTo(0.3 * H, 6);
    expect(effectiveSeconds(2 * H).effective).toBeCloseTo(0.6 * H, 6);
    expect(effectiveSeconds(3 * H).effective).toBeCloseTo(0.6 * H + 0.1 * H, 6);
    expect(effectiveSeconds(8 * H).effective).toBeCloseTo(0.6 * H + 0.6 * H, 6);
    expect(effectiveSeconds(30 * H).effective).toBeCloseTo(0.6 * H + 0.6 * H, 6);
    expect(effectiveSeconds(30 * H).counted).toBe(8 * H);
    expect(effectiveSeconds(-5).effective).toBe(0);
  });
  it('tier table matches the locked design', () => {
    expect(OFFLINE.tiers.map((t) => [t.upToSec / H, t.rate])).toEqual([[2, 0.3], [8, 0.1]]);
    expect(OFFLINE.minAwaySec).toBe(120);
  });
});

describe('applyOffline', () => {
  it('says nothing the first time, after a short break, or if the clock went backwards', () => {
    const fresh = createInitialState();
    expect(applyOffline(fresh, T0).report).toBeNull();
    expect(applyOffline(fresh, T0).state.savedAt).toBe(T0);
    expect(later(repaired(), 119).report).toBeNull();
    expect(later(repaired(), -50).report).toBeNull();
    expect(later(repaired(), 119).state.stats).toEqual(repaired().stats);
  });

  it('a repaired Smasher keeps smashing while you are away (about 30% for the first hour)', () => {
    const { state, report } = later(repaired(), 1 * H);
    expect(report).not.toBeNull();
    // 1 h away = 1080 s of play; the L1 Smasher clears one 35 HP rock per 15.6 s -> about 69 rocks
    expect(report!.rocksSmashed).toBeGreaterThan(55);
    expect(report!.rocksSmashed).toBeLessThan(75);
    expect(state.items.ore).toBe(report!.rocksSmashed * 4);
    expect(report!.items.ore).toBe(state.items.ore);
    expect(state.stats.geodes).toBe(0); // geodes need hands
    expect(state.credits).toBe(repaired().credits); // nothing is sold for you
    expect(state.savedAt).toBe(T0 + H * 1000);
  });

  it('a rusty Smasher earns nothing, and the welcome-back says why', () => {
    const rusty = stamp(createInitialState(), T0);
    const { state, report } = later(rusty, 3 * H);
    expect(report!.rocksSmashed).toBe(0);
    expect(state.items.ore).toBe(0);
    expect(report!.smasherRusty).toBe(true);
  });

  it('the Smelter turns held Ore into Plate even with a rusty Smasher', () => {
    const base = stamp(createInitialState(), T0);
    const s: GameState = { ...base, smelter: { built: true, level: 1, on: true, progress: 0 }, items: { ...base.items, ore: 300 }, stats: { ...base.stats, sold: 3 } };
    const { state, report } = later(s, 1 * H);
    expect(state.items.plate).toBe(100);
    expect(state.items.ore).toBe(0);
    expect(report!.items.plate).toBe(100);
    expect(report!.items.ore).toBe(-300);
  });

  it('is capped at 8 hours: 20 h away equals 8 h away', () => {
    const a = later(repaired(), 8 * H);
    const b = later(repaired(), 20 * H);
    expect(b.report!.capped).toBe(true);
    expect(a.report!.capped).toBe(false);
    expect({ ...b.state, savedAt: 0 }).toEqual({ ...a.state, savedAt: 0 });
  });

  it('a geode waiting in the crusher stalls the beams and is reported', () => {
    const s = repaired();
    const withGeode: GameState = { ...s, crusher: { ...s.crusher, rock: geode } };
    const { state, report } = later(withGeode, 2 * H);
    expect(report!.geodeWaiting).toBe(true);
    expect(report!.rocksSmashed).toBe(0);
    expect(state.crusher.rock?.geode).toBe(true);
  });

  it('is deterministic, does not touch its input, and does not repeat when applied twice', () => {
    const s = repaired();
    const snap = JSON.stringify(s);
    const a = later(s, 2 * H);
    expect(JSON.stringify(s)).toBe(snap);
    expect(later(s, 2 * H).state).toEqual(a.state);
    const again = applyOffline(a.state, T0 + 2 * H * 1000);
    expect(again.report).toBeNull();
    expect(again.state.items).toEqual(a.state.items);
  });

  it('more Smasher levels earn more away', () => {
    const l1 = later(repaired(), 2 * H).report!.rocksSmashed;
    const s = repaired();
    const l4 = later({ ...s, smasher: { ...s.smasher, level: 4 } }, 2 * H).report!.rocksSmashed;
    expect(l4).toBeGreaterThan(l1 * 1.8);
  });
});

describe('save v4 -> v5', () => {
  it('adds savedAt = 0 so an old save earns no offline time, and round-trips', () => {
    const v4 = { ...createInitialState(), version: 4, savedAt: undefined } as unknown as Record<string, unknown>;
    delete v4.savedAt;
    const s = deserialize(JSON.stringify(v4));
    expect(s.version).toBe(5);
    expect(s.savedAt).toBe(0);
    expect(deserialize(serialize(s))).toEqual(s);
    expect(deserialize(serialize(stamp(s, T0))).savedAt).toBe(T0);
  });
});
