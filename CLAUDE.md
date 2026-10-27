# Last Tug: Idle Salvage — project conventions

Mobile-first 2D incremental spaceship game. Web build (TypeScript + Vite + Phaser 3) hosted on GitHub Pages. Owner: Brendan (first-time game developer; product owner and playtester, tests on iPhone 12 in Chrome). Claude is architect and lead developer.

## Start of every session
1. Read `docs/ROADMAP.md` (done / next / known issues / open decisions) and continue from it.
2. State the slice you are building, build it, run `npm run typecheck && npm test && npm run build`.
3. Finish with a commit, an updated ROADMAP.md, and a plain-language note for Brendan: **What to try** (3-5 steps on his phone) and **What I decided for you**.

## Architecture rules
- `src/core/` is pure TypeScript game logic. No Phaser, no DOM, no `Date.now()` or randomness without injecting it. State is plain JSON data.
- `src/data/` holds all balance numbers. No magic numbers in code.
- `src/game/` Phaser scenes (render and input only). `src/ui/` HUD and sheets. `src/sim/` headless economy bot.
- Derived values (power, adjacency, module state) are recomputed from saved state, never saved.
- Save format is versioned (`SAVE_VERSION`); add a migration for every change.
- Every design rule gets a unit test or a sim check.
- Style A "toy-hull flat vector": palette in `src/game/palette.ts`, Fredoka font, 4px dark outline, modules readable in greyscale at 38dp.

## Design docs (source of truth)
`docs/modules-and-ui-plan.md` (modules, hull growth, UI/menus), `docs/economy-and-details.md` (costs, rocks, goal chain, first-10-minutes script), `docs/architecture-and-2-week-build-plan.md` (build order). Earlier brainstorm and planning rounds live in the claude.ai Project "Spaceship Game". Where docs conflict, the newest wins.

## Commands
`npm run dev` · `npm test` · `npm run typecheck` · `npm run build` · add `?debug` to the URL for the debug panel.

## Guardrails
Small commits to `main` (CI must pass before deploy). No external services in the 2-week build. Public repo (needed for free Pages). Keep the bundle under ~2 MB.
