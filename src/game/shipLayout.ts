/**
 * Ship presentation layout (pure, no Phaser): orientation, bounds, panning and silhouette edge runs.
 * The hull data (src/data/hulls.ts) keeps its original orientation (nose at y = 0, pointing "up").
 * On screen the ship runs left to right with the nose on the LEFT, so template (x, y) maps to
 * screen column = y, row = x.
 */
export interface Cell { x: number; y: number }
export interface ScreenCell { col: number; row: number }

/** Size of one tile in local (unzoomed) units. */
export const CELL = 56;
/** The ship is drawn at this zoom on screen. */
export const ZOOM = 1.5;
/** The screen rectangle (logical px) where the ship lives; it is clipped to this. */
export const VIEW = { x: 0, y: 118, w: 390, h: 312 };
/** The scene widens the view to the screen width at startup (see ShipScene). */
export const setViewWidth = (w: number): void => { VIEW.w = w; };
/** Gap kept between the ship and the viewport edge when it has to scroll. */
export const PAN_PAD = 12;
/** Extra room for the nose cone, engine bells and fins (local units). */
export const MARGIN = { nose: 36, rear: 40, side: 10, small: 10 } as const;

export const toScreen = (c: Cell): ScreenCell => ({ col: c.y, row: c.x });
export const fromScreen = (s: ScreenCell): Cell => ({ x: s.row, y: s.col });
export const key = (s: ScreenCell): string => `${s.col},${s.row}`;

/** Top-left of a template cell in local units. */
export function localPos(c: Cell): { x: number; y: number } {
  const s = toScreen(c);
  return { x: s.col * CELL, y: s.row * CELL };
}

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/**
 * Local bounds of the ship plus room for its decoration. Owned tiles carry the decoration margins
 * (nose cone on exposed left edges, engine bell on exposed right edges, fins above and below); ghost
 * tiles only need a small one.
 */
export function boundsOf(owned: Cell[], ghosts: Cell[] = []): Bounds {
  const set = new Set(owned.map((c) => key(toScreen(c))));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (c: Cell, nose: number, rear: number, side: number) => {
    const s = toScreen(c);
    x0 = Math.min(x0, s.col * CELL - nose);
    x1 = Math.max(x1, (s.col + 1) * CELL + rear);
    y0 = Math.min(y0, s.row * CELL - side);
    y1 = Math.max(y1, (s.row + 1) * CELL + side);
  };
  for (const c of owned) {
    const s = toScreen(c);
    const isNose = !set.has(`${s.col - 1},${s.row}`);
    const isRear = !set.has(`${s.col + 1},${s.row}`);
    add(c, isNose ? MARGIN.nose : MARGIN.small, isRear ? MARGIN.rear : MARGIN.small, MARGIN.side);
  }
  for (const c of ghosts) add(c, MARGIN.small, MARGIN.small, MARGIN.small);
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: CELL, y1: CELL };
  return { x0, y0, x1, y1 };
}

export interface PanLimits {
  minX: number; maxX: number; minY: number; maxY: number;
  fitsX: boolean; fitsY: boolean;
}

/** Container-position limits. When the content fits an axis, min = max = the centred position. */
export function panLimits(b: Bounds, zoom = ZOOM, view = VIEW, pad = PAN_PAD): PanLimits {
  const axis = (lo: number, hi: number, vStart: number, vSize: number) => {
    const size = (hi - lo) * zoom;
    if (size <= vSize - 2 * pad) {
      const centred = vStart + vSize / 2 - ((lo + hi) / 2) * zoom;
      return { min: centred, max: centred, fits: true };
    }
    // max aligns the low edge to the viewport start; min aligns the high edge to the viewport end
    return { min: vStart + vSize - pad - hi * zoom, max: vStart + pad - lo * zoom, fits: false };
  };
  const ax = axis(b.x0, b.x1, view.x, view.w);
  const ay = axis(b.y0, b.y1, view.y, view.h);
  return { minX: ax.min, maxX: ax.max, minY: ay.min, maxY: ay.max, fitsX: ax.fits, fitsY: ay.fits };
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function clampPan(p: { x: number; y: number }, l: PanLimits): { x: number; y: number } {
  return { x: clamp(p.x, l.minX, l.maxX), y: clamp(p.y, l.minY, l.maxY) };
}

export interface Arrows { left: boolean; right: boolean; up: boolean; down: boolean }

/**
 * Which scroll arrows to show. "left" means there is more ship off the left edge (the container sits
 * left of its maximum), and so on. Arrows never show on an axis where the ship fits.
 */
export function arrowsFor(p: { x: number; y: number }, l: PanLimits, eps = 1): Arrows {
  return {
    left: !l.fitsX && p.x < l.maxX - eps,
    right: !l.fitsX && p.x > l.minX + eps,
    up: !l.fitsY && p.y < l.maxY - eps,
    down: !l.fitsY && p.y > l.minY + eps,
  };
}

/** Container position that brings a template cell fully into view (with padding), changing as little as possible. */
export function panToShow(
  p: { x: number; y: number }, c: Cell, l: PanLimits, zoom = ZOOM, view = VIEW, pad = PAN_PAD,
): { x: number; y: number } {
  const lp = localPos(c);
  const fit = (cur: number, lo: number, hi: number, vStart: number, vSize: number) => {
    const a = vStart + pad - lo * zoom; // container pos that puts `lo` at the padded start
    const b = vStart + vSize - pad - hi * zoom; // ... puts `hi` at the padded end
    if (cur > a) return a; // lo is left of / above the start: move content right/down
    if (cur < b) return b; // hi is past the end
    return cur;
  };
  const x = fit(p.x, lp.x, lp.x + CELL, view.x, view.w);
  const y = fit(p.y, lp.y, lp.y + CELL, view.y, view.h);
  return clampPan({ x, y }, l);
}

export type Side = 'left' | 'right' | 'top' | 'bottom';
/** A run of consecutive cells sharing one exposed edge. `line` is the column (left/right) or row (top/bottom). */
export interface EdgeRun { side: Side; line: number; start: number; end: number }

/** Exposed-edge runs of a screen-space cell set, used to build the silhouette (nose, engines, fins). */
export function edgeRuns(cells: ScreenCell[]): EdgeRun[] {
  const set = new Set(cells.map(key));
  const has = (col: number, row: number) => set.has(`${col},${row}`);
  const runs: EdgeRun[] = [];
  const group = (side: Side, pick: (s: ScreenCell) => { line: number; pos: number } | null) => {
    const byLine = new Map<number, number[]>();
    for (const c of cells) {
      const r = pick(c);
      if (!r) continue;
      byLine.set(r.line, [...(byLine.get(r.line) ?? []), r.pos]);
    }
    for (const [line, arr] of byLine) {
      arr.sort((a, b) => a - b);
      let start = arr[0], prev = arr[0];
      for (let i = 1; i <= arr.length; i++) {
        if (i === arr.length || arr[i] !== prev + 1) {
          runs.push({ side, line, start, end: prev });
          start = arr[i];
        }
        prev = arr[i];
      }
    }
  };
  group('left', (c) => (has(c.col - 1, c.row) ? null : { line: c.col, pos: c.row }));
  group('right', (c) => (has(c.col + 1, c.row) ? null : { line: c.col, pos: c.row }));
  group('top', (c) => (has(c.col, c.row - 1) ? null : { line: c.row, pos: c.col }));
  group('bottom', (c) => (has(c.col, c.row + 1) ? null : { line: c.row, pos: c.col }));
  return runs;
}
