import { POWER, SOLAR } from '../data/power';
import { parseKey } from './hull';
import type { GameState, ModuleInstance } from './types';

/** Derived every time it is needed; never saved (CLAUDE.md: derived values are recomputed). */
export interface PowerInfo {
  /** Total supply (hull base + every Solar Wing). */
  supply: number;
  /** Total draw of every working module. */
  draw: number;
  /** Uids of modules that are powered (modules that draw nothing are not listed). */
  powered: Set<number>;
  /** Uids of powered modules touching a Solar Wing (+15% speed). */
  boosted: Set<number>;
  /** Uids of modules that draw power but get none. */
  unpowered: number[];
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** What a module draws right now. A Rusty Smasher and a Smelter switched OFF draw nothing. */
export function moduleDraw(s: GameState, m: ModuleInstance): number {
  if (m.defId === 'smasher' && !s.smashers.find((u) => u.uid === m.uid)?.repaired) return 0;
  if (m.defId === 'smelter' && !s.smelters.find((u) => u.uid === m.uid)?.on) return 0;
  return POWER.draw[m.defId];
}

export const solarLevel = (m: ModuleInstance) => SOLAR.levels[Math.min(SOLAR.levels.length, m.level ?? 1) - 1];

/** Path distance (through owned tiles) from `from` to every owned tile within `reach`. */
export function distances(owned: ReadonlySet<string>, from: string, reach: number): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  let frontier = [from];
  for (let d = 1; d <= reach && frontier.length; d++) {
    const next: string[] = [];
    for (const k of frontier) {
      const c = parseKey(k);
      for (const [dx, dy] of DIRS) {
        const n = `${c.x + dx},${c.y + dy}`;
        if (owned.has(n) && !dist.has(n)) {
          dist.set(n, d);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Who gets power. Each Solar Wing (in build order) powers the nearest modules within its reach while its
 * output covers their draw (nearest first, ties by build order). Then the hull's own base power goes to the
 * modules still unpowered, in build order. A module is powered fully or not at all. Pure and deterministic.
 */
export function evaluatePower(s: GameState): PowerInfo {
  const owned = new Set(s.ship.ownedCells);
  const consumers = s.ship.modules.filter((m) => moduleDraw(s, m) > 0).sort((a, b) => a.uid - b.uid);
  const solars = s.ship.modules.filter((m) => m.defId === 'solar').sort((a, b) => a.uid - b.uid);
  const powered = new Set<number>();
  let supply = POWER.hullBase;
  for (const sol of solars) {
    const lv = solarLevel(sol);
    supply += lv.output;
    const dist = distances(owned, sol.cell, lv.reach);
    let left = lv.output;
    const near = consumers
      .filter((c) => !powered.has(c.uid) && dist.has(c.cell))
      .sort((a, b) => dist.get(a.cell)! - dist.get(b.cell)! || a.uid - b.uid);
    for (const c of near) {
      const d = moduleDraw(s, c);
      if (d <= left) {
        powered.add(c.uid);
        left -= d;
      }
    }
  }
  let base = POWER.hullBase;
  for (const c of consumers) {
    if (powered.has(c.uid)) continue;
    const d = moduleDraw(s, c);
    if (d <= base) {
      powered.add(c.uid);
      base -= d;
    }
  }
  const solarCells = new Set(solars.map((m) => m.cell));
  const boosted = new Set<number>();
  for (const c of consumers) {
    if (!powered.has(c.uid)) continue;
    const p = parseKey(c.cell);
    if (DIRS.some(([dx, dy]) => solarCells.has(`${p.x + dx},${p.y + dy}`))) boosted.add(c.uid);
  }
  const draw = consumers.reduce((n, c) => n + moduleDraw(s, c), 0);
  return { supply, draw, powered, boosted, unpowered: consumers.filter((c) => !powered.has(c.uid)).map((c) => c.uid) };
}

/** Speed multiplier for a module: 0 when it needs power and has none, x1.15 with a Boost, else 1. */
export function powerMul(s: GameState, info: PowerInfo, uid: number): number {
  const m = s.ship.modules.find((x) => x.uid === uid);
  if (!m || moduleDraw(s, m) <= 0) return 1;
  if (!info.powered.has(uid)) return 0;
  return info.boosted.has(uid) ? POWER.boost : 1;
}

/** Power left over (supply minus draw), ignoring reach. Used by goals to suggest a Solar Wing in time. */
export const sparePower = (s: GameState): number => {
  const p = evaluatePower(s);
  return p.supply - p.draw;
};
