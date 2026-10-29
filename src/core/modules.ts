import { MODULES } from '../data/modules';
import { canAfford } from './actions';
import { parseKey } from './hull';
import { hasVisited } from './travel';
import type { Cost, GameState, GameEvent, ItemId, ModuleId } from './types';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Edge rule: a tile needs at least one side facing empty space (not an owned tile). */
export function isEdgeCell(owned: ReadonlySet<string>, cell: string): boolean {
  const c = parseKey(cell);
  return DIRS.some(([dx, dy]) => !owned.has(`${c.x + dx},${c.y + dy}`));
}

/**
 * Rear rule: the tile's back faces open space. In hull data the nose is at y = 0, so the back is +y
 * (on screen the ship points left and the back is the right-hand side).
 */
export function isRearCell(owned: ReadonlySet<string>, cell: string): boolean {
  const c = parseKey(cell);
  return !owned.has(`${c.x},${c.y + 1}`);
}

export type Placement = 'any' | 'edge' | 'rear';

/** Does this tile suit a module with this placement rule? */
export function fitsPlacement(owned: ReadonlySet<string>, cell: string, placement: Placement): boolean {
  if (placement === 'edge') return isEdgeCell(owned, cell);
  if (placement === 'rear') return isRearCell(owned, cell);
  return true;
}

export const placementOf = (id: ModuleId): Placement => MODULES[id].placement;

/** Owned tiles with nothing on them. */
export function freeCells(s: GameState): string[] {
  const used = new Set(s.ship.modules.map((m) => m.cell));
  return s.ship.ownedCells.filter((c) => !used.has(c));
}

export function freeEdgeCells(s: GameState): string[] {
  const owned = new Set(s.ship.ownedCells);
  return freeCells(s).filter((c) => isEdgeCell(owned, c));
}

/** Free tiles that suit a module (its placement rule). */
export function freeCellsFor(s: GameState, id: ModuleId): string[] {
  const owned = new Set(s.ship.ownedCells);
  return freeCells(s).filter((c) => fitsPlacement(owned, c, placementOf(id)));
}

export const moduleCount = (s: GameState, id: ModuleId): number => s.ship.modules.filter((m) => m.defId === id).length;

/** Is this module offered yet? The Engine after the second beam, the Grapple once the ship reaches the Rubble Belt. */
export function moduleUnlocked(s: GameState, id: ModuleId): boolean {
  if (moduleCount(s, id) > 0) return true;
  if (id === 'solar') return s.smelters.length > 0 || s.stats.smelted > 0;
  if (id === 'engine') return s.beams.filter((b) => b.kind === 'tractor').length >= 2;
  if (id === 'grapple') return hasVisited(s, 'belt');
  return true;
}

/** Cost to build the next copy of a module, or null if none can be built (at its limit). */
export function moduleCost(s: GameState, id: ModuleId): Cost | null {
  return MODULES[id].costs[moduleCount(s, id)] ?? null;
}

export type PlaceResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: 'not_owned' | 'occupied' | 'not_edge' | 'not_rear' | 'at_limit' | 'locked' | 'need_credits' | 'need_items' };

/** Can this module go on this tile? (Cost aside.) */
export function placementCheck(s: GameState, id: ModuleId, cell: string): { ok: true } | { ok: false; reason: 'not_owned' | 'occupied' | 'not_edge' | 'not_rear' | 'at_limit' | 'locked' } {
  if (!s.ship.ownedCells.includes(cell)) return { ok: false, reason: 'not_owned' };
  if (s.ship.modules.some((m) => m.cell === cell)) return { ok: false, reason: 'occupied' };
  if (!moduleUnlocked(s, id)) return { ok: false, reason: 'locked' };
  if (moduleCost(s, id) === null) return { ok: false, reason: 'at_limit' };
  const owned = new Set(s.ship.ownedCells);
  const placement = placementOf(id);
  if (!fitsPlacement(owned, cell, placement)) return { ok: false, reason: placement === 'rear' ? 'not_rear' : 'not_edge' };
  return { ok: true };
}

/** Pure: pay for a module and put it on a free owned tile. */
export function placeModule(state: GameState, id: ModuleId, cell: string): PlaceResult {
  const check = placementCheck(state, id, cell);
  if (!check.ok) return check;
  const cost = moduleCost(state, id)!;
  const afford = canAfford(state, cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = structuredClone(state);
  s.credits -= cost.credits;
  for (const [k, v] of Object.entries(cost.items ?? {})) s.items[k as ItemId] -= v ?? 0;
  const uid = Math.max(0, ...s.ship.modules.map((m) => m.uid)) + 1;
  const own = id === 'solar' || id === 'engine' || id === 'grapple';
  s.ship.modules.push({ uid, defId: id, cell, ...(own ? { paid: cost } : {}), ...(id === 'solar' || id === 'engine' ? { level: 1 } : {}) });
  if (id === 'beam') s.beams.push({ uid, kind: 'tractor', status: 'idle', remaining: 0, level: 1 });
  if (id === 'grapple') s.beams.push({ uid, kind: 'grapple', status: 'idle', remaining: 0, level: 1 });
  if (id === 'smelter') s.smelters.push({ uid, paid: cost, level: 1, on: true, progress: 0 });
  if (id === 'smasher') s.smashers.push({ uid, paid: cost, repaired: true, level: 1, queue: [] }); // bought copies need no repair
  return { ok: true, state: s, events: [{ kind: 'built', module: id }] };
}
