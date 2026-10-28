import { MODULES } from '../data/modules';
import { canAfford } from './actions';
import { parseKey } from './hull';
import type { Cost, GameState, GameEvent, ItemId, ModuleId } from './types';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Edge rule: a tile needs at least one side facing empty space (not an owned tile). */
export function isEdgeCell(owned: ReadonlySet<string>, cell: string): boolean {
  const c = parseKey(cell);
  return DIRS.some(([dx, dy]) => !owned.has(`${c.x + dx},${c.y + dy}`));
}

/** Owned tiles with nothing on them. */
export function freeCells(s: GameState): string[] {
  const used = new Set(s.ship.modules.map((m) => m.cell));
  return s.ship.ownedCells.filter((c) => !used.has(c));
}

export function freeEdgeCells(s: GameState): string[] {
  const owned = new Set(s.ship.ownedCells);
  return freeCells(s).filter((c) => isEdgeCell(owned, c));
}

export const moduleCount = (s: GameState, id: ModuleId): number => s.ship.modules.filter((m) => m.defId === id).length;

/** Cost to build the next copy of a module, or null if none can be built (at its limit). */
export function moduleCost(s: GameState, id: ModuleId): Cost | null {
  if (id === 'beam') return MODULES.beam.costs[moduleCount(s, 'beam')] ?? null;
  if (id === 'smelter') return moduleCount(s, 'smelter') >= MODULES.smelter.max ? null : MODULES.smelter.cost;
  return null; // the Smasher comes with the ship (it starts Rusty)
}

export type PlaceResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: 'not_owned' | 'occupied' | 'not_edge' | 'at_limit' | 'need_credits' | 'need_items' };

/** Can this module go on this tile? (Cost aside.) */
export function placementCheck(s: GameState, id: ModuleId, cell: string): { ok: true } | { ok: false; reason: 'not_owned' | 'occupied' | 'not_edge' | 'at_limit' } {
  if (!s.ship.ownedCells.includes(cell)) return { ok: false, reason: 'not_owned' };
  if (s.ship.modules.some((m) => m.cell === cell)) return { ok: false, reason: 'occupied' };
  if (moduleCost(s, id) === null) return { ok: false, reason: 'at_limit' };
  if (MODULES[id].placement === 'edge' && !isEdgeCell(new Set(s.ship.ownedCells), cell)) return { ok: false, reason: 'not_edge' };
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
  s.ship.modules.push({ uid, defId: id, cell });
  if (id === 'beam') s.beams.push({ status: 'idle', remaining: 0, level: 1 });
  if (id === 'smelter') s.smelter = { built: true, level: 1, on: true, progress: 0 };
  return { ok: true, state: s, events: [{ kind: 'built', module: id }] };
}
