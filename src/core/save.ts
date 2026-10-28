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
    // Migrations. v1 -> v2: added the core-loop state; keep credits, items and hull.
    if (data.version < 2) {
      const fresh = createInitialState();
      return {
        ...fresh,
        credits: data.credits ?? fresh.credits,
        items: { ...fresh.items, ...(data.items ?? {}) },
        ship: data.ship ?? fresh.ship,
      };
    }
    return { ...createInitialState(), ...data } as GameState;
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
