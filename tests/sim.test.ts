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
    expect(m.hauler!).toBeGreaterThan(6 * 60); // Patch 10.1 cheaper tiles: the Job Board opens a little sooner
    expect(m.hauler!).toBeLessThan(25 * 60);
  });
  it('Day 10: the Ice Melter and Fabricator open the back half of the hull (no dead end at 11 or 12 tiles)', () => {
    const m = runSim('engaged', 45).milestones;
    expect(m.melter!).toBeGreaterThan(12 * 60);
    expect(m.melter!).toBeLessThan(32 * 60);
    expect(m.fab!).toBeGreaterThan(m.melter!);
    expect(m.fab!).toBeLessThan(40 * 60);
    expect(m.tiles[13]).toBeDefined();
    expect(m.tiles[15]).toBeDefined();
  }, 60_000);
  it('Day 11: an engaged player reaches Veda Orbit and sends the Rover down within the hour', () => {
    const r = runSim('engaged', 60);
    expect(r.milestones.orbit!).toBeLessThan(40 * 60);
    expect(r.milestones.roverBay!).toBeLessThan(50 * 60);
    expect(r.final.rover.trips).toBeGreaterThanOrEqual(2);
  }, 60_000);
  it('Day 12: Station Halcyon and the Dry Dock arrive in the second hour, and Shards stay a milestone', () => {
    const r = runSim('engaged', 95);
    expect(r.milestones.station!).toBeGreaterThan(50 * 60);
    expect(r.milestones.station!).toBeLessThan(75 * 60);
    expect(r.milestones.drydock!).toBeLessThan(90 * 60);
    expect(r.final.ship.ownedCells.length).toBeGreaterThan(20);
    expect(r.final.stats.geodes).toBeGreaterThan(50);
  }, 120_000);
  it('the bot is deterministic', () => {
    expect(runSim('engaged', 5).final).toEqual(runSim('engaged', 5).final);
  });
});
