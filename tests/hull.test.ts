import { describe, expect, it } from 'vitest';
import { HULL_TUG } from '../src/data/hulls';
import {
  cellKey, exposedSides, isConnected, isEdgeCell, nextTileCost, templateStats, unlockableCells,
} from '../src/core/hull';

const startOwned = () => new Set(HULL_TUG.startCells.map(cellKey));

describe('hull template', () => {
  it('has 18 cells, connected, with 11 edge and 7 interior cells', () => {
    expect(isConnected(HULL_TUG.template)).toBe(true);
    expect(templateStats(HULL_TUG)).toEqual({ cells: 18, edge: 11, interior: 7 });
  });
  it('start cells are part of the template', () => {
    const all = new Set(HULL_TUG.template.map(cellKey));
    for (const c of HULL_TUG.startCells) expect(all.has(cellKey(c))).toBe(true);
  });
});

describe('unlockableCells', () => {
  it('returns only template cells touching owned cells', () => {
    const got = unlockableCells(HULL_TUG, startOwned()).map(cellKey).sort();
    // neighbours of (2,0),(2,1),(2,2) inside the template and not owned
    expect(got).toEqual(['1,0', '1,1', '1,2', '2,3', '3,1', '3,2'].sort());
  });
  it('never returns owned or non-template cells', () => {
    const owned = startOwned();
    const all = new Set(HULL_TUG.template.map(cellKey));
    for (const c of unlockableCells(HULL_TUG, owned)) {
      expect(owned.has(cellKey(c))).toBe(false);
      expect(all.has(cellKey(c))).toBe(true);
    }
  });
  it('is empty when the hull is complete', () => {
    const full = new Set(HULL_TUG.template.map(cellKey));
    expect(unlockableCells(HULL_TUG, full)).toEqual([]);
  });
});

describe('edge rules', () => {
  it('start column: every cell is an edge cell with exposed sides', () => {
    const owned = startOwned();
    expect(HULL_TUG.startCells.every((c) => isEdgeCell(owned, c))).toBe(true);
    expect(exposedSides(owned, { x: 2, y: 1 })).toEqual([1, 3]);
  });
});

describe('tile costs', () => {
  it('start with tile 4 and are strictly increasing in credits', () => {
    expect(HULL_TUG.tileCosts).toHaveLength(15);
    expect(nextTileCost(HULL_TUG, 3)?.credits).toBe(60);
    for (let i = 1; i < HULL_TUG.tileCosts.length; i++) {
      expect(HULL_TUG.tileCosts[i].credits).toBeGreaterThan(HULL_TUG.tileCosts[i - 1].credits);
    }
  });
  it('totals about 5,610 credits (regression guard against accidental edits)', () => {
    const total = HULL_TUG.tileCosts.reduce((s, c) => s + c.credits, 0);
    expect(total).toBeGreaterThan(5500);
    expect(total).toBeLessThan(5700);
  });
  it('returns undefined once the hull is full', () => {
    expect(nextTileCost(HULL_TUG, 18)).toBeUndefined();
  });
});
