import { SMASHER } from '../data/smasher';
import { MODULES } from '../data/modules';
import { HULLS } from '../data/hulls';
import { nextTileCost } from './hull';
import { freeCells, freeEdgeCells, moduleCost } from './modules';
import { structureGoal } from './reserve';
import { needsSmelter, smasherReady } from './units';
import type { Cost, GameState } from './types';

export interface Goal {
  id: string;
  /** Short chip text, from the goal chain in docs/economy-and-details.md. */
  text: string;
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
 * tap beam, crush, sell, Smelter, repair the Smasher, smash a rock, second beam (or the tile it needs).
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
  if (s.beams.length < 2) {
    if (sg?.id === 'beam2') return { id: 'beam2', text: `Add a second beam · ${costText(sg.cost)}` };
    const def = HULLS[s.ship.hullId];
    const tile = def ? nextTileCost(def, s.ship.ownedCells.length) : null;
    const hint = freeCells(s).length > 0 ? ' · a beam needs an outside tile' : '';
    return tile ? { id: 'expand', text: `Expand hull · ${costText(tile)}${hint}` } : null;
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
  if (beam && freeEdgeCells(s).length > 0) return `Next: Add a beam on an Open tile · ${costText(beam)}`;
  const tile = nextTileCost(HULLS[s.ship.hullId], s.ship.ownedCells.length);
  if (tile) return `Next: Expand hull · ${costText(tile)}${freeCells(s).length > 0 ? ' · Open tiles are not outside tiles' : ''}`;
  return 'Hull complete';
}
