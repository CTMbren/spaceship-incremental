# Roadmap

Goal (2 weeks): core loop, polished, playable on iPhone 12 / Chrome via GitHub Pages. See `architecture-and-2-week-build-plan.md`.

## Done
- Day 1: scaffold (Vite, TypeScript, Phaser 3, Vitest), CI + Pages workflow, hull logic (template, unlockable cells, edge rule, tile costs) with 13 tests, buy-tile action, versioned save, style A ship screen with a 1x3 hull that grows tile by tile (procedural silhouette, ghost tiles with costs, engine nozzles), HUD stub, `?debug` panel (+grant, reset).
- Day 1 fix: canvas now renders at device pixel ratio (capped at 3), so text and shapes are sharp on retina phones.
- Day 2-3: core loop playable. Tap the beam (or Fire) -> 4 s countdown ring -> asteroid enters the 3-slot Bay -> crusher auto-loads it -> tap the rock (hit the glowing weak point for a 3x crit), heat meter with overheat lockout, geodes (8%) with jackpot and Core Shard pity, Ore, Sell button, goal chip (Tap the beam / Crush the rock / Sell your Ore / Expand hull), Foreman bubble, hit chips and floating text. Pure logic in `src/core/loop.ts` (seeded RNG, 30 tests), save v2 with a v1 migration. Debug (`?debug`): +grant, +60s, geodes ON, reset.

## Next (Day 4: Smelter, upgrades, save/offline)
1. Smelter module (25 Ore) on the open tile: Ore -> Plate, auto-timed; Sell/Keep choice for Plate.
2. Upgrade sheet per module (Tractor Beam, Crusher, Smelter) with the costs in `economy-and-details.md`.
3. Offline catch-up tiers (0-2 h 30%, 2-8 h 10%, cap 8 h) and the welcome-back modal; replace the 0.25 s frame cap.
4. Port `src/sim/econ_sim.py` to TypeScript and check the first 30 minutes against the real rules.
5. Gate (end of Day 3): Brendan decides if the loop is fun.

## Known issues
- Build tab, Smelter and placement are visual stubs; the Crusher tile and Open tile are placeholders.
- Frame time is capped at 0.25 s, so on a very slow device the game runs slower than real time (offline catch-up comes Day 4).
- No sound or haptics yet (iOS Chrome does not support vibration).
- Fonts load from Google Fonts; if blocked the system font is used.
- Layout: hull in the upper half, crush stage panel, Heat + Bay strip, Fire and Sell buttons, tab bar (Build tab is a stub).

## Open decisions
- Decided on Day 2-3: the rock appears in a stage panel under the ship (below the hull, above the Fire button).
- Bay upgrade costs (not covered by the sim).
- Title: "Last Tug: Idle Salvage" provisional.

## One-time setup for Brendan
Repo Settings -> Pages -> Source: "GitHub Actions". Live URL: https://ctmbren.github.io/spaceship-incremental/
