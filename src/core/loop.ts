import { BAL, PRICES } from '../data/balance';
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

/** Advance the world by dt seconds. Pure; returns a new state. */
export function tick(state: GameState, dt: number, forceGeode?: boolean): Outcome {
  const s = clone(state);
  const events: GameEvent[] = [];

  // Beams: count down, then deliver a rock to the Bay (or block if it is full).
  for (const beam of s.beams) {
    if (beam.status === 'counting') {
      beam.remaining -= dt;
      if (beam.remaining <= 0) beam.status = 'blocked'; // try to deliver below
    }
    if (beam.status === 'blocked') {
      if (s.bay.length < BAL.baySlots) {
        const rock = makeRock(s, forceGeode);
        s.bay.push(rock);
        beam.status = 'idle';
        beam.remaining = 0;
        events.push({ kind: 'rock_arrived', geode: rock.geode });
      }
    }
  }
  if (s.beams.some((b) => b.status === 'blocked') && !state.beams.some((b) => b.status === 'blocked')) {
    events.push({ kind: 'beam_blocked' });
  }

  // Crusher: auto-load the next rock, cycle the weak point, cool down.
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
  c.heat = Math.max(0, c.heat - BAL.heat.cool * dt);
  c.lockout = Math.max(0, c.lockout - dt);
  return { state: s, events };
}

/**
 * Player taps the rock. (nx, ny) is the tap offset from the rock centre in rock radii.
 * A tap on the visible weak point is a 3x crit.
 */
export function tapCrush(state: GameState, nx: number, ny: number): Outcome {
  const c0 = state.crusher;
  if (!c0.rock || c0.lockout > 0) return { state, events: [] };
  const s = clone(state);
  const c = s.crusher;
  const rock = c.rock!;
  const events: GameEvent[] = [];
  const crit = weakActive(s) && Math.hypot(nx - c.weakX, ny - c.weakY) <= BAL.weak.hitRadius;

  s.stats.taps += 1;
  rock.hp -= crit ? BAL.weak.dmg : BAL.tapDmg;
  c.heat = Math.max(0, c.heat + (crit ? BAL.heat.onWeakHit : BAL.heat.perTap));
  events.push({ kind: 'hit', crit });
  if (crit) {
    c.weakT = BAL.weak.active; // consume this weak point until the next cycle
  }

  if (c.heat >= BAL.heat.max) {
    c.lockout = BAL.heat.lockout;
    c.heat = BAL.heat.resetTo;
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
  return { state: s, events };
}

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
