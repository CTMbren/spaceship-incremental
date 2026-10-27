# Roadmap

Goal (2 weeks): core loop, polished, playable on iPhone 12 / Chrome via GitHub Pages. See `architecture-and-2-week-build-plan.md`.

## Done
- Day 1: scaffold (Vite, TypeScript, Phaser 3, Vitest), CI + Pages workflow, hull logic (template, unlockable cells, edge rule, tile costs) with 13 tests, buy-tile action, versioned save, style A ship screen with a 1x3 hull that grows tile by tile (procedural silhouette, ghost tiles with costs, engine nozzles), HUD stub, `?debug` panel (+grant, reset).

## Next (Day 2-3: core loop)
1. Tractor Beam: tap starts a 4 s countdown, asteroid arrives, goes to the 3-slot Bay.
2. Crusher: weak-point taps (3x), heat, crush stage view, geode, Ore reward.
3. Sell Ore for credits; goal chip chain (see `economy-and-details.md` section 4).
4. Debug fast-forward. Gate: Brendan decides if the loop is fun.

## Known issues
- Build tab, Smelter and placement are visual stubs.
- Fonts load from Google Fonts; if blocked the system font is used.
- Hull occupies the upper half of the screen; the lower half is reserved for the crush stage.

## Open decisions
- Where the enlarged asteroid appears for weak-point crushing (prototype on Day 2-3).
- Bay upgrade costs (not covered by the sim).
- Title: "Last Tug: Idle Salvage" provisional.

## One-time setup for Brendan
Repo Settings -> Pages -> Source: "GitHub Actions". Live URL: https://ctmbren.github.io/spaceship-incremental/
