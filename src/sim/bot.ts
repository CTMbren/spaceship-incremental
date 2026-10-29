/**
 * Headless economy bot. Plays the REAL core rules (no re-implemented economy) with a simple policy,
 * so pacing numbers always match the game. Pure and deterministic: the RNG lives in the state.
 */
import { buyTile } from '../core/actions';
import { HULLS } from '../data/hulls';
import { unlockableCells } from '../core/hull';
import {
  canSend, handStats, holdCrush, nextBeamUpgrade, nextHandUpgrade, nextModuleUpgrade, nextSmasherUpgrade, nextSmelterUpgrade,
  releaseHold, repairSmasher, sellSelected, sendToSmasher, tapAllBeams, tick, upgradeBeam, upgradeHand, upgradeModule,
  upgradeSmasher, upgradeSmelter, weakActive,
} from '../core/loop';
import { freeCells, freeCellsFor, moduleCost, moduleCount, moduleUnlocked, placeModule } from '../core/modules';
import { sparePower } from '../core/power';
import { canDepart, depart, hasVisited, inTransit } from '../core/travel';
import { canDeliver, deliverJob, rank } from '../core/jobs';
import { RANK } from '../data/jobs';
import { POWER } from '../data/power';
import type { ModuleId } from '../core/types';
import { SELLABLE, sellValue } from '../core/reserve';
import { needsSmelter, smasherReady } from '../core/units';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import { BAL } from '../data/balance';
import { canAfford } from '../core/actions';

export type Policy = 'engaged' | 'casual' | 'idle';

export interface Milestones {
  smelter?: number;
  repaired?: number;
  solar?: number;
  beam2?: number;
  engine?: number;
  departed?: number;
  belt?: number;
  grapple?: number;
  rings?: number;
  hauler?: number;
  salvager?: number;
  contractor?: number;
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

/** From this many tiles on the bot also buys Smelter and Smasher copies (tiles 10-11 need Ice from the Rubble Belt). */
const HULL_END = 9;
const DT = 0.1;
/** How often the policy looks at the screen (seconds) and how often it spends. */
const LOOK: Record<Policy, number> = { engaged: 0.3, casual: 2.5, idle: 0.3 };
const SPEND: Record<Policy, number> = { engaged: 3, casual: 10, idle: 10 };
/** The idle player drops in for IDLE_BURST seconds every IDLE_EVERY seconds and plays like an engaged one. */
const IDLE_EVERY = 120;
const IDLE_BURST = 20;

/**
 * Place a module on the first tile that suits it, building a Solar Wing first when the ship lacks the power
 * to run it. Returns null when neither could be built right now.
 */
function placeWithPower(s: GameState, id: ModuleId): GameState | null {
  const draw = POWER.draw[id];
  if (draw > 0 && sparePower(s) < draw) {
    const cells = freeCellsFor(s, 'solar');
    if (!cells.length || !moduleUnlocked(s, 'solar')) return null;
    const r = placeModule(s, 'solar', cells[0]);
    return r.ok ? r.state : null;
  }
  const cells = freeCellsFor(s, id);
  if (!cells.length) return null;
  const r = placeModule(s, id, cells[0]);
  return r.ok ? r.state : null;
}

/** Travel policy: leave as soon as the Engine can, but only for the Belt once the Grapple is built for the next leg. */
function travel(s: GameState): GameState {
  if (inTransit(s) || !canDepart(s).ok) return s;
  if (hasVisited(s, 'belt') && moduleCount(s, 'grapple') === 0) return s; // farm the Belt with a Grapple first
  if (hasVisited(s, 'belt') && s.ship.ownedCells.length < 11) return s; // and buy the Ice tiles there
  return depart(s).state;
}

function spend(s0: GameState): GameState {
  let s = travel(s0);
  const def = HULLS[s.ship.hullId];
  for (let guard = 0; guard < 20; guard++) {
    // structure first: Smelter, repair, second beam, Engine, Grapple (each with a Solar Wing first if needed)
    if (needsSmelter(s) && freeCells(s).length > 0) {
      const r = placeModule(s, 'smelter', freeCells(s)[0]);
      if (r.ok) { s = r.state; continue; }
    }
    if (!smasherReady(s)) {
      const r = repairSmasher(s);
      if (r.ok) { s = r.state; continue; }
    }
    if (smasherReady(s)) {
      const want: ModuleId | null = s.beams.filter((b) => b.kind === 'tractor').length < 2 ? 'beam'
        : moduleCount(s, 'engine') === 0 ? 'engine'
          : hasVisited(s, 'belt') && moduleCount(s, 'grapple') === 0 ? 'grapple' : null;
      if (want) {
        const next = placeWithPower(s, want);
        if (next) { s = travel(next); continue; }
      }
    }
    // the Auto-Winch next to a beam once the Contractor rank allows it
    if (moduleCount(s, 'winch') === 0 && rank(s) >= RANK.winch) {
      const next = placeWithPower(s, 'winch');
      if (next) { s = next; continue; }
    }
    // tiles beat upgrades whenever affordable
    const next = unlockableCells(def, new Set(s.ship.ownedCells))[0];
    if (next) {
      const r = buyTile(s, next);
      if (r.ok) { s = r.state; continue; }
    }
    // production copies on spare tiles: a 2nd/3rd Smelter once Ore piles up, Smashers whenever affordable
    if (s.ship.ownedCells.length >= HULL_END && moduleCount(s, 'engine') > 0 && freeCells(s).length > 0) {
      if (s.smelters.length < 3 && s.items.ore >= 40 && moduleCost(s, 'smelter') && canAfford(s, moduleCost(s, 'smelter')!) === 'ok') {
        const next = placeWithPower(s, 'smelter');
        if (next) { s = next; continue; }
      }
      if (s.smashers.length < 3 && smasherReady(s) && moduleCost(s, 'smasher') && canAfford(s, moduleCost(s, 'smasher')!) === 'ok') {
        const next = placeWithPower(s, 'smasher');
        if (next) { s = next; continue; }
      }
    }
    // otherwise the cheapest affordable upgrade
    const options: { cost: number; run: () => ReturnType<typeof upgradeHand> }[] = [];
    const add = (cost: { credits: number } | undefined, run: () => ReturnType<typeof upgradeHand>) => {
      if (cost) options.push({ cost: cost.credits, run });
    };
    add(nextHandUpgrade(s), () => upgradeHand(s));
    s.beams.forEach((_, i) => add(nextBeamUpgrade(s, i), () => upgradeBeam(s, i)));
    s.smelters.forEach((_, i) => add(nextSmelterUpgrade(s, i), () => upgradeSmelter(s, i)));
    s.smashers.forEach((m, i) => { if (m.repaired) add(nextSmasherUpgrade(s, i), () => upgradeSmasher(s, i)); });
    s.ship.modules.forEach((m) => { if (m.defId === 'solar' || m.defId === 'engine') add(nextModuleUpgrade(s, m.uid), () => upgradeModule(s, m.uid)); });
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
  const useSmasher = policy !== 'engaged' && smasherReady(s) && canSend(s).ok;
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
      // jobs first: hand over what it holds (partial delivery), then sell what is left
      for (let i = 0; i < s.jobs.slots.length; i++) if (canDeliver(s, i).ok) s = deliverJob(s, i).state;
      // while saving Plate for the next Smasher copy the bot keeps its Plate and the Ore the Smelter turns into it
      const need = moduleCost(s, 'smasher')?.items?.plate ?? 0;
      const saving = s.ship.ownedCells.length >= HULL_END && moduleCount(s, 'engine') > 0 && smasherReady(s) && s.smashers.length < 3 && freeCells(s).length > 0;
      const sellItems = SELLABLE.filter((i) => !(saving && (i === 'plate' || (i === 'ore' && s.items.plate < need)))); // Ore feeds the Smelter
      if (sellValue(s, sellItems) > 0) {
        const o = sellSelected(s, sellItems);
        if (t > end - 300) sold5 += o.state.credits - s.credits;
        s = o.state;
      }
      s = spend(s);
    }
    void before;
    if (ms.smelter === undefined && s.smelters.length > 0) ms.smelter = t;
    if (ms.repaired === undefined && smasherReady(s)) ms.repaired = t;
    if (ms.beam2 === undefined && s.beams.filter((b) => b.kind === 'tractor').length >= 2) ms.beam2 = t;
    if (ms.solar === undefined && moduleCount(s, 'solar') > 0) ms.solar = t;
    if (ms.engine === undefined && moduleCount(s, 'engine') > 0) ms.engine = t;
    if (ms.departed === undefined && inTransit(s)) ms.departed = t;
    if (ms.belt === undefined && hasVisited(s, 'belt')) ms.belt = t;
    if (ms.grapple === undefined && moduleCount(s, 'grapple') > 0) ms.grapple = t;
    if (ms.rings === undefined && hasVisited(s, 'rings')) ms.rings = t;
    if (ms.hauler === undefined && rank(s) >= RANK.bay) ms.hauler = t;
    if (ms.salvager === undefined && rank(s) >= RANK.slot) ms.salvager = t;
    if (ms.contractor === undefined && rank(s) >= RANK.winch) ms.contractor = t;
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
