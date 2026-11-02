import { HULLS } from '../data/hulls';
import { MODULES } from '../data/modules';
import { DRY_DOCK } from '../data/station';
import { SMASHER } from '../data/smasher';
import { sellCredits } from './station';
import { nextTileCost } from './hull';
import { POWER } from '../data/power';
import { freeCells, freeCellsFor, freeEdgeCells, moduleCost, moduleCount, moduleUnlocked } from './modules';
import { CONVERTERS, unitsOf } from './converters';
import { sparePower } from './power';
import { hasVisited } from './travel';
import { needsSmelter, smasherReady } from './units';
import type { Cost, GameState, ItemId, ModuleId } from './types';

export type StructureGoalId = 'smelter' | 'repair' | 'solar' | 'beam2' | 'engine' | 'grapple' | 'melter' | 'fab' | 'rover' | 'drydock' | 'expand';

/**
 * The structure purchase the player is working toward next (after the first sell). Sell and the Smelter
 * never touch the materials it needs ("reserved for the current goal").
 */
export function structureGoal(s: GameState): { id: StructureGoalId; cost: Cost } | null {
  const def = HULLS[s.ship.hullId];
  const tile = def ? nextTileCost(def, s.ship.ownedCells.length) : null;
  const expand = tile ? { id: 'expand' as const, cost: tile } : null;
  if (needsSmelter(s)) {
    return freeCells(s).length > 0 ? { id: 'smelter', cost: MODULES.smelter.costs[0] } : expand;
  }
  if (!smasherReady(s)) return { id: 'repair', cost: SMASHER.repair };
  // the next module of the early chain; a Solar Wing first whenever the ship lacks the power to run it
  const build = (id: StructureGoalId, mod: ModuleId): { id: StructureGoalId; cost: Cost } | null => {
    if (sparePower(s) < POWER.draw[mod]) {
      const solar = moduleCost(s, 'solar');
      if (solar && freeEdgeCells(s).length > 0) return { id: 'solar' as const, cost: solar };
      return expand;
    }
    const cost = moduleCost(s, mod);
    if (cost && freeCellsFor(s, mod).length > 0) return { id, cost };
    // the Melter and Fabricator stay the goal on a full ship: the next tiles need what they make (no dead end)
    if (cost && (mod === 'melter' || mod === 'fab') && tileNeedsIt(s, mod)) return { id, cost };
    return expand;
  };
  if (s.beams.filter((b) => b.kind === 'tractor').length < 2) return build('beam2', 'beam');
  if (moduleCount(s, 'engine') === 0) return build('engine', 'engine');
  if (hasVisited(s, 'belt') && moduleCount(s, 'grapple') === 0) return build('grapple', 'grapple');
  if (moduleUnlocked(s, 'melter') && moduleCount(s, 'melter') === 0 && s.stats.melted === 0) return build('melter', 'melter');
  if (moduleUnlocked(s, 'fab') && moduleCount(s, 'fab') === 0 && s.stats.fabbed === 0) return build('fab', 'fab');
  if (moduleUnlocked(s, 'rover') && moduleCount(s, 'rover') === 0 && s.rover.trips === 0) return build('rover', 'rover');
  // Day 12: a full Tug that has reached Station Halcyon works toward the Dry Dock (the Hauler)
  if (!expand && s.ship.hullId === 'tug' && hasVisited(s, 'station')) return { id: 'drydock', cost: DRY_DOCK.hauler };
  return expand;
}

/** Does the next hull tile need what this converter makes (Coolant for tile 12, Circuits for tile 13 on)? */
function tileNeedsIt(s: GameState, mod: 'melter' | 'fab'): boolean {
  const tile = nextTileCost(HULLS[s.ship.hullId], s.ship.ownedCells.length);
  return (tile?.items?.[mod === 'melter' ? 'coolant' : 'circuit'] ?? 0) > 0;
}

/**
 * Materials held back from selling and smelting. The very first sell is the tutorial: nothing is reserved.
 * This is what the goal needs directly (the Smelter itself may still use everything else).
 */
export function reserved(s: GameState): Partial<Record<ItemId, number>> {
  if (s.stats.sold < 1 || !s.flags.holdForGoal) return {};
  return structureGoal(s)?.cost.items ?? {};
}

export const reservedQty = (s: GameState, item: ItemId): number => reserved(s)[item] ?? 0;

/**
 * Inputs to keep back from selling so the converters can make what the goal is short of: Circuits need Plate and
 * Coolant (Fabricator), Coolant needs Ice (Ice Melter), Plate needs Ore (Smelter). Only for converters that are
 * switched on. Selling keeps these back; the converters themselves may use them.
 */
export function feedReserves(s: GameState): Partial<Record<ItemId, number>> {
  if (s.stats.sold < 1) return {};
  const res = reserved(s);
  const out: Partial<Record<ItemId, number>> = {};
  const add = (item: ItemId, n: number) => { if (n > 0) out[item] = (out[item] ?? 0) + n; };
  const short = (item: ItemId) => Math.max(0, (res[item] ?? 0) + (out[item] ?? 0) - Math.floor(s.items[item]));
  const feed = (id: 'fab' | 'melter' | 'smelter') => {
    const def = CONVERTERS[id];
    if (!unitsOf(s, id).some((u) => u.on)) return;
    const batches = Math.ceil(short(def.output) / def.outQty);
    for (const [k, v] of Object.entries(def.inputs)) add(k as ItemId, batches * (v ?? 0));
  };
  feed('fab');
  feed('melter');
  feed('smelter');
  return out;
}

/** Ore kept back so the Smelter can make the Plate the goal is short of (see feedReserves). */
export const smeltFeedReserve = (s: GameState): number => feedReserves(s).ore ?? 0;

/** Units of an item the Smelter may use right now (only the goal's own materials are off limits). */
export const smeltableQty = (s: GameState, item: ItemId): number =>
  Math.max(0, Math.floor(s.items[item]) - reservedQty(s, item));

/** Units of an item the player can sell right now. */
export const availableQty = (s: GameState, item: ItemId): number =>
  Math.max(0, Math.floor(s.items[item]) - reservedQty(s, item) - (feedReserves(s)[item] ?? 0));

/** Items the Sell button handles (Core Shards are kept). */
export const SELLABLE: readonly ItemId[] = ['ore', 'ice', 'plate', 'coolant', 'circuit', 'sand', 'resin'];

/** Credits selling the given items (default: all sellable) would pay right now. */
export function sellValue(s: GameState, items: readonly ItemId[] = SELLABLE): number {
  return SELLABLE.reduce((sum, item) => sum + (items.includes(item) ? sellCredits(s, item, availableQty(s, item)) : 0), 0);
}
