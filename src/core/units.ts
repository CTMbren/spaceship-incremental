import { SELL_REFUND, SMELTER } from '../data/modules';
import { SOLAR } from '../data/power';
import { SMASHER } from '../data/smasher';
import { ENGINE, GRAPPLE } from '../data/travel';
import { fitsPlacement, placementOf } from './modules';
import type { Cost, GameEvent, GameState, ItemId, ModuleId, SmasherState, SmelterState } from './types';

/** At least one Smasher is repaired and can take rocks. */
export const smasherReady = (s: GameState): boolean => s.smashers.some((m) => m.repaired);

/** The Smelter goal is over once one has been built (or has made Plate), even if it is later sold. */
export const smelterBuilt = (s: GameState): boolean => s.smelters.length > 0;
export const needsSmelter = (s: GameState): boolean => s.smelters.length === 0 && s.stats.smelted === 0;

export const smasherCap = (sm: SmasherState): number => SMASHER.levels[sm.level - 1].queue;

/**
 * The Smasher with the most free queue space (null if none can take a rock). Ties go to the first unit.
 * With `powered`, only Smashers that have power count (a rock sent to a dead Smasher would just sit there).
 */
export function roomiestSmasher(s: GameState, minLevel = 1, powered?: ReadonlySet<number>): SmasherState | null {
  let best: SmasherState | null = null;
  let bestRoom = 0;
  for (const sm of s.smashers) {
    if (!sm.repaired || sm.level < minLevel || (powered && !powered.has(sm.uid))) continue;
    const room = smasherCap(sm) - sm.queue.length;
    if (room > bestRoom) { best = sm; bestRoom = room; }
  }
  return best;
}

export const unitOfModule = (s: GameState, uid: number): SmasherState | SmelterState | undefined =>
  s.smashers.find((m) => m.uid === uid) ?? s.smelters.find((m) => m.uid === uid);

const scale = (cost: Cost, k: number): Cost => ({
  credits: Math.floor(cost.credits * k),
  items: cost.items ? Object.fromEntries(Object.entries(cost.items).map(([i, n]) => [i, Math.floor((n ?? 0) * k)])) as Cost['items'] : undefined,
});

/**
 * What selling a module would pay: 75% of what it cost plus 75% of the credits spent upgrading it.
 * Sellable: Smelters, bought Smashers, Solar Wings, the Engine (while parked) and Grapple Beams. Tractor Beams
 * and the ship's own Smasher stay.
 */
export function sellRefund(s: GameState, uid: number): Cost | null {
  const mod = s.ship.modules.find((m) => m.uid === uid);
  if (!mod) return null;
  let paid: Cost | undefined;
  let level = 1;
  let levels: readonly { cost: { credits: number } }[] = [];
  if (mod.defId === 'smelter' || mod.defId === 'smasher') {
    const unit = unitOfModule(s, uid);
    if (!unit) return null;
    if (mod.defId === 'smasher' && s.smashers[0]?.uid === uid) return null; // the ship's own Smasher stays
    paid = unit.paid;
    level = unit.level;
    levels = mod.defId === 'smelter' ? SMELTER.levels : SMASHER.levels;
  } else if (mod.defId === 'winch') {
    paid = mod.paid;
  } else if (mod.defId === 'solar' || mod.defId === 'engine') {
    if (mod.defId === 'engine' && s.travel.dest !== null) return null; // not mid-cruise
    paid = mod.paid;
    level = mod.level ?? 1;
    levels = mod.defId === 'solar' ? SOLAR.levels : ENGINE.levels;
  } else if (mod.defId === 'grapple') {
    paid = mod.paid;
    level = s.beams.find((b) => b.uid === uid)?.level ?? 1;
    levels = GRAPPLE.levels;
  } else {
    return null;
  }
  let upgrades = 0;
  for (let i = 1; i < level; i++) upgrades += levels[i]?.cost.credits ?? 0;
  const base = scale(paid ?? { credits: 0 }, SELL_REFUND);
  return { credits: base.credits + Math.floor(upgrades * SELL_REFUND), items: base.items };
}

export type UnitResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: 'no_module' | 'not_owned' | 'occupied' | 'not_edge' | 'not_rear' | 'cannot_sell' };

/** Move a module to another free tile (free of charge). Beams keep their place in the beam list. */
export function moveModule(state: GameState, uid: number, cell: string): UnitResult {
  const mod = state.ship.modules.find((m) => m.uid === uid);
  if (!mod) return { ok: false, reason: 'no_module' };
  if (!state.ship.ownedCells.includes(cell)) return { ok: false, reason: 'not_owned' };
  if (state.ship.modules.some((m) => m.cell === cell)) return { ok: false, reason: 'occupied' };
  const placement = placementOf(mod.defId);
  if (!fitsPlacement(new Set(state.ship.ownedCells), cell, placement)) return { ok: false, reason: placement === 'rear' ? 'not_rear' : 'not_edge' };
  const s = structuredClone(state);
  s.ship.modules.find((m) => m.uid === uid)!.cell = cell;
  return { ok: true, state: s, events: [{ kind: 'module_moved', module: mod.defId }] };
}

/** Sell a module (see sellRefund) for 75% back. Rocks still in a Smasher's queue are turned into their Ore and Ice. */
export function sellModule(state: GameState, uid: number): UnitResult {
  const refund = sellRefund(state, uid);
  const mod = state.ship.modules.find((m) => m.uid === uid);
  if (!refund || !mod) return { ok: false, reason: 'cannot_sell' };
  const s = structuredClone(state);
  s.credits += refund.credits;
  for (const [k, v] of Object.entries(refund.items ?? {})) s.items[k as ItemId] += v ?? 0;
  if (mod.defId === 'smasher') {
    const sm = s.smashers.find((m) => m.uid === uid)!;
    for (const r of sm.queue) {
      s.items.ore += r.ore;
      s.items.ice += r.ice ?? 0;
    }
    s.smashers = s.smashers.filter((m) => m.uid !== uid);
  } else if (mod.defId === 'smelter') {
    s.smelters = s.smelters.filter((m) => m.uid !== uid);
  } else if (mod.defId === 'grapple') {
    s.beams = s.beams.filter((b) => b.uid !== uid);
  }
  s.ship.modules = s.ship.modules.filter((m) => m.uid !== uid);
  return { ok: true, state: s, events: [{ kind: 'module_sold', module: mod.defId as ModuleId, credits: refund.credits }] };
}
