import { SMASHER } from '../data/smasher';
import { canAfford } from './actions';
import { nextBeamUpgrade, nextHandUpgrade, nextSmasherUpgrade, nextSmelterUpgrade } from './loop';
import type { Cost, GameState } from './types';

/** How many Workshop purchases the player can afford right now (drives the dot on the Build tab). */
export function readyUpgrades(s: GameState): number {
  const costs: (Cost | undefined)[] = [nextHandUpgrade(s)];
  s.beams.forEach((_, i) => costs.push(nextBeamUpgrade(s, i)));
  s.smelters.forEach((_, i) => costs.push(nextSmelterUpgrade(s, i)));
  s.smashers.forEach((m, i) => costs.push(m.repaired ? nextSmasherUpgrade(s, i) : SMASHER.repair));
  return costs.filter((c) => c !== undefined && canAfford(s, c) === 'ok').length;
}
