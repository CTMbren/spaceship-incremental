import { SMASHER } from '../data/smasher';
import { MELTER_UNLOCK_TILES, MODULES } from '../data/modules';
import { HULLS } from '../data/hulls';
import { nextTileCost } from './hull';
import { freeCells, freeEdgeCells, moduleCost, moduleCount, moduleUnlocked } from './modules';
import { sparePower } from './power';
import { structureGoal } from './reserve';
import { hasDeparted, hasVisited, inTransit, ROUTE } from './travel';
import { needsSmelter, smasherReady } from './units';
import type { Cost, GameState } from './types';

export interface Goal {
  id: string;
  /** Short chip text, from the goal chain in docs/economy-and-details.md. */
  text: string;
}

/**
 * The next hull tile needs something the player cannot get yet (Ice before the Rubble Belt, Coolant without an Ice Melter,
 * Circuits without a Fabricator), so "Expand hull" would be a dead end.
 */
export function tileOutOfReach(s: GameState): boolean {
  const tile = nextTileCost(HULLS[s.ship.hullId], s.ship.ownedCells.length);
  if (!tile) return false;
  return Object.entries(tile.items ?? {}).some(([k, v]) => {
    if (s.items[k as keyof GameState['items']] >= (v ?? 0)) return false;
    if (k === 'ore' || k === 'plate') return false;
    if (k === 'ice') return !hasVisited(s, 'belt');
    if (k === 'coolant') return s.melters.length === 0; // Coolant needs a Melter on the ship
    if (k === 'circuit') return s.fabs.length === 0; // Circuits need a Fabricator
    return false; // Core Shards come from geodes
  });
}

export const costText = (cost: Cost): string =>
  [
    cost.credits > 0 ? `${cost.credits} credits` : '',
    ...Object.entries(cost.items ?? {}).map(([k, v]) => `${v} ${k === 'core_shard' ? 'Shard' : k[0].toUpperCase() + k.slice(1)}`),
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * The current tutorial goal, or null once the early chain is done (the hull goal takes over):
 * tap beam, crush, sell, Smelter, repair the Smasher, smash a rock, (Solar Wing,) second beam, Engine,
 * Depart, Grapple at the Rubble Belt. A Solar Wing is asked for whenever the next module would lack power.
 */
export function currentGoal(s: GameState): Goal | null {
  if (!s.flags.tappedBeam) return { id: 'tap-beam', text: 'Tap the beam' };
  if (s.stats.rocks < 1) return { id: 'crush', text: 'Crush the rock' };
  if (s.stats.sold < 1) return { id: 'sell', text: 'Sell your Ore' };
  const sg = structureGoal(s);
  if (needsSmelter(s)) {
    if (sg?.id === 'smelter') return { id: 'smelter', text: `Build a Smelter · ${costText(MODULES.smelter.costs[0])}` };
    return sg ? { id: 'expand', text: `Expand hull · ${costText(sg.cost)}` } : null;
  }
  if (!smasherReady(s)) return { id: 'repair', text: `Fix the rusty Smasher · ${costText(SMASHER.repair)}` };
  if (s.stats.sent < 1) return { id: 'send', text: 'Smash a rock: tap Smash' };
  const tractors = s.beams.filter((b) => b.kind === 'tractor').length;
  const hasEngine = moduleCount(s, 'engine') > 0;
  const chainModule = tractors < 2 || !hasEngine || (hasDeparted(s) && hasVisited(s, 'belt') && moduleCount(s, 'grapple') === 0);
  if (hasEngine && !hasDeparted(s)) return { id: 'depart', text: `Open the Map and Depart for the ${ROUTE[1].name}` };
  if (inTransit(s) && !hasVisited(s, 'belt')) return { id: 'cruise', text: `Cruising to the ${ROUTE[1].name}. Keep cracking!` };
  if (chainModule) {
    if (sg?.id === 'solar') return { id: 'solar', text: `Add power: build a Solar Wing · ${costText(sg.cost)} · outside tile` };
    if (sg?.id === 'beam2') return { id: 'beam2', text: `Add a second beam · ${costText(sg.cost)}` };
    if (sg?.id === 'engine') return { id: 'engine', text: `Build an Engine · ${costText(sg.cost)} · back tile` };
    if (sg?.id === 'grapple') return { id: 'grapple', text: `Build a Grapple Beam · ${costText(sg.cost)}` };
    const def = HULLS[s.ship.hullId];
    const tile = def ? nextTileCost(def, s.ship.ownedCells.length) : null;
    const why = tractors < 2 ? 'a beam needs an outside tile' : !hasEngine ? 'the Engine needs a back tile' : 'a Grapple needs an outside tile';
    if (tile && tileOutOfReach(s)) {
      // a full ship that cannot grow yet: make room instead
      const kind = !hasEngine && tractors >= 2 ? 'a back' : 'an outside';
      return freeCells(s).length > 0
        ? { id: 'make-room', text: `No room: Move a module off ${kind} tile` }
        : { id: 'make-room', text: 'No free tile: tap a module and Sell or Move it' };
    }
    const hint = freeCells(s).length > 0 ? ` · ${why}` : '';
    return tile ? { id: 'expand', text: `Expand hull · ${costText(tile)}${hint}` } : null;
  }
  // Day 10: Ice Melter (Coolant for tile 12), then the Fabricator (Circuits for tiles 13-18)
  if (sg?.id === 'melter' || sg?.id === 'fab') {
    const name = sg.id === 'melter' ? 'an Ice Melter' : 'a Fabricator';
    if (freeCells(s).length === 0) return { id: 'make-room', text: `Make room for ${name}: tap a module and Sell or Move it` };
    return { id: sg.id, text: `Build ${name} · ${costText(sg.cost)}` };
  }
  if (sg?.id === 'solar' && (moduleUnlocked(s, 'melter') && moduleCount(s, 'melter') === 0 || moduleUnlocked(s, 'fab') && moduleCount(s, 'fab') === 0)) {
    return { id: 'solar', text: `Add power: build a Solar Wing · ${costText(sg.cost)} · outside tile` };
  }
  return null;
}

/**
 * Chip text for the HUD. While the tutorial goal is running it is that goal; afterwards it points at an
 * Open tile first (a beam on an outside tile) and only suggests more hull once the Open tiles are used up.
 */
export function chipText(s: GameState): string {
  const goal = currentGoal(s);
  if (goal) return `Next: ${goal.text}`;
  const beam = moduleCost(s, 'beam');
  if (beam && freeEdgeCells(s).length > 0) {
    const solar = moduleCost(s, 'solar');
    if (sparePower(s) < 1 && solar) return `Next: Add a Solar Wing for power · ${costText(solar)}`;
    return `Next: Add a beam on an Open tile · ${costText(beam)}`;
  }
  const tile = nextTileCost(HULLS[s.ship.hullId], s.ship.ownedCells.length);
  if (tile && tileOutOfReach(s)) {
    if (!hasVisited(s, 'belt')) return `Next: Fly to the ${ROUTE[1].name} for Ice (bigger hull tiles)`;
    if (!moduleUnlocked(s, 'melter')) return `Next: Grow the hull to ${MELTER_UNLOCK_TILES} tiles for the Ice Melter`;
    // the next tile needs Coolant or Circuits and the ship has no room for the module that makes them
    const missing = (tile.items?.coolant && s.melters.length === 0) ? 'melter' : (tile.items?.circuit && s.fabs.length === 0) ? 'fab' : null;
    if (missing) {
      const name = MODULES[missing].name;
      if (!moduleUnlocked(s, missing)) return `Next: Build an Ice Melter first, then a ${name}`;
      return freeCells(s).length > 0
        ? `Next: Build a ${name} on an Open tile · ${costText(moduleCost(s, missing) ?? { credits: 0 })}`
        : `Next: Make room for a ${name}: tap a module and Sell or Move it`;
    }
    return 'Hull is as big as it gets for now';
  }
  if (tile) return `Next: Expand hull · ${costText(tile)}${freeCells(s).length > 0 ? ' · Open tiles are not outside tiles' : ''}`;
  return 'Hull complete';
}
