import { BAL, PRICES } from '../data/balance';
import { HAND } from '../data/hand';
import { BEAM, SMELTER } from '../data/modules';
import { SMASHER } from '../data/smasher';
import { canAfford } from './actions';
import { availableQty, SELLABLE, smeltableQty } from './reserve';
import { nextRandom } from './rng';
import { roomiestSmasher, smasherCap, smasherReady } from './units';
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

function makeRock(s: GameState, forceGeode?: boolean, beamLevel = 1): Rock {
  const geode = forceGeode ?? rand(s) < BAL.geode.rate;
  const base = BAL.rock.dust;
  const hp = geode ? Math.ceil(base.hp * BAL.geode.hpMul) : base.hp;
  const ore = Math.round(base.ore * BEAM.levels[beamLevel - 1].oreMul);
  return { kind: 'dust', geode, hp, maxHp: hp, ore };
}

/** Hand Tools effects at the player's current level. */
export const handStats = (s: GameState) => HAND.levels[s.handLevel - 1];

function newWeakPoint(s: GameState): void {
  const angle = rand(s) * Math.PI * 2;
  const dist = Math.sqrt(rand(s)) * BAL.weak.maxOffset;
  s.crusher.weakX = Math.cos(angle) * dist;
  s.crusher.weakY = Math.sin(angle) * dist;
}

export const weakActive = (s: GameState): boolean => s.crusher.rock !== null && s.crusher.weakT < BAL.weak.active;

/** Total queue room across all repaired Smashers, and how many rocks they hold (the Smash button shows these). */
export const smasherQueueCap = (s: GameState): number => s.smashers.reduce((n, m) => n + (m.repaired ? smasherCap(m) : 0), 0);
export const smasherQueued = (s: GameState): number => s.smashers.reduce((n, m) => n + m.queue.length, 0);

// ---- beam ------------------------------------------------------------------

/**
 * Free Bay slots, counting rocks already on their way (a beam counting down or waiting to deliver), so
 * the player can never fire more rocks than the Bay can hold. Fire stays available until this is 0.
 */
export const bayRoom = (s: GameState): number =>
  Math.max(0, BAL.baySlots - s.bay.length - s.beams.filter((b) => b.status !== 'idle').length);

/** Player taps a beam. Starts its countdown if it is idle and there is room in the Bay. */
export function tapBeam(state: GameState, index = 0): Outcome {
  const beam = state.beams[index];
  if (!beam || beam.status !== 'idle' || bayRoom(state) <= 0) return { state, events: [] };
  const s = clone(state);
  s.beams[index].status = 'counting';
  s.beams[index].remaining = BAL.beamCountdown;
  s.flags.tappedBeam = true;
  return { state: s, events: [] };
}

/** The Fire button: start idle beams, as many as there is room in the Bay for (first beams first). */
export function tapAllBeams(state: GameState): Outcome {
  let room = bayRoom(state);
  if (room <= 0 || !state.beams.some((b) => b.status === 'idle')) return { state, events: [] };
  const s = clone(state);
  for (const b of s.beams) {
    if (room > 0 && b.status === 'idle') {
      b.status = 'counting';
      b.remaining = BAL.beamCountdown;
      room -= 1;
    }
  }
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
      const rock = makeRock(s, forceGeode, beam.level);
      // auto-intake: a level 2+ Smasher with room takes plain rocks straight from the beam (the roomiest first)
      const sm = !rock.geode && s.bay.length >= 1 /* the player always keeps something to tap */
        ? roomiestSmasher(s, SMASHER.autoIntakeLevel)
        : null;
      if (sm) {
        sm.queue.push(rock);
        beam.status = 'idle';
        beam.remaining = 0;
        events.push({ kind: 'rock_arrived', geode: false, to: 'smasher' });
      } else if (s.bay.length < BAL.baySlots) {
        s.bay.push(rock);
        beam.status = 'idle';
        beam.remaining = 0;
        events.push({ kind: 'rock_arrived', geode: rock.geode, to: 'bay' });
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
  const hand = handStats(s);
  if (!c.holding) c.heat = Math.max(0, c.heat - hand.cool * dt);
  c.lockout = Math.max(0, c.lockout - dt);
  if (c.lockout > 0) {
    c.holding = false;
    c.holdT = 0;
    c.holdAcc = 0;
  }

  // Smashers: each works through its own queue at its rate. Carries leftover damage to the next rock.
  for (const unit of s.smashers) {
    if (!unit.repaired || unit.queue.length === 0) continue;
    let dmg = SMASHER.levels[unit.level - 1].hpPerSec * dt;
    while (dmg > 0 && unit.queue.length > 0) {
      const head = unit.queue[0];
      if (head.hp > dmg) {
        head.hp -= dmg;
        dmg = 0;
      } else {
        dmg -= head.hp;
        unit.queue.shift();
        s.items.ore += head.ore;
        s.stats.rocks += 1;
        s.stats.smashed += 1;
        events.push({ kind: 'smashed', ore: head.ore, uid: unit.uid });
      }
    }
  }

  // Smelters: each turns Ore into Plate in batches from the shared stock, never touching Ore reserved for the current goal.
  for (const sm of s.smelters) {
    if (!sm.on) continue;
    const secPerBatch = SMELTER.levels[sm.level - 1].secPerBatch;
    let t = dt;
    while (t > 1e-12) {
      if (smeltableQty(s, 'ore') < SMELTER.batchIn) {
        sm.progress = 0; // starved: wait for Ore
        break;
      }
      const need = (1 - sm.progress) * secPerBatch;
      if (t >= need - 1e-9) {
        t = Math.max(0, t - need);
        s.items.ore -= SMELTER.batchIn;
        s.items.plate += SMELTER.batchOut;
        s.stats.smelted += SMELTER.batchOut;
        sm.progress = 0;
        events.push({ kind: 'smelted', plate: SMELTER.batchOut, uid: sm.uid });
      } else {
        sm.progress += t / secPerBatch;
        t = 0;
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
  const hand = handStats(s);
  rock.hp -= (crit ? BAL.weak.dmg : kind === 'hold' ? BAL.hold.dmg : BAL.tapDmg) * hand.dmgMul;
  const heat = kind === 'hold' ? BAL.heat.perHoldTick : BAL.heat.perTap;
  c.heat = Math.max(0, c.heat + (crit ? BAL.heat.onWeakHit : heat));
  events.push({ kind: 'hit', crit });
  if (crit) c.weakT = BAL.weak.active; // consume this weak point until the next cycle

  if (c.heat >= hand.heatMax) {
    c.lockout = hand.lockout;
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
      credits = Math.round(rock.ore * PRICES.ore * BAL.geode.jackpotOreMul * hand.jackpotMul);
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

/** What the Smash button should do and say right now. */
export function canSend(s: GameState): SendCheck {
  if (!smasherReady(s)) return { ok: false, reason: 'rusty', label: 'Smasher is rusty' };
  const rock = s.crusher.rock;
  if (!rock) return { ok: false, reason: 'no_rock', label: 'No rock to smash' };
  if (rock.geode) return { ok: false, reason: 'geode', label: 'Crack this one yourself' };
  if (!roomiestSmasher(s)) {
    return { ok: false, reason: 'full', label: `Smashers full ${smasherQueued(s)}/${smasherQueueCap(s)}` };
  }
  return { ok: true };
}

/** Send the stage rock to the Smasher with the most room. Damage already dealt is kept. */
export function sendToSmasher(state: GameState): Outcome {
  if (!canSend(state).ok) return { state, events: [] };
  const s = clone(state);
  roomiestSmasher(s)!.queue.push(s.crusher.rock!);
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

/** Repairs the Rusty Smasher (the one the ship starts with). */
export function repairSmasher(state: GameState): SpendResult {
  if (!state.smashers.some((m) => !m.repaired)) return { ok: false, reason: 'already' };
  const afford = canAfford(state, SMASHER.repair);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = clone(state);
  s.credits -= SMASHER.repair.credits;
  for (const [k, v] of Object.entries(SMASHER.repair.items ?? {})) s.items[k as ItemId] -= v ?? 0;
  s.smashers.find((m) => !m.repaired)!.repaired = true;
  return { ok: true, state: s, events: [{ kind: 'repaired' }] };
}

/** Cost of the next level of Smasher number `index` (0 = the first), or undefined at max. */
export function nextSmasherUpgrade(s: GameState, index = 0) {
  const sm = s.smashers[index];
  return sm ? SMASHER.levels[sm.level]?.cost : undefined;
}

export function upgradeSmasher(state: GameState, index = 0): SpendResult {
  const sm = state.smashers[index];
  if (!sm || !sm.repaired) return { ok: false, reason: 'need_items' };
  const cost = nextSmasherUpgrade(state, index);
  if (!cost) return { ok: false, reason: 'max_level' };
  const afford = canAfford(state, cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = clone(state);
  s.credits -= cost.credits;
  s.smashers[index].level += 1;
  return { ok: true, state: s, events: [{ kind: 'smasher_upgraded', level: s.smashers[index].level }] };
}

// ---- selling -----------------------------------------------------------------------

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

/** Sell the surplus (everything not held back for the goal) of the given items. Shards are never sold. */
export function sellSelected(state: GameState, items: readonly ItemId[]): Outcome {
  const s = clone(state);
  const events: GameEvent[] = [];
  for (const item of SELLABLE) {
    if (!items.includes(item)) continue;
    const n = availableQty(state, item);
    if (n <= 0) continue;
    const credits = n * PRICES[item];
    s.items[item] -= n;
    s.credits += credits;
    s.stats.sold += n;
    events.push({ kind: 'sold', item, qty: n, credits });
  }
  return events.length ? { state: s, events } : { state, events: [] };
}

/** The quick Sell button: sell everything sellable except what the current goal needs. */
export const sellAll = (state: GameState): Outcome => sellSelected(state, SELLABLE);

/** One Cargo row's Sell button. */
export const sellSurplus = (state: GameState, item: ItemId): Outcome => sellSelected(state, [item]);

/** The Cargo sheet switch: keep back what the current goal needs (on) or let the player sell it (off). */
export function setHoldForGoal(state: GameState, on: boolean): Outcome {
  if (state.flags.holdForGoal === on) return { state, events: [] };
  const s = clone(state);
  s.flags.holdForGoal = on;
  return { state: s, events: [] };
}

// ---- upgrades (credits buy speed) ----------------------------------------------------

function levelUp(state: GameState, level: number, levels: readonly { cost: { credits: number } }[], apply: (s: GameState) => void, what: 'beam' | 'smelter' | 'smasher' | 'hand'): SpendResult {
  const next = levels[level];
  if (!next) return { ok: false, reason: 'max_level' };
  const afford = canAfford(state, next.cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = clone(state);
  s.credits -= next.cost.credits;
  apply(s);
  return { ok: true, state: s, events: [{ kind: 'upgraded', what, level: level + 1 }] };
}

export const nextBeamUpgrade = (s: GameState, index: number) => BEAM.levels[(s.beams[index]?.level ?? 99)]?.cost;
export const nextSmelterUpgrade = (s: GameState, index = 0) => {
  const sm = s.smelters[index];
  return sm ? SMELTER.levels[sm.level]?.cost : undefined;
};
export const nextHandUpgrade = (s: GameState) => HAND.levels[s.handLevel]?.cost;

export function upgradeBeam(state: GameState, index: number): SpendResult {
  const beam = state.beams[index];
  if (!beam) return { ok: false, reason: 'max_level' };
  return levelUp(state, beam.level, BEAM.levels, (s) => { s.beams[index].level += 1; }, 'beam');
}

export function upgradeSmelter(state: GameState, index = 0): SpendResult {
  const sm = state.smelters[index];
  if (!sm) return { ok: false, reason: 'need_items' };
  return levelUp(state, sm.level, SMELTER.levels, (s) => { s.smelters[index].level += 1; }, 'smelter');
}

export function upgradeHand(state: GameState): SpendResult {
  return levelUp(state, state.handLevel, HAND.levels, (s) => { s.handLevel += 1; }, 'hand');
}

export function toggleSmelter(state: GameState, index = 0): Outcome {
  if (!state.smelters[index]) return { state, events: [] };
  const s = clone(state);
  const sm = s.smelters[index];
  sm.on = !sm.on;
  if (!sm.on) sm.progress = 0;
  return { state: s, events: [] };
}
