# Roadmap

Goal (2 weeks): core loop, polished, playable on iPhone 12 / Chrome via GitHub Pages. See `architecture-and-2-week-build-plan.md`.

## Done
- Day 1: scaffold (Vite, TypeScript, Phaser 3, Vitest), CI + Pages workflow, hull logic (template, unlockable cells, edge rule, tile costs) with 13 tests, buy-tile action, versioned save, style A ship screen with a 1x3 hull that grows tile by tile (procedural silhouette, ghost tiles with costs, engine nozzles), HUD stub, `?debug` panel (+grant, reset).
- Day 1 fix: canvas now renders at device pixel ratio (capped at 3), so text and shapes are sharp on retina phones.
- Day 2-3: core loop playable. Tap the beam (or Fire) -> 4 s countdown ring -> asteroid enters the 3-slot Bay -> crusher auto-loads it -> tap the rock (hit the glowing weak point for a 3x crit), heat meter with overheat lockout, geodes (8%) with jackpot and Core Shard pity, Ore, Sell button, goal chip (Tap the beam / Crush the rock / Sell your Ore / Expand hull), Foreman bubble, hit chips and floating text. Pure logic in `src/core/loop.ts` (seeded RNG, 30 tests), save v2 with a v1 migration. Debug (`?debug`): +grant, +60s, geodes ON, reset.
- Day 4 (playtest 1 changes): rocks take ~1.75x longer (dust rock 14 HP / 4 Ore). **Hold to crush**: hold a finger on the rock (0.18 s delay) for 4 auto-hits/s at +4 heat each; tapping is +3 heat; weak-point hit (tap, second finger, or dragging the held finger over it) is 3x damage and -6 heat; overheat at 100 jams for 2 s (frost ring), then resets to 40. Radial heat arc around the rock. **Rock Smasher** replaces the Crusher tile: starts Rusty, repair it, then **Send** a rock (geodes stay in hand) to its queue; it smashes at 0.9 HP/s (L1, queue 2), progress ring + queue pips on the tile, tap the tile for the repair/upgrade sheet (4 levels, auto-intake from L2). Sell keeps back the Ore needed for the next goal (after the first sell). Save v3 with v1/v2 migrations. 52 tests. `?debug` scene hook `debugAdvance(sec)` for scripted runs.
- Patch 4.1 (playtest 2 tuning, no new features): hold rate 4 -> 8 taps/s (1 dmg, heat +4 per tick, so a pure hold jams in ~3 s unless you hit weak points); dust rock HP 14 -> 35 (x2.5) so tapping and holding take longer; Smasher HP/s scaled x2.5 (2.25 / 2.875 / 3.75 / 4.75) so it still needs ~15.6 s per rock at L1; beam countdown 4 s -> 1 s; the beam (Fire button and tile) is locked while a rock is in the crush stage ("Rock in stage"). 55 tests.

- Day 5 (modules, Smelter, Workshop, pacing bot; save v4): modules are now real data (`ship.modules`, each on one tile). Tap an **Open** tile to get the Build sheet: **Smelter** (25 Ore, one per ship, 3 Ore -> 1 Plate, 4 levels, ON/OFF) or a **Tractor Beam** (2nd: 60 credits + 10 Ore, 3rd: 140 credits + 6 Plate; must sit on an outside tile, so the hull must grow first). **Fire** starts every idle beam at once; each beam tile also fires itself, with its own countdown ring and level dots. Beam levels make rocks richer (+25% Ore each: 4/5/6/7 Ore). The **Build tab opens the Workshop**: Hand Tools (Hardened Teeth +25% damage, Heat Baffles heat cap 120 / cools faster / shorter jam, Jackpot Drum +25% jackpots), beam, Smelter and Smasher upgrades, and the Smasher repair. Smasher repair now costs **8 Plate**. Goal chain: tap beam, crush, sell, Smelter, repair, send, second beam (or expand the hull first). Sell now sells everything sellable (Ore, Plate...) except what the current goal needs and the Ore the Smelter needs to make that goal's Plate; Core Shards are never sold. Plate pill appears with the first Plate. **Economy bot** in `src/sim/` plays the real core rules (engaged / casual / idle-in-bursts); `npm run sim [minutes]` prints a pacing table and `tests/sim.test.ts` guards the bands. Pacing change from the sim: geode jackpot 19x -> 6x Ore (early game was 3-4x too fast). Save v4 with a v3 migration. 92 tests.

Bot pacing after the retune (m:ss reached; casual re-taps every 2.5 s and uses the Smasher, idle plays 20 s every 2 min):

| policy | Smelter | repair | beam 2 | tile 5 | tile 7 | tile 9 |
|---|---|---|---|---|---|---|
| engaged | 0:39 | 1:36 | 2:45 | 1:12 | 5:12 | 9:12 |
| casual | 1:21 | 2:42 | 3:12 | 3:32 | 6:14 | 11:57 |
| idle | 4:00 | 8:00 | 10:00 | 10:10 | 18:00 | after 20:00 |

- Visual update (ship view): the ship is drawn at 1.5x, runs left to right with the nose on the left (presentation only; hull data and saves unchanged, template (x, y) maps to screen column = y, row = x). When the ship plus buy slots no longer fit, small arrows appear on the edges (hold to scroll; buying a tile scrolls it into view); the view is clipped to its own area. New exterior in `src/game/hullArt.ts`: seam-free hull body, nose cone with canopy, engine bells on exposed rear cells, swept fins on the finished hull's top and bottom edges, orange accent stripe, rim light and rivets, all derived from owned tiles. Layout maths in `src/game/shipLayout.ts` (pure, 11 tests). 63 tests.

- Day 6 (offline catch-up, welcome-back, Workshop polish; save v5): `src/core/offline.ts` fast-forwards the real rules while you are away: the ship works at **30% for the first 2 hours, 10% up to 8 hours, nothing after** (`src/data/offline.ts`). Hands-free play means beams fire, rocks go to the Smasher, the Smelter runs, no geodes arrive, nothing is sold, and a Rusty Smasher means only held Ore gets smelted. Away under 2 minutes counts for nothing. The game stamps `savedAt` on every save and catches up on launch and when the tab wakes (iOS freezes background pages); a **Welcome back** sheet reports time away, rocks cleared and items gained, and says why when there is nothing (Rusty Smasher, geode waiting, nothing to do). Sheets now **scroll** (drag or wheel) with a scroll bar, a gold **dot on the Build tab** shows when any Workshop purchase is affordable, and beam rows read "Beam 2 · Winch Line". Debug: `window.__ship.debugAway(sec)`. Save v5 (old saves earn no offline time once). 104 tests.

## Next
0. **Patch 6.1 (planned, Day 7 build then playtest; see `docs/playtest-3-notes-and-review.md`)**: Fire/beam taps allowed until the Bay is full (room rule) with clear Bay feedback (the 4.1 lock was a reaction to missing feedback), rename Send to Smash (with queue count), a **Cargo sheet** for selling (per-item rows, Hold-for-goal switch, one big Sell button; Sell stays one tap until a second item exists), a menu (gear next to the goal chip: version injected at build, help cards, Copy/Paste save, reset with hold-to-confirm), re-run the bot, save v6 (one flag). Then the playtest. After that, a feature slice: multiple Smashers and Smelters (caps of 3, x3 price curve from copy 2, Move/Sell with 75% refund, save v7) and Auto-sell with keep floors.
1. Day 7 (playtest gate): core loop, layout and module placement on Brendan's phone. Optional UI planning session (structure only) before it. Then decide whether to start Milestone 2 (Days 8-12).
2. Tile 10+ needs Ice (not in the game yet), so the bot and the hull stop at 9 tiles until Ice arrives with the Grapple Beam / Day 8+ work.

## Planned: Milestone 2 (planning only, see `docs/travel-shop-rover-jump-plan.md`)
Travel along a system route (Engine, nodes, offline travel), Rover expeditions at planets, three shops (Workshop, Station Trader, Flux Exchange), Jump as shockwave damage with Braces instead of a reset, more modules. Proposed order: Days 8 to 12 after the Day 7 core-loop and layout playtest gate. Open decisions for Brendan are in section 9 of that doc.

## Known issues
- Ship art is still code-drawn placeholder styling; the Tug template's nose is one tile off-centre (rows 1-2 of 5), so the silhouette is slightly lopsided. Module tiles are still labelled squares.
- The pacing bot is a simple policy on one seed; its numbers are guard rails, not truth. Real players tap slower, so expect the first hour to run slower than the engaged row.
- Smasher auto-intake (L2) only works with 2+ beams (one beam is locked while a rock is in the stage). The second beam is part of the early goal chain.
- Modules cannot be moved or sold yet (Day 7+); a wrongly placed module stays. Module art is still labelled squares. Adjacency for Smasher auto-intake is assumed, not checked.
- Saves with 10+ rocks migrate (v1/v2) as already repaired; use `?debug` [reset] to see the Rusty start. The very first Sell sells everything (tutorial); later sells keep goal materials.
- A finger held on the centre of the rock often lands the weak-point crit (-6 heat), so heat rarely jams; watch in playtest.
- Frame time is capped at 0.25 s, so on a very slow device the game runs slower than real time while the app is open.
- Offline: with nothing reserved, the Smelter turns all held Ore into Plate while you are away, so you come back with Plate. Offline income needs a repaired Smasher and at least one idle beam fired by hand at least once. If the offline numbers feel too generous or too stingy, the knobs are `src/data/offline.ts` (rates, cap, 2 min minimum).
- No sound or haptics yet (iOS Chrome does not support vibration).
- Fonts load from Google Fonts; if blocked the system font is used.
- Layout: hull in the upper half, crush stage panel, Heat + Bay strip, Fire and Sell buttons, tab bar (Build tab opens the Workshop).

## Open decisions
- Playtest 3 decisions (Oct 27) are recorded in `docs/playtest-3-notes-and-review.md` section 10. Open: the Cargo sheet design (options A to E in section 6; recommended E).
- Milestone 2 decided Oct 27: hull persists, materials persist, spatial shockwave with Braces, travel and Rover run offline, Rover sites are renewable (limited by a pity rule, not stock). Still open: whether to commit to Days 8-12, decided after the latest playtest. See section 9 of the travel/rover/Jump plan.
- Decided on Day 2-3: the rock appears in a stage panel under the ship (below the hull, above the Fire button).
- Bay upgrade costs (not covered by the sim).
- Title: "Last Tug: Idle Salvage" provisional.

## One-time setup for Brendan
Repo Settings -> Pages -> Source: "GitHub Actions". Live URL: https://ctmbren.github.io/spaceship-incremental/
