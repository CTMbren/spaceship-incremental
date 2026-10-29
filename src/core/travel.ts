import { POWER } from '../data/power';
import { ENGINE, SYSTEM, VOID_DRIFT, type RouteNode, type Zone } from '../data/travel';
import { evaluatePower, type PowerInfo } from './power';
import type { GameEvent, GameState, ModuleInstance } from './types';

export const ROUTE: readonly RouteNode[] = SYSTEM.nodes;

export const inTransit = (s: GameState): boolean => s.travel.dest !== null;
export const currentNode = (s: GameState): RouteNode => ROUTE[s.travel.node];
/** The zone the beams pull from right now: the node, or Void Drift while cruising. */
export const zoneOf = (s: GameState): Zone => (inTransit(s) ? VOID_DRIFT : currentNode(s));
export const hasVisited = (s: GameState, id: string): boolean => s.travel.visited.some((i) => ROUTE[i]?.id === id);
export const hasDeparted = (s: GameState): boolean => inTransit(s) || s.travel.visited.length > 1;

export const engineModule = (s: GameState): ModuleInstance | undefined => s.ship.modules.find((m) => m.defId === 'engine');
export const engineLevel = (m: ModuleInstance) => ENGINE.levels[Math.min(ENGINE.levels.length, m.level ?? 1) - 1];

/** Cruising speed (level-1 seconds per second): 0 without a powered Engine, x1.15 with a Boost. */
export function engineSpeed(s: GameState, power: PowerInfo = evaluatePower(s)): number {
  const e = engineModule(s);
  if (!e || !power.powered.has(e.uid)) return 0;
  return engineLevel(e).speed * (power.boosted.has(e.uid) ? POWER.boost : 1);
}

/** Seconds of level-1 cruising the current leg takes in total. */
export const legLength = (s: GameState): number => (s.travel.dest === null ? 0 : ROUTE[s.travel.dest].legSec);

/** Real seconds to arrival at the current speed, or null when parked or stalled (no power). */
export function etaSec(s: GameState, power?: PowerInfo): number | null {
  if (s.travel.dest === null) return null;
  const v = engineSpeed(s, power);
  return v > 0 ? Math.max(0, legLength(s) - s.travel.progress) / v : null;
}

/** Real seconds the next leg would take from here (for the Map), or null. */
export function nextLegSec(s: GameState, power?: PowerInfo): number | null {
  const next = ROUTE[s.travel.node + 1];
  if (!next) return null;
  const e = engineModule(s);
  if (!e) return next.legSec;
  const v = engineSpeed(s, power) || engineLevel(e).speed;
  return next.legSec / v;
}

export type DepartCheck =
  | { ok: true }
  | { ok: false; reason: 'moving' | 'end' | 'locked' | 'no_engine' | 'unpowered'; label: string };

export function canDepart(s: GameState): DepartCheck {
  if (inTransit(s)) return { ok: false, reason: 'moving', label: 'Already under way' };
  const next = ROUTE[s.travel.node + 1];
  if (!next) return { ok: false, reason: 'end', label: 'End of the route' };
  if (!next.open) return { ok: false, reason: 'locked', label: 'Opens in a later update' };
  const e = engineModule(s);
  if (!e) return { ok: false, reason: 'no_engine', label: 'Build an Engine first' };
  if (!evaluatePower(s).powered.has(e.uid)) return { ok: false, reason: 'unpowered', label: 'The Engine has no power' };
  return { ok: true };
}

/** Leave for the next node on the route. Beams keep working (on Void Drift rocks) while cruising. */
export function depart(state: GameState): { state: GameState; events: GameEvent[] } {
  if (!canDepart(state).ok) return { state, events: [] };
  const s = structuredClone(state);
  s.travel.dest = s.travel.node + 1;
  s.travel.progress = 0;
  return { state: s, events: [{ kind: 'departed', to: s.travel.dest }] };
}

/**
 * Advance the cruise by `dt` seconds of real time (mutates s). Without a powered Engine the ship drifts in
 * place. Arrival parks the ship at the node.
 */
export function travelStep(s: GameState, dt: number, power: PowerInfo, events: GameEvent[]): void {
  if (s.travel.dest === null) return;
  const v = engineSpeed(s, power);
  if (v <= 0) return;
  s.travel.progress += dt * v;
  if (s.travel.progress >= legLength(s) - 1e-9) {
    const node = s.travel.dest;
    s.travel.node = node;
    s.travel.dest = null;
    s.travel.progress = 0;
    if (!s.travel.visited.includes(node)) s.travel.visited.push(node);
    events.push({ kind: 'arrived', node });
  }
}
