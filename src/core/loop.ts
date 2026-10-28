import { BAL, PRICES } from '../data/balance';
import { SMASHER } from '../data/smasher';
import { HULLS } from '../data/hulls';
import { canAfford } from './actions';
import { nextTileCost } from './hull';
import { nextRandom } from './rng';
import type { GameEvent, GameState, ItemId, Rock } from './types';

export interface Outcome {
  state: GameState;
  events: GameEvent[];
}

const clone = (s: GameState): GameState => structuredClone(s);

function rand(s: GameState): number {
  const [v, next] = nextRandom(s.rng);
  s.rng = next;
  return v;
}

function makeRock(s: GameState, forceGeode?: boolean): Rock {
  const geode = forceGeode ?? rand(s) < BAL.geode.rate;
  const base = BAL.rock.dust;
  const hp = geode ? Math.ceil(base.hp * BAL.geode.hpMul) : base.hp;
  return { kind: 'dust', geode, hp, maxHp: hp, ore: base.ore };
}

function newWeakPoint(s: GameState): void {
  const angle = rand(s) * Math.PI * 2;
  const dist = Math.sqrt(rand(s)) * BAL.weak.maxOffset;
  s.crusher.weakX = Math.cos(angle) * dist;
  s.crusher.weakY = Math.sin(angle) * dist;
}

export const weakActive = (s: GameState): boolean => s.crusher.rock !== null && s.crusher.weakT < BAL.weak.active;

export const smasherQueueCap = (s: GameState): number => SMASHER.levels[s.smasher.level - 1].queue;

// ---- beam ------------------------------------------------------------------

/** Player taps a beam. Starts its countdown if it is idle. */
export function tapBeam(state: GameState, index = 0): Outcome {
  const s = clone(state);
  const beam = s.beams[index];
  if (!beam || beam.status !== 'idle') return { state, events: [] };
  beam.status = 'counting';
  beam.remaining = BAL.beamCountdown;
  s.flags.tappedBeam = true;
  return { state: s, events: [] };
}

// ---- time ------------------------------------------------------------------

/** Advance the world by dt seconds. Pure; returns a new state. */
export function tick(state: GameState, dt: number, forceGeode?: boolean): Outcome {
  const s = clone(state);
  const events: GameEvent[] = [];

  // Beams: count down, then deliver a rock (to the Bay, or straight to the Smasher with auto-intake).
  for (const beam of s.beams) {
    if (beam.status === 'counting') {
      beam.remaining -= dt;
      if (beam.remaining <= 0) beam.status = 'blocked'; // try to deliver below
    }
    if (beam.status === 'blocked') {
      const rock = makeRock(s, forceGeode);
      const sm = s.smasher;
      const intake =
        sm.repaired &&
        sm.level >= SMASHER.autoIntakeLevel &&
        !rock.geode &&
        s.bay.length >= 1 && // the player always keeps something to tap
        sm.queue.length < smasherQueueCap(s);
      if (intake) {
        sm.queue.push(rock);
        beam.status = 'idle';
        beam.remaining = 0;
        events.push({ kind: 'rock_arrived', geode: false });
      } else if (s.bay.length < BAL.baySlots) {
        s.bay.push(rock);
        beam.status = 'idle';
        beam.remaining = 0;
        events.push({ kind: 'rock_arrived', geode: rock.geode });
      } else {
        // Bay full: the rock waits at the beam. Undo the RNG draw side effects are harmless (seeded).
        s.rng = state.rng;
      }
    }
  }
  if (s.beams.some((b) => b.status === 'blocked') && !state.beams.some((b) => b.status === 'blocked')) {
    events.push({ kind: 'beam_blocked' });
  }

  // Stage: auto-load the next rock, cycle the weak point, cool down (not while holding).
  const c = s.crusher;
  if (!c.rock && s.bay.length > 0) {
    c.rock = s.bay.shift()!;
    c.weakT = 0;
    newWeakPoint(s);
  }
  if (c.rock) {
    c.weakT += dt;
    if (c.weakT >= BAL.weak.cycle) {
      c.weakT -= BAL.weak.cycle;
      newWeakPoint(s);
    }
  }
  if (!c.holding) c.heat = Math.max(0, c.heat - BAL.heat.cool * dt);
  c.lockout = Math.max(0, c.lockout - dt);
  if (c.lockout > 0) {
    c.holding = false;
    c.holdT = 0;
    c.holdAcc = 0;
  }

  // Smasher: work through the queue at its rate. Carries leftover damage to the next rock.
  if (s.smasher.repaired && s.smasher.queue.length > 0) {
    let dmg = SMASHER.levels[s.smasher.level - 1].hpPerSec * dt;
    while (dmg > 0 && s.smasher.queue.length > 0) {
      const head = s.smasher.queue[0];
      if (head.hp > dmg) {
        head.hp -= dmg;
        dmg = 0;
      } else {
        dmg -= head.hp;
        s.smasher.queue.shift();
        s.items.ore += head.ore;
        s.stats.rocks += 1;
        s.stats.smashed += 1;
        events.push({ kind: 'smashed', ore: head.ore });
      }
    }
  }
  return { state: s, events };
}

// ---- hand crushing -------------------------------------------------------------

type HitKind = 'tap' | 'hold';

/** Shared damage + heat + completion logic for manual taps and hold auto-taps. Mutates s. */
function applyHit(s: GameState, nx: number, ny: number, kind: HitKind, events: GameEvent[]): void {
  const c = s.crusher;
  const rock = c.rock;
  if (!rock || c.lockout > 0) return;
  const crit = weakActive(s) && Math.hypot(nx - c.weakX, ny - c.weakY) <= BAL.weak.hitRadius;

  s.stats.taps += kind === 'tap' ? 1 : 0;
  s.stats.holdTicks += kind === 'hold' ? 1 : 0;
  rock.hp -= crit ? BAL.weak.dmg : kind === 'hold' ? BAL.hold.dmg : BAL.tapDmg;
  const heat = kind === 'hold' ? BAL.heat.perHoldTick : BAL.heat.perTap;
  c.heat = Math.max(0, c.heat + (crit ? BAL.heat.onWeakHit : heat));
  events.push({ kind: 'hit', crit });
  if (crit) c.weakT = BAL.weak.active; // consume this weak point until the next cycle

  if (c.heat >= BAL.heat.max) {
    c.lockout = BAL.heat.lockout;
    c.heat = BAL.heat.resetTo;
    c.holding = false;
    c.holdT = 0;
    c.holdAcc = 0;
    s.stats.overheats += 1;
    events.push({ kind: 'overheat' });
  }

  if (rock.hp <= 0) {
    let credits = 0;
    let shard = false;
    s.items.ore += rock.ore;
    s.stats.rocks += 1;
    if (rock.geode) {
      s.stats.geodes += 1;
      s.pity += 1;
      credits = Math.round(rock.ore * PRICES.ore * BAL.geode.jackpotOreMul);
      s.credits += credits;
      if (s.pity >= BAL.geode.pity || rand(s) < BAL.geode.shardChance) {
        shard = true;
        s.pity = 0;
        s.items.core_shard += 1;
      }
    }
    c.rock = null;
    c.weakT = 0;
    events.push({ kind: 'crushed', ore: rock.ore, geode: rock.geode, credits, shard });
  }
}

/**
 * Player taps the rock. (nx, ny) is the tap offset from the rock centre in rock radii.
 * A tap on the visible weak point is a 3x crit.
 */
export function tapCrush(state: GameState, nx: number, ny: number): Outcome {
  const c0 = state.crusher;
  if (!c0.rock || c0.lockout > 0) return { state, events: [] };
  const s = clone(state);
  const events: GameEvent[] = [];
  applyHit(s, nx, ny, 'tap', events);
  return { state: s, events };
}

/**
 * Call every frame while a finger is held on the rock. After the hold delay it auto-taps at
 * BAL.hold.rate. While holding, heat does not cool. Dragging the held finger over the weak point crits.
 */
export function holdCrush(state: GameState, dt: number, nx: number, ny: number): Outcome {
  if (!state.crusher.rock || state.crusher.lockout > 0) return { state, events: [] };
  const s = clone(state);
  const c = s.crusher;
  const events: GameEvent[] = [];
  c.holdT += dt;
  if (c.holdT < BAL.hold.delay) return { state: s, events };
  if (!c.holding) {
    c.holding = true;
    s.flags.usedHold = true;
  }
  c.holdAcc += dt * BAL.hold.rate;
  while (c.holdAcc >= 1 && c.rock && c.lockout <= 0) {
    c.holdAcc -= 1;
    applyHit(s, nx, ny, 'hold', events);
    events.push({ kind: 'hold_tick' });
  }
  return { state: s, events };
}

/** Finger lifted (or cancelled by the system): stop holding, cooling resumes. */
export function releaseHold(state: GameState): Outcome {
  const c = state.crusher;
  if (!c.holding && c.holdT === 0 && c.holdAcc === 0) return { state, events: [] };
  const s = clone(state);
  s.crusher.holding = false;
  s.crusher.holdT = 0;
  s.crusher.holdAcc = 0;
  return { state: s, events: [] };
}

// ---- Rock Smasher ----------------------------------------------------------------

export type SendCheck =
  | { ok: true }
  | { ok: false; reason: 'rusty' | 'no_rock' | 'geode' | 'full'; label: string };

/** What the Send button should do and say right now. */
export function canSend(s: GameState): SendCheck {
  if (!s.smasher.repaired) return { ok: false, reason: 'rusty', label: 'Smasher is rusty' };
  const rock = s.crusher.rock;
  if (!rock) return { ok: false, reason: 'no_rock', label: 'No rock to send' };
  if (rock.geode) return { ok: false, reason: 'geode', label: 'Crack this one yourself' };
  const cap = smasherQueueCap(s);
  if (s.smasher.queue.length >= cap) {
    return { ok: false, reason: 'full', label: `Smasher full ${s.smasher.queue.length}/${cap}` };
  }
  return { ok: true };
}

/** Send the stage rock to the Smasher queue. Damage already dealt is kept. */
export function sendToSmasher(state: GameState): Outcome {
  if (!canSend(state).ok) return { state, events: [] };
  const s = clone(state);
  s.smasher.queue.push(s.crusher.rock!);
  s.crusher.rock = null;
  s.crusher.weakT = 0;
  s.crusher.holding = false;
  s.crusher.holdT = 0;
  s.crusher.holdAcc = 0;
  s.stats.sent += 1;
  return { state: s, events: [{ kind: 'sent' }] };
}

export type SpendResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: 'need_credits' | 'need_items' | 'already' | 'max_level' };

export function repairSmasher(state: GameState): SpendResult {
  if (state.smasher.repaired) return { ok: false, reason: 'already' };
  const afford = canAfford(state, SMASHER.repair);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = clone(state);
  s.credits -= SMASHER.repair.credits;
  for (const [k, v] of Object.entries(SMASHER.repair.items ?? {})) s.items[k as ItemId] -= v ?? 0;
  s.smasher.repaired = true;
  return { ok: true, state: s, events: [{ kind: 'repaired' }] };
}

/** Cost of the next Smasher level, or undefined at max. */
export function nextSmasherUpgrade(s: GameState) {
  return SMASHER.levels[s.smasher.level]?.cost;
}

export function upgradeSmasher(state: GameState): SpendResult {
  if (!state.smasher.repaired) return { ok: false, reason: 'need_items' };
  const cost = nextSmasherUpgrade(state);
  if (!cost) return { ok: false, reason: 'max_level' };
  const afford = canAfford(state, cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = clone(state);
  s.credits -= cost.credits;
  s.smasher.level += 1;
  return { ok: true, state: s, events: [{ kind: 'smasher_upgraded', level: s.smasher.level }] };
}

// ---- selling -----------------------------------------------------------------------

/** Ore the player should keep for the current structure goal (Smasher repair, then the next hull tile). */
export function oreReserve(s: GameState): number {
  if (s.stats.sold < 1) return 0; // the very first sell is the tutorial: sell everything
  if (!s.smasher.repaired) return SMASHER.repair.items?.ore ?? 0;
  const def = HULLS[s.ship.hullId];
  return def ? (nextTileCost(def, s.ship.ownedCells.length)?.items?.ore ?? 0) : 0;
}

/** How much Ore the Sell button will sell right now. */
export const sellableOre = (s: GameState): number => Math.max(0, Math.floor(s.items.ore) - oreReserve(s));

/** Sell all (or qty) of an item at its base price. */
export function sell(state: GameState, item: ItemId, qty?: number): Outcome {
  const have = Math.floor(state.items[item]);
  const n = Math.min(qty ?? have, have);
  if (n <= 0) return { state, events: [] };
  const s = clone(state);
  const credits = n * PRICES[item];
  s.items[item] -= n;
  s.credits += credits;
  s.stats.sold += n;
  return { state: s, events: [{ kind: 'sold', item, qty: n, credits }] };
}
