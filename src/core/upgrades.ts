import { SMASHER } from '../data/smasher';
import { canAfford } from './actions';
import { nextBeamUpgrade, nextHandUpgrade, nextSmasherUpgrade, nextSmelterUpgrade } from './loop';
import type { GameState } from './types';

/** How many Workshop purchases the player can afford right now (drives the dot on the Build tab). */
export function readyUpgrades(s: GameState): number {
  const costs = [nextHandUpgrade(s)];
  s.beams.forEach((_, i) => costs.push(nextBeamUpgrade(s, i)));
  if (s.smelter.built) costs.push(nextSmelterUpgrade(s));
  costs.push(s.smasher.repaired ? nextSmasherUpgrade(s) : SMASHER.repair);
  return costs.filter((c) => c !== undefined && canAfford(s, c) === 'ok').length;
}
