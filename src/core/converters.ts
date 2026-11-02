import { FAB, MELTER, SMELTER } from '../data/modules';
import type { Cost, ConverterId, ConverterState, GameState, ItemId } from './types';

/** One batch recipe and its level table. Every converter works the same way (see tick in loop.ts). */
export interface ConverterDef {
  inputs: Partial<Record<ItemId, number>>;
  output: ItemId;
  outQty: number;
  levels: readonly { name: string; secPerBatch: number; cost: Cost }[];
}

export const CONVERTERS: Record<ConverterId, ConverterDef> = {
  smelter: { inputs: { ore: SMELTER.batchIn }, output: 'plate', outQty: SMELTER.batchOut, levels: SMELTER.levels },
  melter: MELTER,
  fab: FAB,
};

/** Order they run each tick: Plate first (the Fabricator eats it), then Coolant, then Circuits. */
export const CONVERTER_IDS: readonly ConverterId[] = ['smelter', 'melter', 'fab'];

export const isConverter = (id: string): id is ConverterId => id === 'smelter' || id === 'melter' || id === 'fab';

/** The unit list of a converter kind (mutable reference into the state). */
export function unitsOf(s: GameState, id: ConverterId): ConverterState[] {
  if (id === 'smelter') return s.smelters;
  if (id === 'melter') return s.melters;
  return s.fabs;
}

export function converterOf(s: GameState, uid: number): { id: ConverterId; index: number; unit: ConverterState } | null {
  for (const id of CONVERTER_IDS) {
    const list = unitsOf(s, id);
    const index = list.findIndex((u) => u.uid === uid);
    if (index >= 0) return { id, index, unit: list[index] };
  }
  return null;
}

/** "2 Ice" / "2 Plate + 1 Coolant". */
export const recipeText = (def: ConverterDef, name: (i: ItemId) => string): string =>
  Object.entries(def.inputs).map(([k, v]) => `${v} ${name(k as ItemId)}`).join(' + ');
