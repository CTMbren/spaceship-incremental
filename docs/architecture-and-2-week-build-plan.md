# Architecture & 2-Week Build Plan (web-first, built with Claude)

Author role: Claude as architect/lead developer. Owner: Brendan (first-time game dev; role = product owner, playtester, decision maker).

Revised Oct 27: scope set to "core loop only, polished"; grid replaced by a growing irregular hull (see `modules-and-ui-plan.md`); costs tuned (see `economy-and-details.md`, sim in `econ-sim.py`).

## Goal for the 2 weeks
A **playable web build on GitHub Pages** of the core loop, polished: Tractor Beam -> Bay -> Crusher -> Smelter -> sell, a first set of modules on a growing hull (1x3 to ~10-12 tiles reachable in play), upgrades, save/offline, tutorial hook, with simple placeholder vector art in style A. The full hour (18 tiles, Fabricator, Reactor, Jump) is the NEXT milestone, not this one. NOT in scope: cloud save, purchases, notifications, final art/audio, iOS/Android wrap. (The full MVP was estimated at ~11 weeks for a solo human; code is fast, playtesting/art/balance are the bottlenecks.)

## Stack
- TypeScript + Vite (build), Phaser 3 (rendering/input), Vitest (unit tests), Playwright (browser smoke test), GitHub Actions (CI + deploy to Pages).
- Saves: localStorage, versioned schema, export/import string. Plain JS numbers for MVP; all number formatting through one `fmt()` util.
- No backend. Offline progress = deterministic catch-up from timestamp (tiers 0-2h 30%, 2-8h 10%, cap 8h).

## Architecture rule #1: logic never touches graphics
```
src/
  core/        pure TypeScript game rules. No Phaser, no DOM.
    state.ts     GameState type + createInitialState()
    tick.ts      tick(state, dtSeconds, input?)
    actions.ts   tap beam, crush, sell, buy tile, place module, upgrade, jump
    hull.ts      template cells, unlockable cells, outline edges (procedural silhouette)
    layout.ts    evaluateLayout(): placement, power reach (BFS), Link/Feed/Boost, states
    economy.ts   cost curves, Flux, offline tiers, market saturation
    par.ts       deterministic layout EV sim (later)
    save.ts      serialize/deserialize + migrations
  data/        JSON/TS config. All balance numbers live here.
    modules.json resources.json upgrades.json asteroids.json hulls.json contracts.json
  game/        Phaser scenes: Boot, Ship (hull + Bay), CrushStage, UI overlay
  ui/          HUD, build sheet, module sheet, Sell/Keep sheet, settings, debug panel
  sim/         headless economy bot (start from econ-sim.py)
tests/         core unit tests
docs/          planning docs (copied from this project)
CLAUDE.md      conventions for future sessions
```
- `core/` is pure, so the same code runs in the browser, tests, the balance sim and a future Capacitor/Steam wrapper.
- State is plain data. Derived values (powered, adjacency) are never saved; `evaluateLayout` recomputes them.
- Build `evaluateLayout` and the sim before the Phaser ship scene.

## Build order (vertical slices; each ends deployed + playable)
| Days | Slice | Playable result | Tests / checks |
|---|---|---|---|
| 1 | Scaffold, CI, Pages deploy, CLAUDE.md, debug panel stub | Blank ship on phone at the live URL | CI green, 60fps check |
| 2-3 | Core loop: beam countdown, Bay (3 slots), Crusher with weak points + heat, sell; 1x3 hull rendered in style A | Rectangle-art loop; tap by 0:10, reward by 0:15 | Unit tests for tick/bay/crit; debug fast-forward |
| 4 | Smelter, upgrades, tile purchase with procedural outline, save/load, offline tiers, port econ-sim | Can leave and return; numbers feel right | Save migration test; sim table |
| 5-6 | Placement (tap-to-place), power reach, edge rule, Solar, second beam, Link/Feed/Boost | The layout decision exists | Layout tests; screenshot test |
| 7 | Tutorial/hook script, goal chip, Sell/Keep sheet, copy strings | Cold-start first 10 minutes without explanation | Playwright first-5-minutes smoke test |
| 8-9 | Grapple/Ice, Auto-Winch (~min 15-18), Assist/Calm, Contract Board teaser | Active vs idle identity | Balance sim vs design numbers |
| 10-12 | Feel pass: particles, haptics, sfx, art for beam/asteroids/crusher, geode | Core loop feels good | Greyscale/colorblind screenshots |
| 13-14 | Playtest with 3-5 people, fixes, README, devlog | Public playable build | Full test + build in CI |

Slips are expected. Cut order: Contract Board teaser -> Grapple/Ice -> Assist variants (keep Assist/Calm basics). Next milestone after this: Fabricator, Reactor, hull to 18, Jump, second hull.

## How Brendan works with Claude (non-developer workflow)
1. Each session starts with: "Continue from docs/ROADMAP.md." Claude reads CLAUDE.md + roadmap, states the slice, builds it, runs tests, deploys, then writes **What to try** (3-5 plain steps) and **What I decided for you**.
2. Brendan plays the live link on his phone and replies in plain words.
3. Brendan decides only at gates: after day 3 (is the loop fun?), day 6 (is the layout choice interesting?), day 12 (does it feel good?).
4. Every session ends with a commit and an updated ROADMAP.md.
5. Real playtesters (3-5 people, one non-idler) at day 6 and day 13.

## Guardrails
- Small commits, one slice per branch merge; CI must pass (typecheck, tests, build) before deploy.
- Balance numbers only in `data/`; never magic numbers in code.
- Every rule from the design docs gets a test or a sim check when implemented.
- Save format versioned from day 1.
- Debug panel always available in dev builds (fast-forward, grant, jump to minute N, force geode, toggle Calm/Assist).
- Smelter/Melter/Fabricator must never consume items reserved for the current goal.
- No external services in the 2-week build.

## Risks specific to this plan
- GitHub access from Claude's workspace must be verified before day 1 (push access was attached via the repo tool; confirm on first push).
- Public repo required for free GitHub Pages.
- Phone testing depends on Brendan checking the live URL each session.
- Art: placeholder vector shapes only; Brendan's image-gen pipeline for real art starts after the loop proves fun.
- Usage limits can slow a heavy day.
- Economy sim is coarse (one Crusher); expect a real balance pass on Day 4.

## Decisions status
1. Repo: CTMbren/spaceship-incremental, public. Done.
2. Stack: Phaser + TypeScript. Assumed, unchallenged.
3. 2-week target: core loop only, polished. Done.
4. Art style A with growing irregular hull. Done.
5. Hull growth: template + free order. Proposed, awaiting Brendan's OK.
