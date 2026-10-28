import { describe, expect, it } from 'vitest';
import { HULL_TUG } from '../src/data/hulls';
import {
  arrowsFor, boundsOf, CELL, clampPan, edgeRuns, localPos, panLimits, panToShow, toScreen, VIEW, ZOOM,
} from '../src/game/shipLayout';

const start = [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }];
// the ghost tiles the scene shows first on the 1x3 start: beside the nose and the middle tile
const startGhosts = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 0 }];

describe('ship orientation', () => {
  it('maps the nose (template y = 0) to the left and runs the ship left to right', () => {
    expect(toScreen({ x: 2, y: 0 })).toEqual({ col: 0, row: 2 });
    const xs = start.map((c) => localPos(c).x);
    expect(xs).toEqual([0, CELL, 2 * CELL]);
    expect(new Set(start.map((c) => localPos(c).y)).size).toBe(1); // one row
  });
});

describe('zoom and panning', () => {
  it('the 1x3 start fits the view: centred, no arrows', () => {
    const l = panLimits(boundsOf(start, startGhosts));
    expect(l.fitsX && l.fitsY).toBe(true);
    expect(l.minX).toBe(l.maxX);
    expect(arrowsFor({ x: l.minX, y: l.minY }, l)).toEqual({ left: false, right: false, up: false, down: false });
  });
  it('the finished Tug is too big at 1.5x, so it scrolls and arrows appear', () => {
    const l = panLimits(boundsOf(HULL_TUG.template));
    expect(l.fitsX).toBe(false);
    expect(l.minX).toBeLessThan(l.maxX);
    // at the left-aligned pan the nose is visible, so only the "right" arrow shows horizontally
    const a = arrowsFor({ x: l.maxX, y: (l.minY + l.maxY) / 2 }, l);
    expect(a.right).toBe(true);
    expect(a.left).toBe(false);
  });
  it('arrows disappear at the ends and pan is clamped', () => {
    const l = panLimits(boundsOf(HULL_TUG.template));
    expect(arrowsFor({ x: l.minX, y: l.maxY }, l)).toMatchObject({ right: false, left: true });
    expect(clampPan({ x: 99999, y: -99999 }, l)).toEqual({ x: l.maxX, y: l.minY });
  });
  it('the zoom is 1.5', () => {
    expect(ZOOM).toBe(1.5);
  });
  it('panToShow brings an off-screen tile into view', () => {
    const l = panLimits(boundsOf(HULL_TUG.template));
    const rightmost = { x: 2, y: 4 }; // template tail
    const p = panToShow({ x: l.maxX, y: l.maxY }, rightmost, l);
    const screenX = p.x + (localPos(rightmost).x + CELL) * ZOOM;
    expect(screenX).toBeLessThanOrEqual(VIEW.x + VIEW.w);
    expect(p.x).toBeLessThan(l.maxX);
  });
});

describe('silhouette edge runs', () => {
  it('the 1x3 start has one nose run on the left, one rear run on the right, top and bottom runs of 3', () => {
    const runs = edgeRuns(start.map(toScreen));
    const by = (side: string) => runs.filter((r) => r.side === side);
    expect(by('left')).toEqual([{ side: 'left', line: 0, start: 2, end: 2 }]);
    expect(by('right')).toEqual([{ side: 'right', line: 2, start: 2, end: 2 }]);
    expect(by('top')).toEqual([{ side: 'top', line: 2, start: 0, end: 2 }]);
    expect(by('bottom')).toEqual([{ side: 'bottom', line: 2, start: 0, end: 2 }]);
  });
  it('the finished Tug has a 2-cell nose and a stepped, non-rectangular outline', () => {
    const runs = edgeRuns(HULL_TUG.template.map(toScreen));
    expect(runs.find((r) => r.side === 'left' && r.line === 0)).toMatchObject({ start: 1, end: 2 });
    expect(runs.filter((r) => r.side === 'top').length).toBeGreaterThan(1);
  });
});
