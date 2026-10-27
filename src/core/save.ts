import { SAVE_VERSION, createInitialState } from './state';
import type { GameState } from './types';

const KEY = 'last-tug-save';

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Returns a fresh state if the data is missing, corrupt, or from an unknown future version. */
export function deserialize(raw: string | null): GameState {
  if (!raw) return createInitialState();
  try {
    const data = JSON.parse(raw) as GameState;
    if (typeof data?.version !== 'number' || data.version > SAVE_VERSION) return createInitialState();
    // Migrations go here: if (data.version < 2) { ... data.version = 2 }
    return { ...createInitialState(), ...data };
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
