/** Help cards shown from the menu. Plain words, short; update when a rule changes. */
export interface HelpCard {
  title: string;
  lines: string[];
}

export const HELP: readonly HelpCard[] = [
  {
    title: 'Basics: Fire and the Bay',
    lines: [
      'Tap Fire (or a beam tile) to pull an asteroid in. It lands in the Bay, which holds 3 rocks.',
      'The rock in the middle is the one you crack. The next one moves up from the Bay on its own.',
      'You can keep firing until the Bay is full. When it says Bay full, crack or Smash a rock to make room.',
    ],
  },
  {
    title: 'Weak points and heat',
    lines: [
      'Tap the rock to crack it. Hit the glowing spot for a 3x crit, and it cools you down.',
      'Hold your finger down to keep cracking. Too much heat jams your tools for a few seconds, so ease off when the ring turns red.',
    ],
  },
  {
    title: 'Smash and the Smasher',
    lines: [
      'Repair the Smasher (8 Plate) and the orange Smash button shows up on the stage.',
      'Smash hands the current rock to the Smasher, which breaks it while you do other things. The 1/2 shows how many rocks it holds.',
      'Geodes stay with your hands. Upgrade the Smasher and it starts feeding itself from the Bay.',
    ],
  },
  {
    title: 'Smelter and Plate',
    lines: [
      'The Smelter turns 3 Ore into 1 Plate on its own. Plate fixes the Smasher and pays for bigger hull tiles.',
      'It never uses Ore your next goal needs. Switch it off from its tile if you want to keep all your Ore.',
    ],
  },
  {
    title: 'Power and Solar Wings',
    lines: [
      'Beams, Smashers, Smelters and the Engine need power. The hull makes 3. Power 4/5 at the top of the ship shows what you use and what you have.',
      'A Solar Wing (outside tile) makes 2 more for modules up to 2 tiles away. Anything touching it gets a Boost: 15% faster, shown by a blue diamond.',
      'A module without power stops and shows a red bolt. Add a Solar Wing near it, Move it closer to one, or switch a Smelter OFF to free power.',
    ],
  },
  {
    title: 'Travel and the Map',
    lines: [
      'Build an Engine on a back tile (open space to its right), then open the Map tab and tap Depart.',
      'While you cruise, your beams keep working but only find small drifting rocks with half the Ore. The trip keeps going at full speed while you are away.',
      'Each field has its own rocks. The Rubble Belt has Ice chunks; the Ring Fields have richer rocks and more geodes.',
    ],
  },
  {
    title: 'Grapple Beam and Ice',
    lines: [
      'Reach the Rubble Belt and you can build a Grapple Beam. It counts down for 12 seconds and pulls one big rock.',
      'At the Belt and beyond that is a Heavy rock: 12 Ore and 2 Ice, but tough to crack. Smash it if your hands are busy.',
      'Ice pays for hull tiles 10 and 11.',
    ],
  },
  {
    title: 'Selling',
    lines: [
      'At first Sell sells all your Ore in one tap.',
      'After your first Plate, Sell opens the Cargo sheet. Each row has its own Sell button, and the big button at the bottom sells everything ticked.',
      'Hold materials for my goal keeps back what your next goal needs. Turn it off to sell everything.',
    ],
  },
  {
    title: 'Workshop',
    lines: [
      'The Build tab holds every upgrade: Hand Tools, beams, Smelter, Smasher.',
      'Tap a dotted Open tile on the ship to build a module there, or buy a new hull tile to make room.',
      'You can build up to 3 Smelters and 3 Smashers. Each copy costs more than the last and has its own upgrades. Tap one to upgrade it, Move it, or Sell it for 75% back.',
    ],
  },
  {
    title: 'While you are away',
    lines: [
      'Your ship keeps working when you close the game, but at a slower pace: 30% for the first 2 hours, 10% after that, up to 8 hours.',
      'Smelters run for the first 30 minutes and then go cold, so you come back to a pile of raw Ore. Travel runs at full speed the whole time.',
      'Come back to a short report of what it earned. Away for less than 2 minutes counts as nothing.',
    ],
  },
];
