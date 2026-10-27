import type { Cell, Cost, HullDef } from './types';

export const cellKey = (c: Cell): string => `${c.x},${c.y}`;

export const parseKey = (k: string): Cell => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
};

/** Orthogonal neighbours, in a fixed order: up, right, down, left. */
export const DIRS: readonly Cell[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export const neighbours = (c: Cell): Cell[] => DIRS.map((d) => ({ x: c.x + d.x, y: c.y + d.y }));

/** Template cells the player does not own yet but may buy now (touching an owned cell). */
export function unlockableCells(def: HullDef, owned: ReadonlySet<string>): Cell[] {
  return def.template.filter(
    (c) => !owned.has(cellKey(c)) && neighbours(c).some((n) => owned.has(cellKey(n))),
  );
}

/** Which of the four sides (indexes into DIRS) of an owned cell face empty space. */
export function exposedSides(owned: ReadonlySet<string>, c: Cell): number[] {
  const sides: number[] = [];
  DIRS.forEach((d, i) => {
    if (!owned.has(cellKey({ x: c.x + d.x, y: c.y + d.y }))) sides.push(i);
  });
  return sides;
}

/** An edge cell has at least one side facing empty space (needed by beams and Solar Wings). */
export const isEdgeCell = (owned: ReadonlySet<string>, c: Cell): boolean =>
  exposedSides(owned, c).length > 0;

/** Cost of the next tile, or undefined when the hull is complete. */
export function nextTileCost(def: HullDef, ownedCount: number): Cost | undefined {
  return def.tileCosts[ownedCount - def.startCells.length];
}

/** Template sanity check used by tests and the future template linter. */
export function templateStats(def: HullDef): { cells: number; edge: number; interior: number } {
  const all = new Set(def.template.map(cellKey));
  const edge = def.template.filter((c) => isEdgeCell(all, c)).length;
  return { cells: def.template.length, edge, interior: def.template.length - edge };
}

export function isConnected(cells: readonly Cell[]): boolean {
  if (cells.length === 0) return true;
  const all = new Set(cells.map(cellKey));
  const seen = new Set<string>([cellKey(cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of neighbours(cur)) {
      const k = cellKey(n);
      if (all.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push(n);
      }
    }
  }
  return seen.size === all.size;
}
