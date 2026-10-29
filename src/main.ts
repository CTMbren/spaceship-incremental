import Phaser from 'phaser';
import { GalleryScene } from './game/GalleryScene';
import { DPR, H, ShipScene, W } from './game/ShipScene';

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
    width: Math.round(W * DPR),
    height: Math.round(H * DPR),
    backgroundColor: '#0B1020',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, roundPixels: false },
    input: { activePointers: 3 },
    // ?gallery shows the art gallery (every module, state and level) instead of the game
    scene: new URLSearchParams(window.location.search).has('gallery') ? [GalleryScene] : [ShipScene],
  });
}

document.addEventListener('contextmenu', (e) => e.preventDefault());
// iOS: a two-finger pinch belongs to the ship view (Day 9), never to page zoom; nor does a double-tap.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
void start();
