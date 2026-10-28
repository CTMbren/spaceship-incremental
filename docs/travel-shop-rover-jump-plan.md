# Rounds 6-9: Travel, Planets & Rover, Shop, Jump Breakage, More Modules

Status: PLANNING ONLY. No code yet. Newest doc wins where it conflicts with `modules-and-ui-plan.md`, `economy-and-details.md` and `team-planning-rounds-1-3.md` (conflicts are listed in section 6).

Input from Brendan (Oct 27): more modules over time; a shop and upgrades; travel that starts slow, visiting better parts of a solar system; a Jump to a new system as a prestige where **modules break instead of a full reset**; flying near a planet and sending a **rover** down for rare items.

Team: Producer (scope, order), Systems designer (rules), Economy designer (numbers), UX designer (screens, phone), Art/Audio (readability, feel), Engineer (state, saves, tests).

## The new shape of the game

```
Scrapyard Drift -> Rubble Belt -> Ring Fields -> Planet Orbit -> Station -> Jump Point
  (tap, hold,       (heavy rocks,    (crystals,    (Rover        (shop,    (Jump: the shockwave
   Smasher)          Ice, outpost)    geodes)       expeditions)  dry dock)  breaks modules)
```

One system takes about 80 minutes of active play (was 60: travel and rover add content). Then you Jump, your ship comes out damaged but not erased, and you rebuild faster in a richer system.

Resource roles (one line each, so it stays learnable):
- **Credits** buy speed (upgrades, tiles). **Materials** buy structure (modules, tiles). **Planet goods** buy capability (new module tiers, Dry Dock, Dampers). **Flux** buys permanence (perks that survive every Jump). **Core Shards** mark milestones (Jump charges, hull finish, fleet).

---

## Session 1: Jump = breakage, not reset

**Goal:** make prestige feel like punching through a barrier with your ship, not like deleting your save.

**What persists through a Jump:** hull tiles, every module (damaged or not), materials, Core Shards, Flux, blueprints, fleet, codex, pity counter, settings.
**What resets:** credits (you keep the Jump Dividend = 3 minutes of last-run income), travel progress (new system, new route), rover sites (new planets).

**The shockwave rule (deterministic, no dice):**
1. Strain `S` comes from the destination system: Jump 1 = 3, Jump 2 = 3, Jump 3 = 4, then +1 every 2 Jumps (cap 6).
2. Every module loses `max(0, S - d + 1)` levels, where `d` is the tile distance (same BFS as power) from the nearest Jump Drive cell to the module's nearest cell. Adjacent to the drive = 1.
3. On the 18-tile Tug the distances spread 1 to 4 (5 cells at 1, 5 at 2, 3 at 3, 1 at 4, plus the drive's own 4 cells), so at S = 3: adjacent modules lose 3 levels, d=2 lose 2, d=3 lose 1, d=4 lose none. Placement matters, and the far corner is a safe shelf.
4. **Brace:** before confirming you tap up to 2 modules to brace (-1 damage each). A **Shock Damper** module (1x1, any tile) gives -1 to every other module within 2 tiles (two Dampers stack, cap -2). Jump Drive levels add free braces (L3: 3, L4: 4).
5. **Never a soft-lock:** the Tractor Beam, Smasher and Jump Drive cannot drop below Level 1 and cannot be wrecked. Any other module whose damage is at least its level becomes a **Wreck**: level 0, stays on its tile, inert, keeps its place and its Peak Level.
6. **Repair is cheap on purpose:** each level restored up to the module's Peak Level costs 35% of that level's original upgrade cost. A Wreck needs 40% of its build materials first. Above Peak, you pay full price as normal. So a Jump is a rebuild phase, not a restart.
7. **The Jump sheet shows the future:** every module row says `Smelter L3 -> L2`, the hull view glows green to red by distance, and the confirm is hold-to-confirm 1.5 s. Nothing happens by surprise.

**What you gain:** Flux (formula unchanged), the new system's richer rock tables and materials, a new Station and Dry Dock, and Flux Exchange perks.

**Hard Jump (optional, from Jump 2):** S +1 for +50% Flux. A real risk/reward choice for players who braced well.

**Target feel:** minute-0 income in the new system is about 45% of the old end income; full repair takes about 12 to 15 minutes; system 2 first run is roughly 55 minutes. All three are sim targets.

**Tests/sim:** damage is monotonic in S and non-increasing in d; Beam/Smasher/Drive never below L1; Wreck repair cost below rebuild cost; preview equals the applied result; Dampers cap at -2; a Jump with all modules at distance 4 loses nothing.

---

## Session 2: Travel

**Goal:** the ship moves through a place. Travel is slow, idle-friendly, and changes what you farm.

**Structure:** a System is an ordered route of Nodes. Later systems get forks. Node types:

| Node | What it is | Staying there |
|---|---|---|
| Field | A rock zone with its own rock table, yield multiplier and geode rate | Farm as long as you like |
| Outpost / Station | Trader, Orders (the Contract Board lives here), Dry Dock (Station only) | Docked while you shop |
| Orbit | A planet. Unlocks Rover expeditions (Session 3) | Stay while the Rover works |
| Anomaly | One-shot event: tap to investigate (free geode, fleet fragment, or a lore line) | Instant |
| Jump Point | End of the route. The Jump sheet opens here | |

**Engine module (new verb: travel):** 2x1, `rear` placement, power -2, unlock about minute 6 (12 Plate). Press Depart on the Map tab and the ship cruises to the next node. Levels cut travel time (-20%, -35%, -50%, -55% of base). No fuel in v1; a Coolant "Burn" for a short speed-up is a later idea.

**Transit rules:**
- Cruising never stops your hands. The beam, Smasher and hold all work. Rocks in transit come from **Void Drift** (small rocks, 50% yield). Leaving a rich Field costs you something, so Depart is a real choice.
- **Travel continues offline** at full speed, counted inside the existing 8 h offline cap. It is a drift, not production: offline income still follows the 30% / 10% tiers. Coming back to "We arrived at Veda" is the retention hook.
- You cannot Depart with the Rover out; the button says "Recall Rover first". Recall returns 50% of the haul.
- One Anomaly per leg, placed by the system seed, so it is deterministic.

**System 1 "Cinder Reach" (provisional name)**

| Node | Arrive (active, min) | Rocks and notes |
|---|---|---|
| Scrapyard Drift | 0 | Dust rocks, 1.0x. Tap, hold, Smasher, first geode |
| Rubble Belt | about 13 | Heavy rocks 2x, Ice 20%. Grapple pays off here (unlock moves to arrival). Outpost with first Orders |
| Ring Fields of Veda | about 34 | Crystal rocks, geodes x1.5, Circuit-lean. Anomaly 1 |
| Veda Orbit | about 44 | Rover sites open |
| Station Halcyon | about 58 | Trader, Dry Dock, Orders |
| Jump Point | about 75 | Jump Drive built, Jump sheet |

Base leg times at Engine L1: 6, 10, 8, 8, 8 minutes. You choose when to leave, so the Rover stay at Veda adds about 10 to 12 minutes. Pure travel is about 40 of the 75 to 80 minutes, which is why you can build while cruising.

**Screens:** tab bar becomes **Ship · Build · Stock · Map** (max 5 held). The Map tab shows the route as a vertical line of nodes with ETA, Depart, and, at the end, the Jump sheet. Contracts become the Orders sheet at any Outpost/Station. Ship scene: star streaks speed up in transit; the next planet grows in the top-right corner; at Orbit the planet is a large flat-vector disc with two bands.

**Tests/sim:** travel ETA is a pure function of engine level; arrival is dt-invariant; offline travel equals sum of active travel for the same seconds; Depart blocked by Rover; save/load mid-transit lands on the same ETA.

---

## Session 3: Planets and the Rover

**Goal:** a second kind of play. The ship collects rocks; the rover explores. Different verb, different rewards, still no fail states.

**Rover Bay module (new verb: deploy):** 1x2, `edge` placement (the rover needs a door), power -2, build 14 Plate + 6 Circuit, offered after the first Orbit is reached (or from the Anomaly in the Ring Fields as a derelict blueprint).

**Rover loadout (a small puzzle of its own):** the chassis has 3 attachment slots; choose from 5, bought with materials and planet goods:

| Attachment | Does |
|---|---|
| Drill | +25% yield |
| Scanner | Reveals higher-rarity finds, shows the ping window |
| Battery | Longer range, so longer expeditions pay more |
| Cargo | +2 item slots on return |
| Wheels | -25% expedition time |

**Expeditions (at an Orbit node, one Rover):** each planet has 3 Sites.

| Site | Time | Gives |
|---|---|---|
| Dunes | 4 min | Common planet goods (Glass Sand) and Plate |
| Crater | 8 min | Metals, Ice, Circuit parts |
| Ruins | 15 min | Relics, **Core Shard chance**, fleet fragment on first visit |

- Runs while you do other things; finishes offline too (collect on return with a reveal animation).
- **Ping (active bonus):** at times a gold ping appears on the Rover panel; tap it in the window for a Rare Crate (the weak-point idea, applied to exploration). Missing it costs nothing, and offline runs never get it.
- **Renewable sites (Brendan's decision, Oct 27):** sites never run out, so the Rover is always something to do at a planet. Rare items are kept in check by rules instead of stock: (a) one Rover, one trip at a time, so the trip time is the throttle; (b) a hidden **pity counter** on Ruins gives a guaranteed Core Shard every 6th Ruins trip (base chance 5%), and a Relic every 2nd trip; (c) common goods scale linearly with trips; (d) offline the Rover completes **one** trip and parks (a Flux perk adds one repeat per level, cap 3), so leaving the game overnight cannot farm 30 trips. At base speed one Shard costs about 90 minutes of Ruins trips, which stays below the geode supply so Shards remain a milestone, not a faucet.
- **No fail:** a dust storm may slow a run (flavour), never lose the Rover or the haul.

**Planet goods (system-specific, 2 per planet):** Veda gives Glass Sand and Amber Resin. They are used for Shock Dampers, Cargo Hold, Dry Dock steps and tier-2 module upgrades, so a planet visit changes what your ship can become, and each system's goods differ.

**Rover vs the old Salvage Drone Bay idea:** the drone is on-ship automation (post-MVP); the Rover is an away mission. Different verbs; keep both.

**Tests/sim:** an expedition's yield is a pure function of site, loadout and seed; pity counter advances and resets exactly once per Ruins trip; offline completion equals online and completes only one trip without the repeat perk; Recall returns 50%; expected Core Shards per 90 minutes of Rover time within 1 to 1.3.

---

## Session 4: Shop, upgrades and the module roadmap

**Three shops, one idea each:**

1. **Workshop** (Build tab, always open): **Hand Tools** (your skill upgrades: crit window, heat cap, cooling rate, hold delay, tap damage; credits, cost base x1/x3/x9), **Bay** slots 3 to 6, and the list of modules you can build. Module levels stay in each module's detail sheet (the no-global-Upgrades-tab rule stands).
2. **Station Trader** (at Outposts/Stations): fixed stock per node (seeded, no timers, nothing expires). Sells new module blueprints, **Dry Dock** hull conversions, Jump parts and a paint swatch per planet (cosmetic, earned, not IAP-only). Pays with credits plus planet goods. Sells refined goods at +20% while docked.
3. **Flux Exchange** (Map tab, after Jump 1): 8 to 10 permanent perks with escalating costs and caps: +1 free Brace, start with Smasher L2, Hand Tool floors, offline cap +1 h, Rover repeat +1 trip offline (cap 3), travel -5%, then +income steps.

**Hull across Jumps:** the hull persists, so growth is by **Dry Dock** conversion: Tug (18 cells) to Hauler (28 cells, a superset of the Tug) at Station Halcyon, then Cruiser (38) in system 2. Templates nest, so no module is ever lost to a bigger hull. Jump no longer requires a full hull.

**Module roadmap (each adds a verb or a trade-off, never just a bigger number):**

| Module | Verb | Arrives | Notes |
|---|---|---|---|
| Engine | travel | System 1, min 6 | 2x1 rear |
| Shock Damper | protect | System 1, Veda | 1x1 any, cap -2 |
| Rover Bay | deploy | System 1, Orbit | 1x2 edge |
| Cargo Hold | store | System 1, Station | Raises the Stock cap and Rover item slots |
| Survey Array | scan | System 2 | Shows next node's rock table, +weak-point window, better Rover pings |
| Trade Terminal | sell | System 2 | Auto-sells chosen items at a set price while docked |
| Radiator | cool | System 2 | Heat cap and cooling, with the Reactor-heat rule |
| Laser Cutter | cut | System 2 | Drag a line across a rock instead of tapping (active alternative to hold) |
| Drone Bay | repeat II | System 3 | On-ship salvage drones |
| Gravity Well, Matter Loom, Singularity Press | wow | System 3+ | Already specified |

**Tile pressure (honest):** the 10 earlier modules need 20 tiles; the four new System 1 modules add 6 more. Hull 1 is 18. Players are expected to leave things out and to move modules, which is the layout decision we want. To keep it kind: Station Halcyon (minute about 58) offers the Hauler; the Fabricator and Reactor are optional in hour one; and the Jump Drive can sit on the Hauler's rear. Raise the Tug to 20 if playtesters call it punishing.

---

## 5. Manager reconciliation (newest wins)

| Old rule | New rule |
|---|---|
| Jump resets module levels and credits; new hull each Jump; Jump 3 re-pick hull | Jump damages modules by the shockwave rule, credits reset to the Dividend, hull persists and grows by Dry Dock, Ring-cut hull choice removed |
| Jump available when hull is full | Jump available at the Jump Point with a built Jump Drive and 1 Core Shard + 5 Circuit per Jump |
| Contracts tab at minute 25 | Orders sheet at any Outpost/Station; first Outpost at the Rubble Belt (min about 15) |
| Tabs Ship/Build/Stock/Contracts/Jump | Ship/Build/Stock/Map (Jump and Flux Exchange live in Map) |
| Grapple at min 9, Ice from heavy rocks anywhere | Heavy rocks and Ice only from the Belt on; Grapple unlock follows arrival (about min 13) |
| First hour = 60 min active | System 1 = about 75 to 80 min active; casual players take about 1.4x |
| Offline: tiers 30/10 % to 8 h | Unchanged for income; **travel and Rover progress run at 100%** inside the same 8 h cap |
| Shard demand 3 per hour | Demand adds 1 per Jump; supply adds Rover Ruins (pity: one Shard per 6th trip) |
| Salvage Drone Bay (post-MVP) | Kept, separate from the Rover |

## 6. Economy and pacing notes (to verify in the sim port)

- Tile and module costs are unchanged; hand-crack time rose in Patch 4.1, so the Smasher plus travel carry idle pace.
- New spend: Engine 12 Plate, Rover Bay 14 Plate + 6 Circuit, attachments 4 to 10 Plate/goods each, Dry Dock Hauler about 2,500 credits + planet goods, Jump 1 Shard + 5 Circuit, Hand Tools base 40 credits.
- Sim targets: System 1 active finish 75 to 85 min; casual 105 to 120; Rover about 1 Shard per 6 Ruins trips (90 min of Rover time); Jump gives about 3 to 4 Flux; system 2 first run 50 to 60 min.
- Strain and Brace need a sim pass for how many levels players lose on average with two braces (target: 25% to 40% of total levels).

## 7. Proposed build order (supersedes the days after Day 4)

| Slice | Content | Check |
|---|---|---|
| Day 5 | 2nd beam, Smelter, Workshop and Hand Tools, sim port | Goal chain through Smelter |
| Day 6 | Offline catch-up + welcome-back | Offline test |
| Day 7 | Build tab, tap-to-place modules, power and reach | **Gate: core loop plus layout playtest** |
| Day 8 | Engine, Route/Map tab, zone rock tables, Depart, offline travel | Travel tests |
| Day 9 | Orbit, Rover Bay, expeditions, Station Trader v1 | Rover tests |
| Day 10 | Jump v1: shockwave, braces, preview, Dividend, Flux Exchange v1 | Strain tests, save v4 |
| Day 11 | Balance pass with the sim, system 2 data | Sim table |
| Day 12 to 14 | Feel pass, polish, playtest build | |

**Producer's flag:** this makes the 2-week target about 3 weeks. Recommended: finish Day 5 to 7 and let Brendan playtest the core loop and layout first, then decide whether to commit to Days 8 to 12. Cut order if time slips: Rover ping, Hard Jump, Cargo Hold, Dry Dock, fork routes.

## 8. Risks

- **Scope** (largest): three new systems (travel, rover, breakage) on top of an unfinished core. Mitigation: the Day 7 gate.
- **Tile pressure** may punish: watch playtest quotes, raise the Tug to 20.
- **Rule overload:** one new rule per about 10 minutes. Travel (min 6), Rover (min 44), Jump (min 75) fit that.
- **Damage feels like loss:** mitigated by the preview, free braces, cheap repair and the Never-Below-L1 rule.
- **Unlimited Rover trips could flood rare items:** pity rate, one trip at a time and one offline trip cap the supply; watch Shards per hour in playtest and slow the pity to every 8th trip if it exceeds the geode supply.
- **Offline travel skips content:** gates (Jump Drive, shards, tiles) keep the pace; arrival alone never completes a system.

## 9. Decisions (Brendan, Oct 27: 1-4 yes, 5 no, 6 decide after the latest playtest)

1. Hull persists across Jumps and grows by Dry Dock. **Yes** (matches modules breaking instead of resetting).
2. Materials persist across Jump; credits reset to the Dividend. **Yes.**
3. Spatial shockwave with Braces and Dampers, not random breakage. **Yes.**
4. Travel and Rover run offline at full speed inside the 8 h cap. **Yes.**
5. Rover sites are finite per planet. **No**, sites are renewable; rare items are limited by the pity rule and trip time instead.
6. Commit to Days 8 to 12 now, or decide after the Day 7 playtest. **Decide after the latest playtest** (Brendan's call; Day 5 to 7 come first).
