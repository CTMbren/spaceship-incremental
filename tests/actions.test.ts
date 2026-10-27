import { describe, expect, it } from 'vitest';
import { buyTile } from '../src/core/actions';
import { createInitialState } from '../src/core/state';
import { deserialize, serialize } from '../src/core/save';

describe('buyTile', () => {
  it('refuses without materials, then buys with them and does not mutate the input', () => {
    const s = createInitialState();
    const before = JSON.stringify(s);
    expect(buyTile(s, { x: 1, y: 2 })).toEqual({ ok: false, reason: 'need_items' });
    const rich = { ...s, credits: 500, items: { ...s.items, ore: 10 } };
    const r = buyTile(rich, { x: 1, y: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.credits).toBe(440);
      expect(r.state.items.ore).toBe(6);
      expect(r.state.ship.ownedCells).toContain('1,2');
    }
    expect(JSON.stringify(s)).toBe(before);
  });
  it('refuses cells that do not touch the hull or are not in the template', () => {
    const rich = { ...createInitialState(), credits: 999, items: { ...createInitialState().items, ore: 99 } };
    expect(buyTile(rich, { x: 4, y: 3 })).toEqual({ ok: false, reason: 'not_unlockable' });
    expect(buyTile(rich, { x: 9, y: 9 })).toEqual({ ok: false, reason: 'not_unlockable' });
  });
  it('refuses with too few credits', () => {
    const s = { ...createInitialState(), credits: 10, items: { ...createInitialState().items, ore: 99 } };
    expect(buyTile(s, { x: 1, y: 2 })).toEqual({ ok: false, reason: 'need_credits' });
  });
});

describe('save', () => {
  it('round-trips and survives garbage', () => {
    const s = createInitialState();
    expect(deserialize(serialize(s))).toEqual(s);
    expect(deserialize('not json')).toEqual(s);
    expect(deserialize(null)).toEqual(s);
    expect(deserialize(JSON.stringify({ version: 999 }))).toEqual(s);
  });
});
