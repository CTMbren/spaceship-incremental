# Roadmap

Goal (2 weeks): core loop, polished, playable on iPhone 12 / Chrome via GitHub Pages. See `architecture-and-2-week-build-plan.md`.

## Done
- Day 1: scaffold (Vite, TypeScript, Phaser 3, Vitest), CI + Pages workflow, hull logic (template, unlockable cells, edge rule, tile costs) with 13 tests, buy-tile action, versioned save, style A ship screen with a 1x3 hull that grows tile by tile (procedural silhouette, ghost tiles with costs, engine nozzles), HUD stub, `?debug` panel (+grant, reset).
- Day 1 fix: canvas now renders at device pixel ratio (capped at 3), so text and shapes are sharp on retina phones.
- Day 2-3: core loop playable. Tap the beam (or Fire) -> 4 s countdown ring -> asteroid enters the 3-slot Bay -> crusher auto-loads it -> tap the rock (hit the glowing weak point for a 3x crit), heat meter with overheat lockout, geodes (8%) with jackpot and Core Shard pity, Ore, Sell button, goal chip (Tap the beam / Crush the rock / Sell your Ore / Expand hull), Foreman bubble, hit chips and floating text. Pure logic in `src/core/loop.ts` (seeded RNG, 30 tests), save v2 with a v1 migration. Debug (`?debug`): +grant, +60s, geodes ON, reset.
- Day 4 (playtest 1 changes): rocks take ~1.75x longer (dust rock 14 HP / 4 Ore). **Hold to crush**: hold a finger on the rock (0.18 s delay) for 4 auto-hits/s at +4 heat each; tapping is +3 heat; weak-point hit (tap, second finger, or dragging the held finger over it) is 3x damage and -6 heat; overheat at 100 jams for 2 s (frost ring), then resets to 40. Radial heat arc around the rock. **Rock Smasher** replaces the Crusher tile: starts Rusty, repair it, then **Send** a rock (geodes stay in hand) to its queue; it smashes at 0.9 HP/s (L1, queue 2), progress ring + queue pips on the tile, tap the tile for the repair/upgrade sheet (4 levels, auto-intake from L2). Sell keeps back the Ore needed for the next goal (after the first sell). Save v3 with v1/v2 migrations. 52 tests. `?debug` scene hook `debugAdvance(sec)` for scripted runs.

## Next (Day 5: second beam, Smelter, Hand Tools)
1. Second Tractor Beam (60 credits + 10 Ore) and beam upgrades; auto-intake retune with two beams.
2. Smelter module (25 Ore) Ore -> Plate; switch Smasher repair cost from the interim 24 Ore to 8 Plate.
3. Hand Tools upgrade sheet (hold speed, heat cap) with costs from `economy-and-details.md`.
4. Port `src/sim/econ_sim.py` to TypeScript; check the first 30 minutes against the real rules (casual ~70 min, semi-idle <=85 min target with the Smasher).
5. Day 6: offline catch-up tiers (0-2 h 30%, 2-8 h 10%, cap 8 h) + welcome-back, upgrade UI polish, playtest build.

## Known issues
- Build tab, Smelter and placement are visual stubs; the Open tile is a placeholder. The Smasher sits at a fixed cell (2,1), adjacency for auto-intake is assumed.
- Interim: Smasher repair costs 24 Ore (design is 8 Plate once the Smelter exists). Saves with 10+ rocks migrate as already repaired; use `?debug` [reset] to see the Rusty start.
- A finger held on the centre of the rock often lands the weak-point crit (-6 heat), so heat rarely jams; watch in playtest.
- Frame time is capped at 0.25 s, so on a very slow device the game runs slower than real time (offline catch-up comes Day 6).
- No sound or haptics yet (iOS Chrome does not support vibration).
- Fonts load from Google Fonts; if blocked the system font is used.
- Layout: hull in the upper half, crush stage panel, Heat + Bay strip, Fire and Sell buttons, tab bar (Build tab is a stub).

## Open decisions
- Decided on Day 2-3: the rock appears in a stage panel under the ship (below the hull, above the Fire button).
- Bay upgrade costs (not covered by the sim).
- Title: "Last Tug: Idle Salvage" provisional.

## One-time setup for Brendan
Repo Settings -> Pages -> Source: "GitHub Actions". Live URL: https://ctmbren.github.io/spaceship-incremental/
