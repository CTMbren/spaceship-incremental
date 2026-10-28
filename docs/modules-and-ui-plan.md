# Modules, Hull Growth & UI Plan (Round 4, manager-reconciled)

Status: LOCKED for MVP unless noted. Supersedes the grid assumptions (fixed 5x5 -> 9x9) in earlier docs. Style A "toy-hull flat vector" with a visible, growing hull is confirmed by Brendan.

Inputs: three designers (module catalog, UI/menus, slot/economy mechanics). Where they disagreed, the manager decision is listed under "Reconciled conflicts".

## 1. Hull growth: template + free order
- Each hull ships a fixed silhouette template (hull 1 ≤ 20 cells, hull 2 ≤ 28). The player starts with 3 cells (1x3) and buys any template cell that touches an owned cell, in any order.
- Outline is drawn procedurally from the owned set (union of rounded tiles, fins and nozzles derived from the shape). No 9-slice hull kit needed.
- Free-form growth stays possible later: template = full bounding box, no schema change.
- Authoring rule: template linter checks that at ~18 tiles about 11 cells are edge cells and 7 interior.
- Tile cost (credits; materials), tuned by sim (see economy doc): 4: 60 + 4 Ore · 5: 75 + 6 Ore · 6: 90 + 8 Ore · 7: 110 + 6 Ore 2 Plate · 8: 135 + 8 Ore 3 Plate · 9: 170 + 10 Ore 4 Plate · 10: 210 + 6 Plate 3 Ice · 11: 255 + 8 Plate 4 Ice · 12: 315 + 10 Plate 5 Coolant · 13: 385 + 12 Plate 2 Circuit · 14: 475 + 14 Plate 3 Circuit · 15: 585 + 16 Plate 4 Circuit · 16: 720 + 5 Circuit · 17: 885 + 6 Circuit · 18: 1,090 + 8 Circuit 1 Core Shard. Credit curve = round5(60 x 1.23^(n-4)); total about 5,610 credits. Hull 2 tiles continue at x1.18 from a higher base (re-tune with the sim).
- Max 4 ghost tiles visible at once.

## 2. Slot rules
- Any module can sit on any owned tile unless flagged: `edge` (needs a side facing empty space) or `rear`.
- Bay (3 slots) and base power (3) belong to the hull, not a tile, so the 1x3 start is Beam / Crusher / empty.
- Power: BFS path distance through owned tiles. A source powers modules within its `reach` while output ≥ summed draw (nearest first). Unpowered = 0% with the bolt-slash badge, never partial.
- Boost (+15%, speed only, one per module) comes from a power module (Solar/Reactor) touching the module. There is NO separate Booster module.
- Healthy ratio: production tiles / total tiles ≈ 0.62. Edge cells are the scarce resource (beams and Solar both want them).
- Placement UX in MVP: tap a module card, tap a highlighted valid cell, rotate button. No drag (drag is post-MVP).

## 3. Module catalog
Footprints reconciled with the mockup: Crusher and Smelter are 1x1 in hull 1.

| Module | Foot | Place | Power | Unlock (min) | Cost | Does |
|---|---|---|---|---|---|---|
| Tractor Beam | 1x1 | edge | -1 | 0 | free | 4s countdown, small Ore rocks. Levels: Hook, Winch Line, Twin Strand, Gravity Lace |
| Rock Smasher (Day 7: max 3, copies 500 cr + 8 Plate, 1,200 cr + 20 Plate; Smash feeds the one with most room) / Rock Crusher | 1x1 | any | -1 | 0 | free | Tap, weak-point crits, heat, geodes. Levels: Jaws, Hardened Teeth, Heat Baffles, Jackpot Drum. Scanner effect arrives as its L2 (+30% weak-point window) |
| Smelter | 1x1 | any | -1 | 3 | 25 Ore (copy 2: 120 cr + 4 Plate, copy 3: 360 cr + 10 Plate) | Ore -> Plate (3:1). Max 3 per ship (Day 7), shared Ore stock, own upgrades, Move free, Sell 75%. Levels: Furnace, Draft Flue, Slag Recycler, Blast Chamber |
| Solar Wing | 1x1 | edge | +2, reach 2 | 6 | 6 Plate | Power and Boost source |
| Grapple Beam | 1x2 | edge | -1 | 9 | 10 Plate 8 Ore | 12s countdown, 2x rocks, can carry Ice |
| Ice Melter | 1x1 | any | -1 | 20 | 12 Plate 6 Ice | Ice -> Coolant (2:1) |
| Fabricator | 2x2 | any | -2 | 25 | 20 Plate 4 Coolant | 2 Plate + 1 Coolant -> Circuit; takes input only from Feed |
| Auto-Winch | 1x1 | any | -1 | ~15-18 (offered after tile 9) | 14 Plate | Restarts adjacent beams on arrival. Circuit-free so it can unlock at min 18 |
| Reactor | 2x2 | any | +8, reach 3 | 36 | 16 Plate 8 Circuit 4 Coolant | Big power and Boost source |
| Jump Drive | 2x2 | rear | -3 | visible ~44 | 30 Plate 10 Circuit 2 Shard | Triggers the Jump. Demolish refunds 100% |

Bay size is a credit upgrade on the hull core (3 -> 6), not a module. That is 10 MVP modules; the full set needs more tiles than hull 1 has, so players leave something out or demolish. If playtests find that punishing, raise hull 1 from 18 to 20.

Post-MVP: Pulse Crusher (passive, no crits), Laser Cutter, Deep Tether (30s beam, shard chance), Cargo Hold, Salvage Drone Bay, Geode Sonar, Trade Terminal, Coolant Radiator (with the Reactor-heat rule), Capacitor, Livery Plate, and the Jump 2+ wow modules: Gravity Well (whole Link cluster fires on one tap), Matter Loom (any item to any item, 3:1, 60s cap), Singularity Press (all 3 Bay slots become one 4x super-rock).

Design pillar: every module owns one verb (get, break, convert, repeat, power, prestige). A new module must add a verb or a trade-off, not a bigger number. Guard rails: beam countdown floor 2s, Link capped at 3 stacks, level names carry a trade-off every second level.

## 4. Pacing targets (first hour; tune with the headless sim)
Minute 0 beam+crusher, 3 Smelter, 6 Solar, 9 Grapple/Ice, 18 Auto-Winch (first automation), 20 Melter, 25 Fabricator + Contract Board visible, 36 Reactor, ~44 Jump Drive visible, 50-60 hull full and Jump available. Sim result (active player): tiles 4/5/9/12/15/18 at minutes 1.6/4.5/12/24/37/60; Jump Drive built at ~60. A semi-idle player (slow re-tap, no crits) reaches it at ~93. Replaces the earlier income targets, which the sim showed were unreachable with one Crusher.
Core Shards: the pity counter (guaranteed by the 12th crit-rock, persists across Jump) must give P90 time-to-3-shards under ~38 min. Shard demand is 3 total: tile 18 (1) and Jump Drive (2).

## 5. Screens and menus
One sheet at a time; sheets never stack; only a confirm modal can sit on top of a sheet.

| Surface | Type | Appears |
|---|---|---|
| Ship (home) | screen | start |
| Settings (gear) | sheet | start |
| Foreman bubble | overlay | start, skippable |
| Build (modules + hull) | tab/sheet | ~min 2 |
| Module detail (upgrade, adjacency, move, sell) | half sheet | first module |
| Stock (materials) | tab | ~min 10 |
| Contracts | tab | min 25 |
| Jump (+ Flux shop) | tab | first Jump available (~min 44) |
| Sell/Keep | half sheet | first smelted batch (waits for crusher idle; "Always sell" setting) |
| Welcome-back | modal | return after 2+ min |

There is no global Upgrades tab: upgrades live in the Module detail sheet, with an "upgrade ready" dot on the module. Tabs: Ship · Build · Stock · Contracts · Jump (max 5, never reorder; new tab arrives with a dot and a <8-word tip).

Ship screen zones (390x844): HUD (credits, up to 4 pills, gear) · goal chip · ship stage (auto-fit, pinch zoom 0.6-1.6x) · status strip (heat + Bay) · action zone (Fire ring fires all ready beams; beams and crusher also tappable in place) · tab bar 80dp. Open prototype question for Day 2-3: where the enlarged asteroid appears for weak-point crushing (overlay above the hull in the stage).

HUD reveal: min 0 credits + gear + goal chip · 2 heat · 4 Ore · 6 Plate · 10 power · 15 geode counter (after first geode) · 25 contract dot on the tab · Flux only after the first Jump.

Interactions: tap module opens detail; Move/Sell are buttons in the sheet (long-press is only a shortcut); undo toast 5s for place, move, buy-tile; sell asks to confirm; Jump uses hold-to-confirm 1.5s with keep/lose lists shown first. Max one toast at a time. No pushes in MVP except opt-in "Bay full" (local).

Feedback table: beam start (light tick, hum, sparks) · arrival (medium, thunk, dust ring) · crush (light, crunch, chips) · crit (heavy, ping, gold burst) · geode (success pattern, chime run, confetti) · overheat (buzz, hiss, steam) · smelt done (soft, ding) · sell (light, coin, coins to HUD) · buy/upgrade (medium, click-up, ring) · tile bought (medium, snap, edge flash) · Jump (rumble, whoosh, streak). Calm mode swaps flashes/shakes for fades.

Accessibility: 44dp hit area for 38dp modules (nearest center wins on overlap), state never color-only, Assist and Calm as locked, text S/M/L (14/16/19), screen-reader labels "Crusher, level 3, ready", every gesture has a tap alternative.

## 6. Reconciled conflicts
- Auto-Winch at min 30 (D1) vs locked first automation at min 18 -> min 18, Circuit-free cost.
- Separate "Booster" module (D3) vs locked Boost glyph -> no Booster; Boost comes from touching power modules.
- Ship-wide power budget (D1) vs power reach (D3, matches locked rule) -> reach.
- Shard pity "every 12th geode" (D3) vs locked "12th crit-rock" -> locked rule; shard demand cut to 3 total.
- Offline "4h at 50%" (D2) vs locked tiers -> locked: 0-2h 30%, 2-8h 10%, cap 8h. Welcome-back copy follows that.
- D2 sample items (Iron Bars, Cu) -> replaced by the 6 locked items.
- Drag placement (D2) vs tap-to-place (D3) -> tap-to-place in MVP.
- Reactor heat penalty on neighbouring crushers (D1) -> deferred with the Radiator.
- Core tile holding Bay (D3) vs 1x3 start mockup -> Bay and base power are hull-intrinsic.
- Crusher/Smelter 1x2 (D1, D3) vs mockup 1x1 -> 1x1.

## 7. Data schemas (src/data and src/core)
`HullDef { id, name, template: {x,y,rear?}[], startCells, maxTiles, tileCosts: Cost[] }` · `ModuleDef { id, footprint: Cell[], placement: 'any'|'edge'|'rear', powerDraw, powerSupply?: {output, reach}, buildCost, upgrades: {cost, effects}[] }` · `ShipState { hullId, ownedCells: string[], modules: ModuleInstance[] }` where `ModuleInstance { uid, defId, origin, rotation, tier }`. Derived values (powered, adjacency) are never saved; a pure `evaluateLayout(def, state)` recomputes them.

## 8. First tests and sim checks
1 unlockable cells only from template and adjacent · 2 placement validator (overlap, off-hull, edge, rear, rotation) · 3 power BFS around concavities · 4 overdraw is deterministic · 5 adjacency stacking and caps · 6 cost curve monotonic, total 7,080 · 7 headless economy sim: tile 18 reached minute 52-68, income 450-750/min at minute 60 · 8 shard pity P10/P90 times. Build `evaluateLayout` and the sim before any Phaser scene.

## 9. Risks
Placement UX on phones (tap-to-place, 56px cells) · template authoring cost (linter, 2 hulls only) · rule overload (one new rule per ~10 minutes, "why is this unpowered" tooltip) · income outruns cost curve (all multipliers in JSON, sim in CI) · tile pressure punishing (raise hull 1 to 20) · hit crowding (auto-fit zoom, Focus chips past 12 tiles) · mockup labels (ghost costs of 20/40/60) are placeholders and must be updated to this curve.
