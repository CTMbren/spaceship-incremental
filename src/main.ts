import Phaser from 'phaser';
import { H, ShipScene, W } from './game/ShipScene';

async function start(): Promise<void> {
  // Wait briefly for the Fredoka font so the first frame uses it.
  try {
    await Promise.race([
      document.fonts.load('600 20px Fredoka'),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* fall back to system font */
  }
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: W,
    height: H,
    backgroundColor: '#0B1020',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, roundPixels: false },
    input: { activePointers: 3 },
    scene: [ShipScene],
  });
}

void start();
