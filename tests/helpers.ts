import type { GameState } from '../src/core/types';

/**
 * Test helper: add a Tractor Beam with its own module (so power can find it). The module sits on an off-hull
 * key, which only the hull's base power can reach, so small fixtures behave as they did before power existed.
 */
export function addBeam(s: GameState, level = 1): GameState {
  const uid = Math.max(0, ...s.ship.modules.map((m) => m.uid)) + 1;
  return {
    ...s,
    ship: { ...s.ship, modules: [...s.ship.modules, { uid, defId: 'beam', cell: `b${uid}` }] },
    beams: [...s.beams, { uid, kind: 'tractor', status: 'idle', remaining: 0, level }],
  };
}
