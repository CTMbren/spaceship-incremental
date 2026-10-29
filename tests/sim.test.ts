import { describe, expect, it } from 'vitest';
import { runSim } from '../src/sim/bot';

/**
 * Pacing guard rails on the real rules (seed 1, wide bands so small tuning does not break them).
 * `npm run sim` prints the full table.
 */
describe('economy pacing (headless bot)', () => {
  const engaged = runSim('engaged', 20);
  const casual = runSim('casual', 20);

  it('the first structure goals come early for an engaged player', () => {
    const m = engaged.milestones;
    expect(m.smelter!).toBeLessThan(120);
    expect(m.repaired!).toBeLessThan(240);
    expect(m.beam2!).toBeLessThan(360);
  });
  it('tiles 5-9 arrive over minutes, not seconds, and not hours', () => {
    expect(engaged.milestones.tiles[5]).toBeGreaterThan(30);
    expect(engaged.milestones.tiles[9]).toBeGreaterThan(5 * 60);
    expect(engaged.milestones.tiles[9]).toBeLessThan(14 * 60);
    expect(casual.milestones.tiles[9]).toBeGreaterThan(engaged.milestones.tiles[9]);
    expect(casual.milestones.tiles[9]).toBeLessThan(18 * 60);
  });
  it('a casual player with a Smasher still earns (the Smasher is worth repairing)', () => {
    expect(casual.milestones.repaired!).toBeLessThan(5 * 60);
    expect(casual.final.stats.smashed).toBeGreaterThan(20);
  });
  it('a casual player who uses the Job Board reaches Hauler in about a quarter of an hour', () => {
    const m = runSim('casual', 30).milestones;
    expect(m.hauler!).toBeGreaterThan(8 * 60);
    expect(m.hauler!).toBeLessThan(25 * 60);
  });
  it('the bot is deterministic', () => {
    expect(runSim('engaged', 5).final).toEqual(runSim('engaged', 5).final);
  });
});
