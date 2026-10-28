import { SMASHER } from '../data/smasher';
import type { GameState } from './types';

export interface Goal {
  id: string;
  /** Short chip text, from the goal chain in docs/economy-and-details.md. */
  text: string;
}

const costText = (items: Partial<Record<string, number>> | undefined, credits: number): string =>
  [credits > 0 ? `${credits} credits` : '', ...Object.entries(items ?? {}).map(([k, v]) => `${v} ${k === 'core_shard' ? 'Shard' : k[0].toUpperCase() + k.slice(1)}`)]
    .filter(Boolean)
    .join(' · ');

/** The current tutorial goal, or null once the early chain is done (the hull goal takes over). */
export function currentGoal(s: GameState): Goal | null {
  if (!s.flags.tappedBeam) return { id: 'tap-beam', text: 'Tap the beam' };
  if (s.stats.rocks < 1) return { id: 'crush', text: 'Crush the rock' };
  if (s.stats.sold < 1) return { id: 'sell', text: 'Sell your Ore' };
  if (!s.smasher.repaired) {
    return { id: 'repair', text: `Fix the rusty Smasher · ${costText(SMASHER.repair.items, SMASHER.repair.credits)}` };
  }
  if (s.stats.sent < 1) return { id: 'send', text: 'Send a rock to the Smasher' };
  return null;
}
