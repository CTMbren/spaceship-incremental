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
    ],
  },
  {
    title: 'While you are away',
    lines: [
      'Your ship keeps working when you close the game, but at a slower pace: 30% for the first 2 hours, 10% after that, up to 8 hours.',
      'Come back to a short report of what it earned. Away for less than 2 minutes counts as nothing.',
    ],
  },
];
