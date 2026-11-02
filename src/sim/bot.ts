/**
 * Headless economy bot. Plays the REAL core rules (no re-implemented economy) with a simple policy,
 * so pacing numbers always match the game. Pure and deterministic: the RNG lives in the state.
 */
import { buyTile } from '../core/actions';
import { HULLS } from '../data/hulls';
import { unlockableCells } from '../core/hull';
import {
  canSend, handStats, holdCrush, nextBeamUpgrade, nextConverterUpgrade, upgradeConverter, nextHandUpgrade, nextModuleUpgrade, nextSmasherUpgrade, nextSmelterUpgrade,
  releaseHold, repairSmasher, sellSelected, sendToSmasher, tapAllBeams, tick, upgradeBeam, upgradeHand, upgradeModule,
  upgradeSmasher, upgradeSmelter, weakActive,
} from '../core/loop';
import { freeCells, freeCellsFor, moduleCost, moduleCount, moduleUnlocked, placeModule } from '../core/modules';
import { evaluatePower, sparePower } from '../core/power';
import { atStation, buyPack, convertHull, dockCheck, packCost } from '../core/station';
import { structureGoal } from '../core/reserve';
import { atOrbit, buyAttachment, canLaunch, collectHaul, launchRover } from '../core/rover';
import { ATTACHMENTS } from '../data/rover';
import { canDepart, depart, hasVisited, inTransit } from '../core/travel';
import { canDeliver, deliverJob, rank } from '../core/jobs';
import { RANK } from '../data/jobs';
import { POWER } from '../data/power';
import type { ItemId, ModuleId } from '../core/types';
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
  melter?: number;
  orbit?: number;
  station?: number;
  /** The Dry Dock conversion (Tug to Hauler hull); not the Hauler rank. */
  drydock?: number;
  roverBay?: number;
  fab?: number;
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
/** Rover trips the bot makes at Veda before flying on to the Station. */
const BOT_ROVER_TRIPS = 5;
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
  const solar = (): GameState | null => {
    const cells = freeCellsFor(s, 'solar');
    if (!cells.length || !moduleUnlocked(s, 'solar') || id === 'solar') return null;
    const r = placeModule(s, 'solar', cells[0]);
    return r.ok ? r.state : null;
  };
  if (draw > 0 && sparePower(s) < draw) return solar();
  const cells = freeCellsFor(s, id);
  if (!cells.length) return null;
  // the first tile where it gets power (a real player sees the red bolt and moves it)
  let first: GameState | null = null;
  for (const c of cells) {
    const r = placeModule(s, id, c);
    if (!r.ok) continue;
    if (draw === 0 || evaluatePower(r.state).powered.has(r.state.ship.modules[r.state.ship.modules.length - 1].uid)) return r.state;
    first ??= r.state;
  }
  return solar() ?? first;
}

/** Converters the ship still needs a tile for (the Melter, then the Fabricator): copies must leave room. */
const tilesToKeep = (s: GameState): number =>
  (s.melters.length === 0 && hasVisited(s, 'belt') ? 1 : 0) + (s.fabs.length === 0 && hasVisited(s, 'belt') ? 1 : 0)
  + (moduleCount(s, 'rover') === 0 && hasVisited(s, 'rings') ? 1 : 0);

/** Travel policy: leave as soon as the Engine can, but only for the Belt once the Grapple is built for the next leg. */
function travel(s: GameState): GameState {
  if (inTransit(s) || !canDepart(s).ok) return s;
  if (hasVisited(s, 'belt') && moduleCount(s, 'grapple') === 0) return s; // farm the Belt with a Grapple first
  if (hasVisited(s, 'belt') && s.ship.ownedCells.length < 11) return s; // and buy the Ice tiles there
  // at Veda: build the Rover Bay and stay for a few trips (the goods pay for attachments and the Dry Dock)
  if (atOrbit(s) && (moduleCount(s, 'rover') === 0 || s.rover.trips < BOT_ROVER_TRIPS)) return s;
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
    // Day 10: an Ice Melter once offered, then a Fabricator (each with a Solar Wing first if needed)
    for (const id of ['melter', 'fab'] as const) {
      if (moduleCount(s, id) === 0 && moduleUnlocked(s, id) && moduleCost(s, id) && canAfford(s, moduleCost(s, id)!) === 'ok') {
        const next = placeWithPower(s, id);
        if (next) { s = next; break; }
      }
    }
    // Day 11: the Rover Bay at Veda, and attachments (Wheels, Drill, Battery first)
    if (moduleCount(s, 'rover') === 0 && moduleUnlocked(s, 'rover') && moduleCost(s, 'rover') && canAfford(s, moduleCost(s, 'rover')!) === 'ok') {
      const next = placeWithPower(s, 'rover');
      if (next) { s = next; continue; }
    }
    if (moduleCount(s, 'rover') > 0) {
      const want = (['wheels', 'drill', 'battery'] as const).find((a) => !s.rover.owned.includes(a) && canAfford(s, ATTACHMENTS[a].cost) === 'ok');
      if (want) {
        const r = buyAttachment(s, want);
        if (r.ok) { s = r.state; continue; }
      }
    }
    // Day 12: at the Station, buy packs of whatever the goal is short of (keeping half the credits for the goal)
    if (atStation(s)) {
      const goal = structureGoal(s);
      const short = (Object.entries(goal?.cost.items ?? {}) as [ItemId, number][]).find(([k, v]) => s.items[k] < v && packCost(k));
      if (short && s.credits - packCost(short[0])!.credits >= (goal?.cost.credits ?? 0)) {
        const r = buyPack(s, short[0]);
        if (r.ok) { s = r.state; continue; }
      }
    }
    // Day 12: the Dry Dock as soon as it is affordable (the Hauler's 10 new tile spaces)
    if (dockCheck(s).ok) {
      const r = convertHull(s);
      if (r.ok) { s = r.state; continue; }
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
    if (s.ship.ownedCells.length >= HULL_END && moduleCount(s, 'engine') > 0 && freeCells(s).length > tilesToKeep(s)) {
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
    s.melters.forEach((_, i) => add(nextConverterUpgrade(s, 'melter', i), () => upgradeConverter(s, 'melter', i)));
    s.fabs.forEach((_, i) => add(nextConverterUpgrade(s, 'fab', i), () => upgradeConverter(s, 'fab', i)));
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

/** The Rover: collect a haul, then send it down again. */
function rover(s0: GameState): GameState {
  let s = s0.rover.status === 'back' ? collectHaul(s0).state : s0;
  if (canLaunch(s).ok && s.rover.trips < BOT_ROVER_TRIPS) { // then it leaves Veda for the Station
    // Dunes for the Sand that buys Wheels and Drill, the Crater for the Resin that buys the Battery, then the Ruins
    const site = s.rover.owned.length < 2 ? 'dunes' : s.rover.owned.length < 3 ? 'crater' : s.items.sand < 16 ? 'dunes' : 'ruins';
    s = launchRover(s, site).state;
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
      const saving = s.ship.ownedCells.length >= HULL_END && moduleCount(s, 'engine') > 0 && smasherReady(s) && s.smashers.length < 3 && freeCells(s).length > tilesToKeep(s);
      // planet goods and Circuits buy attachments, the Dry Dock and Hauler tiles
      const goods = (i: string) => (i === 'sand' || i === 'resin' || i === 'circuit') && moduleCount(s, 'rover') > 0;
      const sellItems = SELLABLE.filter((i) => !goods(i) && !(saving && (i === 'plate' || (i === 'ore' && s.items.plate < need)))); // Ore feeds the Smelter
      if (sellValue(s, sellItems) > 0) {
        const o = sellSelected(s, sellItems);
        if (t > end - 300) sold5 += o.state.credits - s.credits;
        s = o.state;
      }
      s = spend(rover(s));
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
    if (ms.melter === undefined && moduleCount(s, 'melter') > 0) ms.melter = t;
    if (ms.orbit === undefined && hasVisited(s, 'orbit')) ms.orbit = t;
    if (ms.station === undefined && hasVisited(s, 'station')) ms.station = t;
    if (ms.drydock === undefined && s.ship.hullId === 'hauler') ms.drydock = t;
    if (ms.roverBay === undefined && moduleCount(s, 'rover') > 0) ms.roverBay = t;
    if (ms.fab === undefined && moduleCount(s, 'fab') > 0) ms.fab = t;
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
