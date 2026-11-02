import { PRICES } from '../data/balance';
import { RANK } from '../data/jobs';
import { DRY_DOCK, PAINTS, TRADER, type PaintId } from '../data/station';
import { SYSTEM } from '../data/travel';
import { canAfford } from './actions';
import { rank } from './jobs';
import type { Cost, GameEvent, GameState, ItemId } from './types';

/** Day 12: Station Halcyon. The Trader, paints and the Dry Dock. Pure functions on GameState. */

export const atStation = (s: GameState): boolean => s.travel.dest === null && SYSTEM.nodes[s.travel.node]?.type === 'station';

/** What one unit sells for right now: the base price, +20% for refined and planet goods while docked. */
export const sellPrice = (s: GameState, item: ItemId): number =>
  PRICES[item] * (atStation(s) && TRADER.bonusItems.includes(item) ? TRADER.sellBonus : 1);

/** Credits for selling n units now (whole credits). */
export const sellCredits = (s: GameState, item: ItemId, n: number): number => Math.round(n * sellPrice(s, item));

type Spend = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; reason: 'not_docked' | 'need_credits' | 'need_items' | 'not_for_sale' | 'owned' | 'locked' | 'done' };

function pay(s: GameState, cost: Cost): void {
  s.credits -= cost.credits;
  for (const [k, v] of Object.entries(cost.items ?? {})) s.items[k as ItemId] -= v ?? 0;
}

/** Price of a pack of an item at the Trader, or null if it is not for sale. */
export function packCost(item: ItemId): Cost | null {
  const each = TRADER.buy[item];
  return each === undefined ? null : { credits: each * TRADER.pack };
}

/** Buy a pack (5) of a material from the Trader. Docked only. */
export function buyPack(state: GameState, item: ItemId): Spend {
  if (!atStation(state)) return { ok: false, reason: 'not_docked' };
  const cost = packCost(item);
  if (!cost) return { ok: false, reason: 'not_for_sale' };
  const afford = canAfford(state, cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = structuredClone(state);
  pay(s, cost);
  s.items[item] += TRADER.pack;
  return { ok: true, state: s, events: [] };
}

/** Paints the player can pick now: Tug Orange always, bought ones, and Fleet Gold from the Fleet Partner rank. */
export function paintOwned(s: GameState, id: PaintId): boolean {
  if (id === 'tug') return true;
  if (id === 'gold') return rank(s) >= RANK.partner;
  return s.station.paints.includes(id);
}

/** Buy a paint at the Trader (it goes on straight away). */
export function buyPaint(state: GameState, id: PaintId): Spend {
  const p = PAINTS[id];
  if (paintOwned(state, id)) return { ok: false, reason: 'owned' };
  if (!p.cost) return { ok: false, reason: 'locked' };
  if (!atStation(state)) return { ok: false, reason: 'not_docked' };
  const afford = canAfford(state, p.cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = structuredClone(state);
  pay(s, p.cost);
  s.station.paints.push(id);
  s.station.paint = id;
  return { ok: true, state: s, events: [] };
}

/** Wear an owned paint (anywhere). */
export function setPaint(state: GameState, id: PaintId): GameState {
  if (!paintOwned(state, id) || state.station.paint === id) return state;
  const s = structuredClone(state);
  s.station.paint = id;
  return s;
}

/** The hull's accent colour: the chosen paint, else Fleet Gold once earned (Day 9 behaviour), else Tug Orange. */
export function trimColor(s: GameState): number {
  if (s.station.paint && paintOwned(s, s.station.paint)) return PAINTS[s.station.paint].color;
  return rank(s) >= RANK.partner ? PAINTS.gold.color : PAINTS.tug.color;
}

/** Dry Dock: can the Tug become the Hauler here and now? */
export function dockCheck(s: GameState): { ok: true } | { ok: false; reason: 'not_docked' | 'done' | 'need_credits' | 'need_items' } {
  if (s.ship.hullId !== 'tug') return { ok: false, reason: 'done' };
  if (!atStation(s)) return { ok: false, reason: 'not_docked' };
  const afford = canAfford(s, DRY_DOCK.hauler);
  return afford === 'ok' ? { ok: true } : { ok: false, reason: afford };
}

/** Convert the Tug into the Hauler. Owned tiles and modules stay exactly where they are; 10 new tile spaces open. */
export function convertHull(state: GameState): Spend {
  const chk = dockCheck(state);
  if (!chk.ok) return chk;
  const s = structuredClone(state);
  pay(s, DRY_DOCK.hauler);
  s.ship.hullId = 'hauler';
  return { ok: true, state: s, events: [{ kind: 'hull_converted', hull: 'hauler' }] };
}
