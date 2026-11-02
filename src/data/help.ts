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
    title: 'Ice Melter, Coolant and Circuits',
    lines: [
      'At the Rubble Belt, once your hull has 10 tiles, you can build an Ice Melter: 2 Ice make 1 Coolant. Hull tile 12 needs Coolant.',
      'Then the Fabricator: 2 Plate and 1 Coolant make 1 Circuit. The last hull tiles need Circuits.',
      'Like the Smelter they never use what your next goal needs, and you can switch them off from their tiles.',
    ],
  },
  {
    title: 'Veda Orbit and the Rover',
    lines: [
      'Fly on from the Ring Fields to Veda Orbit and build a Rover Bay on an outside tile. Tap it to send the Rover down to a site: Dunes (4 min), Crater (8 min) or Ruins (15 min).',
      'It comes back on its own, even while you are away (one trip at most). Tap the Bay to collect: Glass Sand, Amber Resin, Plate, Ore, Relics, and sometimes a Core Shard from the Ruins (every 6th Ruins trip is sure to have one).',
      'Glass Sand and Amber Resin buy Rover attachments (any 3 fit): Drill, Wheels, Cargo Rack, Battery, Scanner. With a Scanner, gold pings show on the Bay: tap one in time for a Rare Crate.',
      'Recall brings the Rover home early with half its finds. The ship cannot leave while the Rover is out.',
    ],
  },
  {
    title: 'Station Halcyon: Trader and Dry Dock',
    lines: [
      'Fly on from Veda Orbit to Station Halcyon. Open the Map while docked for the Trader and the Dry Dock.',
      'The Trader pays 20% more for Plate, Coolant, Circuits, Glass Sand and Amber Resin while you are docked, sells materials in packs of 5 (handy when a tile needs something you cannot make), and sells hull paints.',
      'The Dry Dock turns the full Tug into a Hauler: two new rows at the stern, room for 28 tiles. Every tile and module stays where it is.',
    ],
  },
  {
    title: 'Moving and selling modules',
    lines: [
      'Tap a module (or hold a beam tile, since a tap fires it) to open its sheet. Move picks it up: tap a glowing Open tile to drop it. Free.',
      'Sell pays back 75% of what it cost and of its upgrades. Your last Tractor Beam and the ship\'s own Smasher stay.',
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
    title: 'Jobs and Reputation',
    lines: [
      'The Jobs tab opens with your second beam. Each job asks for materials and pays more than selling, plus Reputation.',
      'Hand over part of a job now and the rest later; what you hand over is kept safe in the job. Local jobs can only be finished at their field.',
      'A finished slot gets a new job after 10 minutes of play. Skip swaps a job once every 30 minutes.',
      'Reputation ranks: Hauler (Bay holds 4), Salvager (a 4th job, +10% pay), Contractor (the Auto-Winch), Fleet Partner (gold trim and a Core Shard).',
    ],
  },
  {
    title: 'Moving around the ship',
    lines: [
      'Swipe the ship to scroll it. Pinch with two fingers to zoom in or out.',
      'Double-tap empty space to zoom out until the whole ship fits.',
      'Tap a Solar Wing to see dotted lines to every module it powers.',
      'Menu: Calm mode turns off shakes and flashes; Labels puts names back on the modules.',
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
