import { SAVE_VERSION, createInitialState } from './state';
import type { GameState } from './types';

const KEY = 'last-tug-save';

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

type Loose = Partial<GameState> & { version: number };

/** Returns a fresh state if the data is missing, corrupt, or from an unknown future version. */
export function deserialize(raw: string | null): GameState {
  if (!raw) return createInitialState();
  try {
    const data = JSON.parse(raw) as Loose;
    if (typeof data?.version !== 'number' || data.version > SAVE_VERSION) return createInitialState();
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
    data.version = cur.version;
    return { ...createInitialState(), ...cur } as GameState;
  } catch {
    return createInitialState();
  }
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
