# Playtest 3 notes and team review (Oct 27, after Day 6)

Status: PLANNING ONLY. No code changed. Brendan's seven notes, a critical review of each, a proposed rule set, and a patch plan. Where this conflicts with an older doc, this one is newer.

## 1. Brendan's notes (as given)
1. The Fire button should not be disabled until all Bay slots are full. Tapping a beam should pull an asteroid if there is room.
2. "I like that the smelter autofills from the beams once it is upgraded."
3. Let me buy more Smashers and Smelters to fill the open compartments. Expansions (and extra copies of a module) should scale exponentially, e.g. Smelter about 120, then 360, then 1000.
4. Selling needs a revamp: a Sell window where each item can be sold, or a sell button next to each item count.
5. Rename the "Send" button (to "Smasher", or a symbol).
6. Next minor patch: a simple menu with the version, a help guide and a reset button for testing.
7. Review all of this critically and expand, without changing code.

## 2. Verdicts at a glance
| # | Note | Verdict | Size |
|---|---|---|---|
| 1 | Fire unlocked until Bay full | Yes, with a precise "room" rule plus clear Bay feedback. The 4.1 lock was a reaction to missing feedback | Patch |
| 2 | "Smelter autofills" | Probably means the **Smasher** (L2 feeds itself from the Bay). Confirm. Note 1 makes it work with one beam | Clarify |
| 3 | More Smashers and Smelters, exponential cost | Yes, and it fixes a real gap (Open tiles have nothing to build). His 120 / 360 / 1000 checks out against the upgrade ladder. Needs caps, Move/Sell and a save refactor first | Feature (Day 7/8) |
| 4 | Sell revamp | Cargo sheet with per-item rows, a Hold-for-goal switch and a total button, opened by Sell once a second item exists (one tap before that). In 6.1. Auto-sell in 6.2 | Patch 6.1 |
| 5 | Rename Send | Yes. "Smash" with the Smasher's orange and a queue count | Patch |
| 6 | Menu: version, help, reset | Yes. Version should be injected at build so it proves which build the phone loaded | Patch |

## 3. Note 1: Fire stays available until the Bay is full
**What it does today.** Fire and the beam tiles are locked while a rock is in the stage (Patch 4.1, requested by Brendan: "disable the button if there is a rock in the hit box"). With one beam that means the Bay is never used, so Smasher auto-intake (L2) does nothing until beam 2.

**Critical review.**
- This reverses a Patch 4.1 request, but Brendan has explained it (Oct 27): the button could be pressed while a rock was in the stage, he thought pressing it did nothing, and it may in fact have added a rock to the Bay. So the lock was a response to **missing feedback, not to a wrong rule**. The right fix is to keep the rule (rocks queue in the Bay) and make the result obvious: see "Feedback" below.
- Economy: for a hand-crushing player nothing changes (crushing takes 4 to 6 s, the beam takes 1 s). The gain goes to the Smasher: with Bay rocks available, L2 auto-intake works with one beam, so beam 2 becomes a throughput upgrade instead of a prerequisite. That shifts the goal chain (beam 2 is currently the post-repair goal). The bot sim must be re-run before shipping.
- It makes the Bay a real resource, which ties directly to the planned **Bay size upgrade (3 to 6)**. Worth adding to the Workshop in the same patch because Bay size would now matter. Bay upgrade cost is still an open decision.
- It does not make the game idle. Beams still need a tap per rock until the Auto-Winch module (planned around minute 15 to 18). Offline progress already assumes hands-free firing, which is generous before the Auto-Winch exists; fine at 30% / 10%, but note it.

**Proposed rule.**
- Room = `bay.length + beams counting or blocked < baySlots` (in-flight rocks count, so a third tap cannot waste a rock).
- Beam tile tap: starts that beam if it is idle and there is room.
- Fire button: starts idle beams, as many as there is room for (first beams first).
- Fire is disabled only when there is no room. Labels: `Fire beam`, `Fire 2 beams`, `Incoming 0.6s`, `Bay full 3/3`.
- A geode in the stage no longer stalls the beams, so the offline "geode waiting" stall mostly goes away (it still stalls at Smasher L1 because L1 has no auto-intake).

**Feedback (the real fix for the 4.1 confusion).** Today, while a rock is in the stage the stage text is hidden and the only clues are a small Bay strip and a countdown ring on the beam tile. Add:
- Fire label shows what happened and the state: `Incoming 0.6s`, then `Bay 2/3`, then `Bay full 3/3` (disabled).
- A pulsing ghost rock in the next free Bay slot while a rock is incoming, and a pop when it lands.
- A short floating `+1 Bay` (or `Bay 2/3`) over the Bay strip when a rock arrives.
- The Bay strip moves closer to the stage or gets bigger slots (it is 30 px each now).
- Help text in the menu: "Fire again to stock up the Bay."

**Tests/sim.** Room rule (3 beams, 1 free slot fires 1), in-flight counting, Bay-full disables, auto-intake with one beam, bot re-run for casual and idle.

## 4. Note 2: "the smelter autofills from the beams once it is upgraded"
No such mechanic exists. The Smelter turns Ore into Plate from the Ore stock (always on), and it never touches beams. What exists is **Rock Smasher level 2, which feeds itself from the Bay**. Confirmed by Brendan (Oct 27): he meant the Smasher. If he really wants a Smelter feed upgrade (for example "Smelter L3 pulls Ore straight from the Smasher output with no stock step"), that is a different feature and would not change the numbers.

## 5. Note 3: more Smashers and Smelters, exponential costs

### 5.1 Why this is needed
Hull tiles currently have no payoff beyond the silhouette: beams are capped at 3 and need an edge tile, the Smelter and Smasher are capped at 1. After tile 5 the player has Open tiles and nothing to put on them, so buying tiles (up to 18, about 5,600 credits) has no purpose. Multiple copies of the production modules give tiles a job.

### 5.2 Is 120 / 360 / 1000 right? (checked against the upgrade ladder)
The existing upgrades climb about x3 per level (Smelter 40 / 120 / 360, Smasher 150 / 450 / 1350, beams 25 / 75 / 225). A new copy should cost at least what the same capacity costs through upgrades, or players will buy copies and skip upgrades.

| | Capacity gained | Upgrade price per unit of capacity |
|---|---|---|
| Smelter L2 / L3 / L4 | +0.125 / +0.156 / +0.195 Ore/s | 320 / 770 / 1,850 credits per Ore/s |
| New Smelter (L1 = 0.5 Ore/s) at those rates | | 160 / 385 / 925 credits |
| Smasher L2 / L3 / L4 | +0.625 / +0.875 / +1.0 HP/s | 240 / 515 / 1,350 credits per HP/s |
| New Smasher (L1 = 2.25 HP/s) at those rates | | 540 / 1,160 / 3,040 credits |

So Brendan's Smelter numbers (about 120, 360, 1000) sit right on the ladder. For the Smasher the same logic gives roughly 500, 1,200, 3,000.

Payback check (credits, at 100% use): a Smelter turns 30 Ore/min into 10 Plate/min, worth 80 credits against 30 as raw Ore, so +50/min. The 120-credit copy pays back in 2.4 min, 360 in 7 min, 1,000 in 20 min, but only if there is spare Ore. One L1 Smelter saturates at 30 Ore/min; an engaged player makes 40 to 90 Ore/min, so copy 2 is useful from about minute 6 to 10, which is when a second Smelter should appear. A Smasher copy adds about 15 Ore/min (3.9 rocks/min x 4 Ore) and pays back slowly (13 to 35 min), which fits its role as the idle engine.

### 5.3 Proposed price table (to be tuned by the bot)
| Module | #1 | #2 | #3 |
|---|---|---|---|
| Smelter | 25 Ore (tutorial, keep) | about 120 credits + 4 Plate | about 360 credits + 10 Plate |
| Smasher | repair 8 Plate (it starts on the ship) | about 500 credits + 8 Plate | about 1,200 credits + 20 Plate |
| Tractor Beam | free | 60 credits + 10 Ore (exists) | 140 credits + 6 Plate (exists) |
Rule: price of copy N = base x ratio^(N-2) with ratio 3, small Plate gate so Smelter output matters. All in `src/data/modules.ts`, no magic numbers. Every copy also needs a tile (tile prices already rise x1.23 per tile), so the real cost of a copy is its price plus the next tile.
"First Smelter around 120" would raise the tutorial price from 25 Ore (minute 1) to 120 credits (minute 3 or later). Keep 25 Ore for #1 and apply Brendan's curve to #2 onward unless he wants the tutorial slowed.

### 5.4 What has to change first
- **Hull slot budget.** The module catalog (Beam x3, Grapple 2 tiles, Smelter, Smasher, Solar, Ice Melter, Fabricator 4, Auto-Winch, Reactor 4, Jump Drive 4) already needs about 22 tiles in an 18-tile hull. Unlimited copies would crowd out the catalog. Proposal: cap Smasher and Smelter at 3 each, and let hull 2 raise caps.
- **Move and Sell (refund) modules.** Today a wrongly placed module stays forever. Multiple copies make mistakes costlier. Add Move (free, once per module per minute or small credits) and Sell/Demolish (refund 75%) before or with copies. The docs already say Jump Drive demolish refunds 100%.
- **Data model.** `state.smasher` and `state.smelter` are single objects. They become arrays of units, each with its own level and (Smasher) queue, like beams already do. Save v6 with a migration that wraps the existing object. All consumers of `smasher`/`smelter` change: loop, reserve, offline, goals, UI, bot, tests.
- **Rules to decide.** Send and auto-intake go to the Smasher with the most free queue space. Each unit upgrades separately (matches beams). Smelters share one Ore stock; reserve logic uses the total.
- **UI load.** With 3 beams + 3 Smashers + 3 Smelters, the Workshop would have about 10 rows. Move per-unit upgrades to the tile sheet and keep the Workshop for global things (Hand Tools, Bay size, hull). The scrolling sheet from Day 6 helps but a 10-row list is poor on a phone.
- **Offline** needs no special rules: it runs the real tick, so copies work automatically.

### 5.5 "Expansions should scale exponentially"
Hull tiles already do: `round5(60 x 1.23^(n-4))`, tile 18 is 1,090 and the total is about 5,600. If Brendan means steeper, say so; otherwise note that module copies at x3 outgrow tiles quickly and tiles stay the cheaper sink. The bot must be taught to buy copies and tiles together and the total credit sink for hull 1 will roughly double, so time-to-tile-9 will lengthen (currently about 9 to 12 min); check against the 60 minute hull-1 target.

## 6. Note 4: the sell screen (revised Oct 27 after Brendan's reply; goes into Patch 6.1)
Brendan did not accept "keep Sell as one tap and add a Stock sheet" and asked for a better sell screen. This section replaces the earlier proposal.

**Today.** One Sell button sells everything sellable except what the current goal needs and the Ore the Smelter needs for that goal's Plate (Shards never sell). The first sale sells everything. Pills show Ore and Plate only. The reserve is invisible ("Keeping materials for your goal"), which is the biggest problem: a player cannot see what is held back or why, cannot sell Plate to buy an upgrade instead of the goal, and cannot choose what to sell.

### 6.1 What the team said
- **Player view:** I want to see what I have, what each thing is worth, and sell some of it. I do not want to lose Plate I was saving, and I do not want a chore every minute.
- **UX:** Sell is the most frequent action. A window is fine if the primary button lands where the thumb already is, and if it does not take a tap to open AND a tap to confirm AND a tap to close. Per-item buttons beside the counts do not fit: the top row holds three pills and six items are coming.
- **Economy:** The decision that matters is Ore vs Plate (3 Ore sell for 3 credits; the same Ore as Plate sells for 8). The screen should teach that. Plate is also a building material, so "keep" must be easy to see.
- **Engineering:** The sheet builder, scrolling and rows already exist. Reserve and sell-value maths are pure core functions. Per-item selling needs one new core function (`sellItem(state, item, qty)` already exists as `sell`); a "hold for goal" switch needs one saved flag.
- **QA:** After an offline return the player can hold 250 Plate: numbers must format (1.2k) and "Sell all" must not be an accident. Reserved amounts must be explained, not silent.

### 6.2 Options considered
| Option | Idea | Verdict |
|---|---|---|
| A. Sell window, per-item rows | Sell opens a sheet; each item row has Sell all and Sell 1; total at the bottom | Good, but every sale is 2 taps unless the layout is tuned |
| B. Cart | Rows with a check box (all ticked by default), one big "Sell selected" button | Fastest default (Sell, then one tap), easy to untick Plate. Two taps to sell everything |
| C. Per-item sell on the pills | Tap the Ore or Plate pill to sell it | Hidden, accidental, no room for 6 items. Rejected |
| D. Auto-sell with keep floors | Each item has an Auto toggle and "keep at least N" | The right long-term answer for idle play and offline returns; needs saved settings. Later (6.2) |
| E. Hybrid (recommended) | Progressive: one tap while only Ore is sellable, then the Cargo sheet (B layout with per-row buttons) once a second item appears. Auto-sell comes next | Teaches the game in order; no extra taps early; keep control later |

### 6.3 Recommended design: the Cargo sheet
**When it appears.** While the player only has Ore, Sell stays one tap (`Sell +12`), because the tutorial and the first minutes must be quick. Once the player holds a second sellable item (the first Plate), the Sell button changes to `Sell...` and opens the **Cargo sheet**. The label shows the difference, so the same button never surprises.

**Layout** (390 wide sheet, rows 64 px, scrolls like the Workshop):
```
Cargo                                           Close
-------------------------------------------------------
[ox] Ore      42        1 each      [x]    [Sell 42]
     Smelter: 3 Ore -> 1 Plate = 8 credits
[pl] Plate    11        8 each      [x]    [Sell 3]
     Kept 8 for: Smasher repair
[co] Coolant   0        (hidden until owned)
[sh] Core Shard 1       Not for sale
-------------------------------------------------------
Hold materials for my goal  [ON]
[        Sell selected   +130 credits        ]
```
- One row per item the player has ever owned. Columns: icon, name, count, price each, a tick box (selected for the big button), a per-row button that sells that row's surplus (the label shows the count).
- Reserve is shown on the row: `Kept 8 for: Smasher repair`, `Kept 24 Ore to make Plate`. The sell count excludes it.
- **Hold materials for my goal** switch (default ON): when OFF the reserve is released so the player can sell Plate for an upgrade. This needs one saved flag (`flags.holdForGoal`).
- The big button sells all ticked rows, closes the sheet, and floats `+N` at the credits pill. It sits at the same screen position as the Sell button (y about 706 to 752) so the thumb does not move. The per-row buttons keep the sheet open.
- Ticks are not saved (they reset to all ticked) in 6.1; "keep" is handled by the reserve and the switch.
- Numbers format as 1.2k above 999. Core Shards show "Not for sale" and cannot be ticked.
- Ore row tip appears while a Smelter exists and Ore is held: `3 Ore -> 1 Plate = 8 credits` (the smelting value: 3 sells as Ore, 8 as Plate).

**Feedback.** Selling updates the credits pill with a floating `+N`; the Cargo rows animate to 0 after a per-row sale; the Sell button pulses once on the goal chip step ("Sell your Ore") as now.

**Tests.** Per-row sell respects the reserve; the switch OFF releases the reserve (and keeps Shards); selling selected rows equals the sum of the per-row sells; `sellValue` for the big button matches what is paid; a Shard is never sold; the migration adds `holdForGoal = true`; button label logic (one-tap vs `Sell...`) is a pure function.

### 6.4 After 6.1 (6.2, not built yet)
Per-item **Auto-sell** toggle with a keep floor ("keep at least N"), shown in the same Cargo rows. It fixes idle play and the offline return (nothing is sold for you today), and it matches the docs' "Always sell" setting. Also the Stock tab when more items exist.

## 7. Note 5: renaming Send
"Send" is generic and does not say where the rock goes. Proposal: label **Smash** in the Smasher's orange (the tile's colour once repaired) with the queue count, e.g. `Smash 1/2`; states `Smash`, `Full 2/2`, `Geode` (hands only). An icon alone is riskier: it needs art, must be learned, and the style rule is readable in greyscale at 38 dp; use an icon plus label when art arrives. The goal chip text becomes "Smash a rock". With several Smashers the label still works. Minor: update the tutorial/help text and tests that mention "Send".

## 8. Note 6: the menu
- **Entry.** The top row has no space for a gear. Put a 44 px gear button to the right of the goal chip (chip shrinks from 358 to about 306). Tab bar slots are reserved for Ship, Build, Stock, Contracts, Jump.
- **Contents (simple):** Version line, Help, Reset save. Optional: Copy save / Paste save.
- **Version.** Inject at build from `package.json` plus the short git hash and date, e.g. `v0.6.1 (e2c9fbb, Oct 27)`. Today `package.json` says 0.1.0, so adopt `0.<day>.<patch>` (Day 6 = 0.6.0). The main value for the phone is proving which build loaded when GitHub Pages or Chrome serves a stale one.
- **Help.** About 6 short cards in `src/data/help.ts` (copy stays out of code): Basics (Fire, crack rocks, Sell), Weak points and heat, Smash button and Smasher, Smelter and Plate, Workshop, While you are away (30% / 10%, 8 h cap). Reuses the scrolling sheet.
- **Reset.** Erases the save and starts fresh (`savedAt` cleared so no offline award). Danger button at the bottom; confirm with a hold-to-confirm (about 1.5 s, the pattern the docs use for Jump) or a second sheet. Replaces `?debug` [reset] for normal testing; the other debug buttons stay behind `?debug`.
- **Copy / Paste save (accepted Oct 27, in 6.1):** Copy writes the save as text to the clipboard (HTTPS and a tap are enough on iOS Chrome); Paste opens a text prompt, validates it (version, shape) with the same loader as a normal load, shows what it will replace, and asks to confirm. On iPhone, browser storage can be cleared, and it protects against a bad migration. Failure fallback: show the text in a prompt to copy by hand.

## 9. Proposed plan
**Patch 6.1 (Day 7 build, then playtest):** note 1 (Fire/room rule with Bay feedback), note 5 (Smash label), note 6 (menu with version, help, reset, Copy/Paste save), note 4 (Cargo sheet with the Hold-for-goal switch; save gets one flag so it is save v6 with a one-line migration). Re-run the bot, add the tests above, update the help copy. Optional add: Bay size upgrade in the Workshop (note 1 makes it matter). Order of work inside 6.1: Fire/Bay feedback, Smash rename, Cargo sheet, menu, version injection.
**Day 7 playtest gate:** play 6.1 on the phone. Brendan's notes 3 and 4 depend on how the early loop feels with the relaxed Fire rule, so we keep the gate.
**Day 7/8 build (feature slice):** note 3 (multiple Smashers and Smelters with caps, price curve, Move/Sell, save v6, per-unit tile sheets) and note 4 (Stock sheet). Update `docs/modules-and-ui-plan.md` (max-per-ship column) and `src/sim` (the bot buys copies).

## 10. Decisions (Oct 27)
1. The "autofill" note meant Smasher level 2 auto-feed: confirmed.
2. Fire lock in 4.1: it was a reaction to missing feedback; unlock and fix feedback (see section 3).
3. First Smelter stays 25 Ore; the x3 price curve starts at copy 2: yes.
4. Caps of 3 Smashers and 3 Smelters, with Move and Sell (75% refund) built first: yes.
5. Copy / Paste save in the menu: yes (planned for 6.1).
6. Selling: not "keep Sell as one tap plus a Stock sheet". Replaced by the Cargo sheet design in section 6. Open: Brendan to pick or adjust the design (options A to E, recommended E).
