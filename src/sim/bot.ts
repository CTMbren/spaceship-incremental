/**
 * Headless economy bot. Plays the REAL core rules (no re-implemented economy) with a simple policy,
 * so pacing numbers always match the game. Pure and deterministic: the RNG lives in the state.
 */
import { buyTile } from '../core/actions';
import { HULLS } from '../data/hulls';
import { unlockableCells } from '../core/hull';
import {
  canSend, handStats, holdCrush, nextBeamUpgrade, nextHandUpgrade, nextSmasherUpgrade, nextSmelterUpgrade,
  releaseHold, repairSmasher, sellAll, sendToSmasher, tapAllBeams, tick, upgradeBeam, upgradeHand,
  upgradeSmasher, upgradeSmelter, weakActive,
} from '../core/loop';
import { freeCells, freeEdgeCells, placeModule } from '../core/modules';
import { sellValue } from '../core/reserve';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import { BAL } from '../data/balance';
import { canAfford } from '../core/actions';

export type Policy = 'engaged' | 'casual' | 'idle';

export interface Milestones {
  smelter?: number;
  repaired?: number;
  beam2?: number;
  /** tiles owned -> seconds when reached */
  tiles: Record<number, number>;
}

export interface SimResult {
  policy: Policy;
  minutes: number;
  milestones: Milestones;
  final: GameState;
  /** Credits earned per minute over the final 5 minutes (sales only). */
  incomePerMin: number;
}

const DT = 0.1;
/** How often the policy looks at the screen (seconds) and how often it spends. */
const LOOK: Record<Policy, number> = { engaged: 0.3, casual: 2.5, idle: 0.3 };
const SPEND: Record<Policy, number> = { engaged: 3, casual: 10, idle: 10 };
/** The idle player drops in for IDLE_BURST seconds every IDLE_EVERY seconds and plays like an engaged one. */
const IDLE_EVERY = 120;
const IDLE_BURST = 20;

function spend(s0: GameState): GameState {
  let s = s0;
  const def = HULLS[s.ship.hullId];
  for (let guard = 0; guard < 20; guard++) {
    // structure first: Smelter, repair, second beam
    if (!s.smelter.built && freeCells(s).length > 0) {
      const r = placeModule(s, 'smelter', freeCells(s)[0]);
      if (r.ok) { s = r.state; continue; }
    }
    if (!s.smasher.repaired) {
      const r = repairSmasher(s);
      if (r.ok) { s = r.state; continue; }
    }
    if (s.beams.length < 2 && s.smasher.repaired) {
      const edge = freeEdgeCells(s);
      if (edge.length) {
        const r = placeModule(s, 'beam', edge[0]);
        if (r.ok) { s = r.state; continue; }
      }
    }
    // tiles beat upgrades whenever affordable
    const next = unlockableCells(def, new Set(s.ship.ownedCells))[0];
    if (next) {
      const r = buyTile(s, next);
      if (r.ok) { s = r.state; continue; }
    }
    // otherwise the cheapest affordable upgrade
    const options: { cost: number; run: () => ReturnType<typeof upgradeHand> }[] = [];
    const add = (cost: { credits: number } | undefined, run: () => ReturnType<typeof upgradeHand>) => {
      if (cost) options.push({ cost: cost.credits, run });
    };
    add(nextHandUpgrade(s), () => upgradeHand(s));
    s.beams.forEach((_, i) => add(nextBeamUpgrade(s, i), () => upgradeBeam(s, i)));
    if (s.smelter.built) add(nextSmelterUpgrade(s), () => upgradeSmelter(s));
    if (s.smasher.repaired) add(nextSmasherUpgrade(s), () => upgradeSmasher(s));
    options.sort((a, b) => a.cost - b.cost);
    // keep saving for a tile if the cheapest upgrade would cost more than a fifth of the next tile's credits
    const tileCredits = next ? (HULLS[s.ship.hullId].tileCosts[s.ship.ownedCells.length - 3]?.credits ?? 0) : 0;
    const pick = options.find((o) => canAfford(s, { credits: o.cost }) === 'ok' && (tileCredits === 0 || o.cost <= tileCredits * 0.5));
    if (!pick) break;
    const r = pick.run();
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

function look(s0: GameState, policy: Policy, dt: number): GameState {
  let s = s0;
  // fire beams whenever they are idle and the stage is free
  s = tapAllBeams(s).state; // the Bay's room limits it
  const rock = s.crusher.rock;
  if (!rock) return s;
  const hand = handStats(s);
  const useSmasher = policy !== 'engaged' && s.smasher.repaired && canSend(s).ok;
  if (useSmasher) return sendToSmasher(s).state;
  // hold the rock; back off when hot
  const heat = s.crusher.heat;
  if (heat > hand.heatMax * 0.85 || s.crusher.lockout > 0) return releaseHold(s).state;
  // a real finger rests in one place, so the bot holds the rock centre and only gets crits by luck
  const aimed = weakActive(s) && Math.hypot(s.crusher.weakX, s.crusher.weakY) <= BAL.weak.hitRadius;
  return holdCrush(s, dt, aimed ? s.crusher.weakX : 0, aimed ? s.crusher.weakY : 0).state;
}

export function runSim(policy: Policy, minutes: number, seed = 1): SimResult {
  let s = createInitialState(seed);
  const ms: Milestones = { tiles: {} };
  let sinceLook = 0, sinceSpend = 0, t = 0;
  let sold5 = 0;
  const end = minutes * 60;
  while (t < end) {
    const before = s.credits;
    s = tick(s, DT).state;
    t += DT;
    sinceLook += DT;
    sinceSpend += DT;
    const present = policy !== 'idle' || t % IDLE_EVERY < IDLE_BURST;
    if (present && policy !== 'casual') {
      s = look(s, policy === 'idle' ? 'engaged' : policy, DT); // a held finger acts every frame
    } else if (present && sinceLook >= LOOK[policy]) {
      s = look(s, policy, sinceLook);
      sinceLook = 0;
    }
    if (present && sinceSpend >= SPEND[policy]) {
      sinceSpend = 0;
      if (sellValue(s) > 0) {
        const o = sellAll(s);
        if (t > end - 300) sold5 += o.state.credits - s.credits;
        s = o.state;
      }
      s = spend(s);
    }
    void before;
    if (ms.smelter === undefined && s.smelter.built) ms.smelter = t;
    if (ms.repaired === undefined && s.smasher.repaired) ms.repaired = t;
    if (ms.beam2 === undefined && s.beams.length >= 2) ms.beam2 = t;
    const n = s.ship.ownedCells.length;
    if (ms.tiles[n] === undefined) ms.tiles[n] = t;
  }
  return { policy, minutes, milestones: ms, final: s, incomePerMin: sold5 / 5 };
}

export const fmt = (secs?: number): string => {
  if (secs === undefined) return '   -  ';
  const total = Math.round(secs);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`.padStart(6);
};
