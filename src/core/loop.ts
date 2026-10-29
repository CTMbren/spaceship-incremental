import { BAL, PRICES } from '../data/balance';
import { HAND } from '../data/hand';
import { BEAM, SMELTER } from '../data/modules';
import { POWER, SOLAR } from '../data/power';
import { SMASHER } from '../data/smasher';
import { ENGINE, GRAPPLE } from '../data/travel';
import { canAfford } from './actions';
import { baySize, jobsStep, noteMade } from './jobs';
import { evaluatePower, powerMul, type PowerInfo } from './power';
import { availableQty, SELLABLE, smeltableQty } from './reserve';
import { nextRandom } from './rng';
import { travelStep, zoneOf } from './travel';
import { roomiestSmasher, smasherCap, smasherReady } from './units';
import type { BeamState, GameEvent, GameState, ItemId, Rock, RockKind } from './types';

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

/** Which rock a beam pulls here: the zone's weighted Tractor table (one entry costs no random draw) or its Grapple rock. */
function pickKind(s: GameState, beam: BeamState): RockKind {
  const z = zoneOf(s);
  if (beam.kind === 'grapple') return z.grapple;
  const t = z.tractor;
  if (t.length === 1) return t[0].kind;
  const total = t.reduce((n, e) => n + e.w, 0);
  let r = rand(s) * total;
  for (const e of t) {
    r -= e.w;
    if (r < 0) return e.kind;
  }
  return t[t.length - 1].kind;
}

function makeRock(s: GameState, forceGeode: boolean | undefined, beam: BeamState): Rock {
  const z = zoneOf(s);
  const geode = forceGeode ?? rand(s) < BAL.geode.rate * z.geodeMul;
  const kind = pickKind(s, beam);
  const base = BAL.rock[kind];
  const hp = geode ? Math.ceil(base.hp * BAL.geode.hpMul) : base.hp;
  const beamMul = beam.kind === 'tractor' ? BEAM.levels[beam.level - 1].oreMul : 1;
  const ore = Math.max(1, Math.round(base.ore * beamMul * z.oreMul));
  return { kind, geode, hp, maxHp: hp, ore, ice: base.ice };
}

/** Seconds a beam counts down when fired now (Grapple levels shorten it; a Boost makes it 15% faster). */
export function beamCountdown(beam: BeamState, boosted: boolean): number {
  const base = beam.kind === 'grapple' ? GRAPPLE.countdown * GRAPPLE.levels[beam.level - 1].cdMul : BAL.beamCountdown;
  return boosted ? base / POWER.boost : base;
}

/** A beam can be fired: it is idle and its tile has power. */
export const beamReady = (s: GameState, beam: BeamState, power: PowerInfo = evaluatePower(s)): boolean =>
  beam.status === 'idle' && power.powered.has(beam.uid);

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
  Math.max(0, baySize(s) - s.bay.length - s.beams.filter((b) => b.status !== 'idle').length);

/** Player taps a beam. Starts its countdown if it is idle and there is room in the Bay. */
export function tapBeam(state: GameState, index = 0): Outcome {
  const beam = state.beams[index];
  const power = evaluatePower(state);
  if (!beam || !beamReady(state, beam, power) || bayRoom(state) <= 0) return { state, events: [] };
  const s = clone(state);
  s.beams[index].status = 'counting';
  s.beams[index].remaining = beamCountdown(beam, power.boosted.has(beam.uid));
  s.flags.tappedBeam = true;
  return { state: s, events: [] };
}

/** The Fire button: start idle beams, as many as there is room in the Bay for (first beams first). */
export function tapAllBeams(state: GameState): Outcome {
  let room = bayRoom(state);
  const power = evaluatePower(state);
  if (room <= 0 || !state.beams.some((b) => beamReady(state, b, power))) return { state, events: [] };
  const s = clone(state);
  for (const b of s.beams) {
    if (room > 0 && beamReady(s, b, power)) {
      b.status = 'counting';
      b.remaining = beamCountdown(b, power.boosted.has(b.uid));
      room -= 1;
    }
  }
  s.flags.tappedBeam = true;
  return { state: s, events: [] };
}

// ---- time ------------------------------------------------------------------

export interface TickOptions {
  /** Travel advances this many times faster than production (offline: travel runs at full speed). Default 1. */
  travelMul?: number;
  /** False pauses every Smelter (offline: Smelters go cold after a while). Default true. */
  smelt?: boolean;
  /** False keeps the Job Board's production-rate average still (offline output is not the player's pace). */
  trackRate?: boolean;
}

/** Advance the world by dt seconds. Pure; returns a new state. */
export function tick(state: GameState, dt: number, forceGeode?: boolean, opts: TickOptions = {}): Outcome {
  const s = clone(state);
  const events: GameEvent[] = [];
  const power = evaluatePower(s);

  // Beams: count down (only with power), then deliver a rock (to the Bay, or straight to the Smasher with auto-intake).
  for (const beam of s.beams) {
    if (beam.status === 'counting' && power.powered.has(beam.uid)) {
      beam.remaining -= dt;
      if (beam.remaining <= 0) beam.status = 'blocked'; // try to deliver below
    }
    if (beam.status === 'blocked') {
      const rngBefore = s.rng;
      const rock = makeRock(s, forceGeode, beam);
      // auto-intake: a level 2+ powered Smasher with room takes plain rocks straight from the beam (the roomiest first)
      const sm = !rock.geode && s.bay.length >= 1 /* the player always keeps something to tap */
        ? roomiestSmasher(s, SMASHER.autoIntakeLevel, power.powered)
        : null;
      if (sm) {
        sm.queue.push(rock);
        beam.status = 'idle';
        beam.remaining = 0;
        events.push({ kind: 'rock_arrived', geode: false, to: 'smasher' });
      } else if (s.bay.length < baySize(s)) {
        s.bay.push(rock);
        beam.status = 'idle';
        beam.remaining = 0;
        events.push({ kind: 'rock_arrived', geode: rock.geode, to: 'bay' });
      } else {
        // Bay full: the rock waits at the beam; undo its random draws so the next try is the same rock.
        s.rng = rngBefore;
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
    let dmg = SMASHER.levels[unit.level - 1].hpPerSec * powerMul(s, power, unit.uid) * dt;
    while (dmg > 0 && unit.queue.length > 0) {
      const head = unit.queue[0];
      if (head.hp > dmg) {
        head.hp -= dmg;
        dmg = 0;
      } else {
        dmg -= head.hp;
        unit.queue.shift();
        s.items.ore += head.ore;
        s.items.ice += head.ice ?? 0;
        noteMade(s, 'ore', head.ore);
        noteMade(s, 'ice', head.ice ?? 0);
        s.stats.rocks += 1;
        s.stats.smashed += 1;
        events.push({ kind: 'smashed', ore: head.ore, ice: head.ice ?? 0, uid: unit.uid });
      }
    }
  }

  // Smelters: each turns Ore into Plate in batches from the shared stock, never touching Ore reserved for the current goal.
  for (const sm of s.smelters) {
    const mul = powerMul(s, power, sm.uid);
    if (!sm.on || opts.smelt === false || mul <= 0) continue;
    const secPerBatch = SMELTER.levels[sm.level - 1].secPerBatch / mul;
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
        noteMade(s, 'plate', SMELTER.batchOut);
        s.stats.smelted += SMELTER.batchOut;
        sm.progress = 0;
        events.push({ kind: 'smelted', plate: SMELTER.batchOut, uid: sm.uid });
      } else {
        sm.progress += t / secPerBatch;
        t = 0;
      }
    }
  }

  // Travel: the Engine moves the ship along the route (offline it runs at full speed: travelMul).
  travelStep(s, dt * (opts.travelMul ?? 1), power, events);

  // Auto-Winch: every idle, powered beam touching a powered winch fires as soon as the Bay has room.
  autoWinch(s, power);

  // Job Board: output average, refills, new jobs.
  jobsStep(s, dt, events, opts.trackRate !== false);
  return { state: s, events };
}

/** Beams (Tractor or Grapple) that touch a powered Auto-Winch. Pure. */
export function winchedBeams(s: GameState, power: PowerInfo = evaluatePower(s)): Set<number> {
  const winches = s.ship.modules.filter((m) => m.defId === 'winch' && power.powered.has(m.uid)).map((m) => m.cell);
  const out = new Set<number>();
  if (!winches.length) return out;
  const near = new Set<string>();
  for (const w of winches) {
    const [x, y] = w.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) near.add(`${x + dx},${y + dy}`);
  }
  for (const m of s.ship.modules) if ((m.defId === 'beam' || m.defId === 'grapple') && near.has(m.cell)) out.add(m.uid);
  return out;
}

function autoWinch(s: GameState, power: PowerInfo): void {
  const winched = winchedBeams(s, power);
  if (!winched.size) return;
  for (const b of s.beams) {
    if (!winched.has(b.uid) || !beamReady(s, b, power) || bayRoom(s) <= 0) continue;
    b.status = 'counting';
    b.remaining = beamCountdown(b, power.boosted.has(b.uid));
  }
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
    s.items.ice += rock.ice ?? 0;
    noteMade(s, 'ore', rock.ore);
    noteMade(s, 'ice', rock.ice ?? 0);
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
    events.push({ kind: 'crushed', ore: rock.ore, ice: rock.ice ?? 0, geode: rock.geode, credits, shard });
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
  | { ok: false; reason: 'rusty' | 'no_rock' | 'geode' | 'full' | 'unpowered'; label: string };

/** What the Smash button should do and say right now. */
export function canSend(s: GameState): SendCheck {
  if (!smasherReady(s)) return { ok: false, reason: 'rusty', label: 'Smasher is rusty' };
  const rock = s.crusher.rock;
  if (!rock) return { ok: false, reason: 'no_rock', label: 'No rock to smash' };
  if (rock.geode) return { ok: false, reason: 'geode', label: 'Crack this one yourself' };
  const power = evaluatePower(s);
  if (!s.smashers.some((m) => m.repaired && power.powered.has(m.uid))) {
    return { ok: false, reason: 'unpowered', label: 'Smashers have no power' };
  }
  if (!roomiestSmasher(s, 1, power.powered)) {
    return { ok: false, reason: 'full', label: `Smashers full ${smasherQueued(s)}/${smasherQueueCap(s)}` };
  }
  return { ok: true };
}

/** Send the stage rock to the Smasher with the most room. Damage already dealt is kept. */
export function sendToSmasher(state: GameState): Outcome {
  if (!canSend(state).ok) return { state, events: [] };
  const s = clone(state);
  roomiestSmasher(s, 1, evaluatePower(s).powered)!.queue.push(s.crusher.rock!);
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

/** Sell up to `qty` units of one item (never more than the sellable surplus), e.g. the Cargo row's Sell 1. */
export function sellQty(state: GameState, item: ItemId, qty: number): Outcome {
  if (!SELLABLE.includes(item)) return { state, events: [] };
  const n = Math.min(Math.floor(qty), availableQty(state, item));
  if (n <= 0) return { state, events: [] };
  const s = clone(state);
  const credits = n * PRICES[item];
  s.items[item] -= n;
  s.credits += credits;
  s.stats.sold += n;
  return { state: s, events: [{ kind: 'sold', item, qty: n, credits }] };
}

/** The Cargo sheet switch: keep back what the current goal needs (on) or let the player sell it (off). */
export function setHoldForGoal(state: GameState, on: boolean): Outcome {
  if (state.flags.holdForGoal === on) return { state, events: [] };
  const s = clone(state);
  s.flags.holdForGoal = on;
  return { state: s, events: [] };
}

// ---- upgrades (credits buy speed) ----------------------------------------------------

export function levelUp(state: GameState, level: number, levels: readonly { cost: { credits: number } }[], apply: (s: GameState) => void, what: 'beam' | 'smelter' | 'smasher' | 'hand' | 'solar' | 'engine'): SpendResult {
  const next = levels[level];
  if (!next) return { ok: false, reason: 'max_level' };
  const afford = canAfford(state, next.cost);
  if (afford !== 'ok') return { ok: false, reason: afford };
  const s = clone(state);
  s.credits -= next.cost.credits;
  apply(s);
  return { ok: true, state: s, events: [{ kind: 'upgraded', what, level: level + 1 }] };
}

/** Level table of a beam: Tractor levels make richer rocks, Grapple levels shorten the countdown. */
export const beamLevels = (b: BeamState): readonly { name: string; cost: { credits: number } }[] =>
  b.kind === 'grapple' ? GRAPPLE.levels : BEAM.levels;
export const nextBeamUpgrade = (s: GameState, index: number) => {
  const b = s.beams[index];
  return b ? beamLevels(b)[b.level]?.cost : undefined;
};
export const nextSmelterUpgrade = (s: GameState, index = 0) => {
  const sm = s.smelters[index];
  return sm ? SMELTER.levels[sm.level]?.cost : undefined;
};
export const nextHandUpgrade = (s: GameState) => HAND.levels[s.handLevel]?.cost;

export function upgradeBeam(state: GameState, index: number): SpendResult {
  const beam = state.beams[index];
  if (!beam) return { ok: false, reason: 'max_level' };
  return levelUp(state, beam.level, beamLevels(beam), (s) => { s.beams[index].level += 1; }, 'beam');
}

export function upgradeSmelter(state: GameState, index = 0): SpendResult {
  const sm = state.smelters[index];
  if (!sm) return { ok: false, reason: 'need_items' };
  return levelUp(state, sm.level, SMELTER.levels, (s) => { s.smelters[index].level += 1; }, 'smelter');
}

export function upgradeHand(state: GameState): SpendResult {
  return levelUp(state, state.handLevel, HAND.levels, (s) => { s.handLevel += 1; }, 'hand');
}

/** Level table of a Solar Wing or the Engine (modules that keep their level on the module itself). */
const simpleLevels = (id: string): readonly { cost: { credits: number } }[] => (id === 'solar' ? SOLAR.levels : ENGINE.levels);

export function nextModuleUpgrade(s: GameState, uid: number) {
  const m = s.ship.modules.find((x) => x.uid === uid);
  if (!m || (m.defId !== 'solar' && m.defId !== 'engine')) return undefined;
  return simpleLevels(m.defId)[m.level ?? 1]?.cost;
}

/** Upgrade a Solar Wing or the Engine. */
export function upgradeModule(state: GameState, uid: number): SpendResult {
  const m = state.ship.modules.find((x) => x.uid === uid);
  if (!m || (m.defId !== 'solar' && m.defId !== 'engine')) return { ok: false, reason: 'max_level' };
  const what = m.defId;
  return levelUp(state, m.level ?? 1, simpleLevels(what), (s) => {
    const mm = s.ship.modules.find((x) => x.uid === uid)!;
    mm.level = (mm.level ?? 1) + 1;
  }, what);
}

export function toggleSmelter(state: GameState, index = 0): Outcome {
  if (!state.smelters[index]) return { state, events: [] };
  const s = clone(state);
  const sm = s.smelters[index];
  sm.on = !sm.on;
  if (!sm.on) sm.progress = 0;
  return { state: s, events: [] };
}
