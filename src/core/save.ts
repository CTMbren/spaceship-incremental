import { SAVE_VERSION, createInitialState } from './state';
import type { GameState, Rock } from './types';

const KEY = 'last-tug-save';

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Saves older than v7 held one `smasher` and one `smelter` object; they become unit lists in v7. */
interface LegacyUnits {
  smasher?: { repaired: boolean; level: number; queue: Rock[] };
  smelter?: { built: boolean; level: number; on: boolean; progress: number };
}
type Loose = Partial<GameState> & LegacyUnits & { version: number };

/** Is this parsed JSON plausibly a save of ours? (Used by Paste save, so a stray text cannot wipe a game.) */
function looksLikeSave(data: unknown): data is Loose {
  const d = data as Loose | null;
  return (
    !!d && typeof d === 'object' && typeof d.version === 'number' && d.version >= 1 &&
    typeof d.credits === 'number' && !!d.items && typeof d.items === 'object' &&
    !!d.ship && Array.isArray(d.ship.ownedCells)
  );
}

/** Parses and migrates save text. `ok: false` for corrupt text, not-a-save, or a save from a newer version. */
export function parseSave(raw: string | null): { ok: true; state: GameState } | { ok: false } {
  if (!raw) return { ok: false };
  try {
    const data: unknown = JSON.parse(raw);
    if (!looksLikeSave(data) || data.version > SAVE_VERSION) return { ok: false };
    // Migrations (each step upgrades one version; all are idempotent).
    let cur: Loose = data;
    if (cur.version < 2) {
      // v1 -> v2: added the core-loop state; keep credits, items and hull.
      const fresh = createInitialState();
      cur = {
        ...fresh,
        credits: cur.credits ?? fresh.credits,
        items: { ...fresh.items, ...(cur.items ?? {}) },
        ship: cur.ship ?? fresh.ship,
        version: 2,
      };
    }
    if (cur.version < 3) {
      // v2 -> v3: the Crusher tile became the Rock Smasher; hold + heat; richer stats.
      // Players who already cracked 10+ rocks keep a working Smasher; newer saves get the Rusty start.
      const fresh = createInitialState();
      const stats = { ...fresh.stats, ...(cur.stats ?? {}) };
      cur = {
        ...fresh,
        ...cur,
        stats,
        crusher: { ...fresh.crusher, ...(cur.crusher ?? {}), holding: false, holdT: 0, holdAcc: 0 },
        smasher: { repaired: stats.rocks >= 10, level: 1, queue: [] },
        flags: { ...fresh.flags, ...(cur.flags ?? {}) },
        version: 3,
      };
    }
    if (cur.version < 4) {
      // v3 -> v4: modules on tiles, Smelter, Hand Tools level, beam levels, more stats.
      const fresh = createInitialState();
      const ship = cur.ship ?? fresh.ship;
      cur = {
        ...fresh,
        ...cur,
        ship: { ...ship, modules: ship.modules ?? fresh.ship.modules },
        beams: (cur.beams ?? fresh.beams).map((b) => ({ ...b, level: b.level ?? 1 })),
        smelter: cur.smelter ?? { built: false, level: 1, on: true, progress: 0 },
        handLevel: cur.handLevel ?? fresh.handLevel,
        stats: { ...fresh.stats, ...(cur.stats ?? {}) },
        version: 4,
      };
    }
    if (cur.version < 5) {
      // v4 -> v5: savedAt for offline catch-up. 0 means "unknown", so an old save earns no offline time.
      cur = { ...cur, savedAt: cur.savedAt ?? 0, version: 5 };
    }
    if (cur.version < 6) {
      // v5 -> v6: the Cargo sheet's "hold materials for my goal" switch (on, as before).
      const fresh = createInitialState();
      cur = { ...cur, flags: { ...fresh.flags, ...(cur.flags ?? {}), holdForGoal: cur.flags?.holdForGoal ?? true }, version: 6 };
    }
    if (cur.version < 7) {
      // v6 -> v7: Smashers and Smelters are lists of units (up to 3 of each), each tied to its module tile.
      const fresh = createInitialState();
      const mods = cur.ship?.modules ?? fresh.ship.modules;
      const { smasher, smelter, ...rest } = cur;
      const smMod = mods.find((m) => m.defId === 'smasher');
      const meltMod = mods.find((m) => m.defId === 'smelter');
      const smashers = smasher
        ? [{ uid: smMod?.uid ?? 2, paid: { credits: 0 }, repaired: smasher.repaired, level: smasher.level, queue: smasher.queue ?? [] }]
        : (cur.smashers ?? fresh.smashers);
      const smelters = smelter?.built && meltMod
        ? [{ uid: meltMod.uid, paid: { credits: 0, items: { ore: 25 } }, level: smelter.level, on: smelter.on, progress: smelter.progress }]
        : (cur.smelters ?? []);
      cur = { ...rest, smashers, smelters, version: 7 };
    }
    return { ok: true, state: { ...createInitialState(), ...cur } as GameState };
  } catch {
    return { ok: false };
  }
}

/** Returns a fresh state if the data is missing, corrupt, or from an unknown future version. */
export function deserialize(raw: string | null): GameState {
  const r = parseSave(raw);
  return r.ok ? r.state : createInitialState();
}

export function saveToStorage(state: GameState): void {
  try {
    localStorage.setItem(KEY, serialize(state));
  } catch {
    /* storage can be blocked (private mode); the game still runs */
  }
}

export function loadFromStorage(): GameState {
  try {
    return deserialize(localStorage.getItem(KEY));
  } catch {
    return createInitialState();
  }
}
