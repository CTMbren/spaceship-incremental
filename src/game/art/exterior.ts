/** Live exterior effects (graphics pass G4): nav lights, beacon, thruster flames by Engine state. */
import type { ExteriorInfo } from '../hullArt';
import type { G } from './kit';

export type ThrustState = 'none' | 'off' | 'parked' | 'cruising';

export interface ExteriorFx {
  t: number;
  thrust: ThrustState;
  boosted: boolean;
  /** 1 at ignition (Depart), fading to 0. */
  flash: number;
  calm: boolean;
}

export function drawExteriorFx(g: G, info: ExteriorInfo, o: ExteriorFx): void {
  const t = o.t;
  // nav lights: slow blink with a halo (red top, green bottom)
  info.lights.forEach((l, i) => {
    const on = Math.sin(t * 2.2 + i * 0.7) > 0.2 ? 1 : 0.25;
    g.fillStyle(l.color, 0.25 * on).fillCircle(l.x, l.y, 6);
    g.fillStyle(l.color, on).fillCircle(l.x, l.y, 2.4);
  });
  // beacon: a short white pulse every 2 seconds
  if (info.beacon) {
    const ph = (t % 2) / 2;
    const k = o.calm ? 0.6 : ph < 0.12 ? 1 - ph / 0.12 : 0;
    g.fillStyle(0x1e2640, 1).fillRoundedRect(info.beacon.x - 3.5, info.beacon.y - 2, 7, 6, 2);
    g.fillStyle(0xffffff, 0.35 + 0.65 * k).fillCircle(info.beacon.x, info.beacon.y - 2, 2.6);
    if (k > 0 && !o.calm) g.fillStyle(0xffffff, 0.25 * k).fillCircle(info.beacon.x, info.beacon.y - 2, 9 * k + 3);
  }
  // thrusters: pilot light when parked, layered flame while cruising, bloom at ignition
  info.bells.forEach((b, i) => {
    const flick = 0.85 + 0.15 * Math.sin(t * 31 + i * 1.7) + (o.calm ? 0 : 0.08 * Math.sin(t * 53 + i));
    if (o.thrust === 'parked') {
      flame(g, b.x, b.y, 9 * flick, 5, [0x8fd8ff, 0xe6f6ff]);
    } else if (o.thrust === 'cruising') {
      const len = (o.boosted ? 44 : 34) * flick;
      flame(g, b.x, b.y, len, 10, [0xff7a3d, 0xffc83d, 0xfff4d6]);
    }
    if (o.flash > 0 && !o.calm) g.fillStyle(0xffe08a, 0.6 * o.flash).fillCircle(b.x + 12, b.y, 10 + 22 * (1 - o.flash));
  });
}

/** A flame pointing right (toward the rear): nested teardrops, outer colour first. */
function flame(g: G, x: number, y: number, len: number, half: number, colors: number[]): void {
  colors.forEach((c, i) => {
    const k = 1 - i * (0.75 / colors.length);
    const l = len * k, h = half * k;
    g.fillStyle(c, i === 0 ? 0.85 : 1).fillPoints([
      { x, y: y - h }, { x: x + l * 0.45, y: y - h * 0.8 }, { x: x + l, y }, { x: x + l * 0.45, y: y + h * 0.8 }, { x, y: y + h },
    ], true);
  });
}
