# Job Board and Reputation (built in Day 9, v0.9.0)

Brendan's request (Oct 28): jobs that ask for materials (e.g. 50 Ore + 10 Plate) at a premium, done for reputation instead of just selling. Brings forward the old Contract Board / Orders idea. Numbers below are as built (tuned with the bot); all live in `src/data/jobs.ts`.

## Why
- Materials had two uses (sell, build). Jobs add a third and make the Ore pile from Patch 7.2 worth keeping.
- Credits already pile up late, so the main reward is **Reputation**, which buys things credits cannot. The credit premium stays modest.

## Rules
- **Jobs tab** (Ship · Build · Map · Jobs), opens with the second Tractor Beam. Dot when a job can be finished.
- **Three slots**, sized to the player's own output (5 min moving average, never below 70% of par: 30 Ore, 4 Plate, 4 Ice per minute), times a share of 0.35:

| Slot | Asks for | Pays |
|---|---|---|
| Quick | 3 min of output, one item | 1.3x sell value + 1 Rep |
| Standard | 8 min of output, Ore + Plate (+ Ice sometimes) | 1.5x sell value + 2 Rep |
| Local | 6 min, the field's specialty (Scrapyard Ore, Belt Ice, Rings Plate + Ice) | 1.8x sell value + 3 Rep, only while parked there |

- **Partial delivery** ("Hand over"): delivered items are locked in the job. The goal's own materials stay back while "Hold materials for my goal" is on.
- **Refresh:** a finished slot refills after 10 min of play. One free Skip per slot every 30 min (deliveries come back). Nothing expires. A Local job is replaced when the ship parks at another field (deliveries come back).
- The board has its own seeded RNG; offline time does not move the output average; jobs are never filled while away.

## Reputation ranks (never lost)
| Rank | Rep | Unlocks |
|---|---|---|
| Hauler | 5 | Bay +1 slot |
| Salvager | 14 | A fourth job slot, jobs pay +10% |
| Contractor | 28 | Auto-Winch (14 Plate): fires every beam touching it when the Bay has room |
| Fleet Partner | 50 | Gold hull trim + a Core Shard |

Bot pacing (casual, uses the board): Hauler ~15 min, Salvager ~35, Contractor ~63. Engaged players rank up more slowly because their jobs are bigger while they also build more; watch in playtest.

## Team notes (planning round)
Systems: per-field jobs make travel matter. Economy: Rep must be the main reward. UX: no expiry, partial delivery, dot. Producer: before the Rover. Engineer: game-time refresh, locked deliveries, save v9. Art/Audio: cork-board look and stamp later (cards for now).
