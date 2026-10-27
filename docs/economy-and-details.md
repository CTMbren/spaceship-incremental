# Economy Sim Results & Detail Spec (Round 5)

A headless bot sim (`claude/econ-sim.py` in this Project, to become `src/sim` in the repo) played the first hour using the module list and costs from `modules-and-ui-plan.md`. It is a coarse model (one Crusher, one smelter, greedy bot), so use it to compare curves, not to predict real play. The first real balance pass happens in Day 4 with the actual game.

## 1. What the sim found
| Test | Result | Change made |
|---|---|---|
| Round-4 costs, ore 1 / plate 5 credits | Stuck at 10 tiles after 60 min; income 30-65 credits/min | Round-4 income targets (600/min) were unreachable: one Crusher caps throughput. Dropped them |
| Higher refined prices (plate 8, coolant 16, circuit 60), Crusher levels +50% each, geode bonus | Reached tile 14 by min 60 | Kept as the new price table |
| Bot bugs (ate reserved ore/ice/coolant) | Looked like design stalls | Fixed in the sim. Real game needs the same protection: **the smelter, melter and fabricator must never consume items reserved for the current goal** (or show a "reserved" lock) |
| Shard pity counting every crit-rock | 27-49 shards by min 60 | Pity counter counts **geodes**, not crit-rocks. Need 3 shards in the hour (tile 18 + Jump Drive) |
| Tile curve sweep (base 50-70, growth x1.20-1.28) | Jump-ready at 55-76 min active | Chose base 60, growth x1.23: **active ~60 min, semi-idle ~93 min** |
| Circuit cost on tiles 16-18 | Tail tiles 7-9 min apart | Lowered to 5/6/8 Circuit; tail still ~7 min per tile, which is intended as the "final stretch" |

Known sim limits: one Crusher only; no Link/Feed bonuses; no Assist/Calm; no market saturation; no contracts; geode payout is a flat average. Each of these needs a sim pass once the real rules exist.

## 2. Final prices and costs
Sell prices (credits): Ore 1 · Ice 3 · Plate 8 · Coolant 16 · Circuit 60 · Core Shard 150 (rarely sold). Refining roughly doubles value per raw item, so Keep vs Sell is a real choice.

Tiles 4-18: see `modules-and-ui-plan.md` (60 x 1.23^(n-4) credits, total ~5,610).

Module build costs (materials only, per the "credits buy speed, materials buy structure" rule; the Smelter's 25 Ore matches the mockup goal chip): Smelter 25 Ore · Solar 6 Plate · Grapple 10 Plate 8 Ore · Auto-Winch 14 Plate · Ice Melter 12 Plate 6 Ice · Fabricator 20 Plate 4 Coolant · Reactor 16 Plate 8 Circuit 4 Coolant · Jump Drive 30 Plate 10 Circuit 2 Core Shard.
Extra beams: 2nd Tractor Beam 60 credits + 10 Ore · 3rd 140 credits + 6 Plate (a 4th beam is post-MVP).

Upgrade costs in credits, formula base x 1, x3, x9 for levels 2, 3, 4:

| Module | Base | L2 | L3 | L4 | Effect per level (tuned values) |
|---|---|---|---|---|---|
| Tractor Beam | 25 | 25 | 75 | 225 | -15% countdown, +15% rock size |
| Rock Crusher | 35 | 35 | 105 | 315 | +50% crush rate |
| Smelter | 40 | 40 | 120 | 360 | +25% throughput |
| Solar Wing | 30 | 30 | 90 | - | +0.5 power, reach +1 at L3 |
| Grapple Beam | 80 | 80 | 240 | 720 | -15% countdown |
| Auto-Winch | 120 | 120 | 360 | - | faster restart, then chain reach |
| Ice Melter | 100 | 100 | 300 | - | +1 batch |
| Fabricator | 150 | 150 | 450 | 1,350 | -time, then +1 Circuit per 5 |
| Reactor | 300 | 300 | 900 | 2,700 | +2 power, +reach |
| Bay (hull core) | - | 150 (4 slots) | 450 (5) | 1,350 (6) | **untested in sim**, adjust in Day 4 |

Design check: by minute 30 the sim player owns tractor L3, crusher L3, smelter L3 and ~13 tiles; by 60 everything is L3-L4. No upgrade is worth skipping, which is acceptable for MVP but means upgrade choice is "order", not "which". Post-MVP trade-off levels (see catalog) add real choice.

## 3. Asteroids and crushing (numbers for the first build)
| Rock | Source | Yield | HP (taps) | Notes |
|---|---|---|---|---|
| Dust Rock | Tractor Beam | 3 Ore | 8 | 4s countdown beam, ~10 s per full cycle at the start |
| Heavy Rock | Grapple Beam | 9 Ore + 2 Ice | 24 | 12 s countdown; Ice is why the Grapple exists |
| Geode | any rock, ~8% | normal yield + jackpot | rock HP x1.5 | Jackpot ≈ 25x the rock's Ore value, 3-slot reveal; the geode counter feeds shard pity |

- Weak point: appears every 1.2 s for 0.8 s on the rock; hit = 3x damage and a gold burst. Assist: 72/84 dp target, slower drift, every 3rd/5th/8th tap auto-crits, hold-to-crush.
- Heat: +5 per tap, -15 per second idle, overheats at 100 and blocks the Crusher for 2 s (sustained >3 taps/s). Heat Baffles +20% cap. Weak-point hits remove 8 heat so good play never overheats.
- Crusher throughput is the real bottleneck in the sim (about 36-40 Ore per minute at L1, about 2.5x at L4). More beams only help until the Crusher saturates, so "upgrade the Crusher" and "add the Smelter's Feed bonus" are the early speed levers. If playtests feel capped, add a second Crusher slot earlier instead of lowering costs.
- Pity: the hidden counter counts geodes; every 12th geode is guaranteed to contain a Core Shard, base chance 4%. Persists across Jump.

## 4. Goal chain (the chip under the HUD)
| # | Goal chip | Reward | Target min |
|---|---|---|---|
| 1 | Tap the beam | first rock | 0:10 |
| 2 | Crush the rock | Ore, first sell | 0:30 |
| 3 | Next: Place a Smelter · 25 Ore | Smelter slot | 1.5 |
| 4 | Expand hull · 60 credits | tile 4, ghost glows | 1.6 |
| 5 | Upgrade the beam | -15% countdown | 3 |
| 6 | Add a Solar Wing · 6 Plate | power, Boost diamond | 5.5 |
| 7 | Add a second beam | Link chevron lesson | 7 |
| 8 | Build the Grapple · 10 Plate | Ice appears | 8.7 |
| 9 | Place an Auto-Winch · 14 Plate | first automation | 12-15 |
| 10 | Build an Ice Melter | Coolant | 15 |
| 11 | Build a Fabricator | Circuit, Contract Board teaser | 24 |
| 12 | Build a Reactor | big power | 34 |
| 13 | Fill the hull (18 tiles) | Jump Drive visible | 45-60 |
| 14 | Build the Jump Drive | Jump | ~60 |

One goal at a time, always a visible reward within 3 minutes, tapping the chip expands the next 3.

## 5. First 10 minutes script (cold start)
0:00 empty 1x3 ship, Foreman "Tap the beam." · 0:04 countdown ring · 0:09 rock arrives (target: player taps by 0:10, reward by 0:15) · 0:15 "Crush it." weak point glows · 0:30 first sell and 120 credits · 1:30 Smelter ghost glows · 3:00 tile 4 placed, a second ghost tile appears · 4:30 tile 5 · 6:00 Foreman shows the Solar Wing and the Boost diamond · 8:00 scripted first geode (guaranteed jackpot) · 8:40 Grapple unlocked. After minute 10 the Foreman only speaks on new mechanics (Link at 7, Power at 5.5, Feed at 15, automation at 15).

## 6. Offline and idle
Drift Mode ~60% income; offline tiers locked at 0-2h 30%, 2-8h 10%, cap 8h. Sim idle profile (re-tap every 8 s, crusher at 65%, half the geodes) finishes the hour-one content in ~93 minutes, which matches the idea that idle players take about 1.5x longer. Welcome-back copy uses the locked tiers.

## 7. Open items for Day 4 balance
1. Re-run the sim with Link, Feed, Boost and market saturation once they exist.
2. Decide whether the Bay upgrade costs above are fair (not in sim).
3. Check Flux formula output at ~60 min against the Jump screen (formula is in the earlier planning docs; this sim does not model lifetime credits).
4. Contract Board payouts (min 25): pay about 1.5x market for 3 deliverable batches, one Core Shard chance on the third; tune after the market sim.
5. Mockup ghost-tile labels (20/40/60) must become 60/75/90.
