/**
 * Module art (graphics pass G2/G3). Each module has a static body (drawn when the ship is redrawn) and an
 * effects layer (drawn every frame from the module's real state: working, progress, power, Boost).
 * Coordinates are a tile's top-left in local units; nothing here reads GameState, so the gallery page can
 * draw every state with made-up values.
 */
import { C } from '../palette';
import { DIR_V, INK, S, along, disc, frame, grey, hazard, plate, polyAlong, rivet, tint, type Dir, type G } from './kit';

export type ArtKind = 'beam' | 'grapple' | 'smasher' | 'smelter' | 'solar' | 'engine' | 'winch' | 'melter' | 'fab' | 'rover' | 'open';

export interface BodyOpts {
  level: number;
  /** Outward direction for beams and the Grapple (the side facing open space). */
  dir: Dir;
  rusty?: boolean;
  /** Unpowered modules lose their colour (and lights in the effects layer). */
  dark?: boolean;
}

export interface FxOpts {
  /** Seconds (scene clock). */
  t: number;
  dir: Dir;
  level: number;
  working: boolean;
  /** 0..1 of the current job (countdown, batch, rock). */
  progress: number;
  powered: boolean;
  boosted: boolean;
  /** 1 right after an event (rock landed, Plate made, Depart), fading to 0. */
  flash: number;
  /** Calm mode: no flashes, slower loops, fewer particles. */
  calm: boolean;
  rusty?: boolean;
  cruising?: boolean;
  /** Auto-Winch: directions of the beams it is working. */
  targets?: Dir[];
  /** Rover Bay: where the Rover is, and whether a gold ping is showing. */
  rover?: 'home' | 'out' | 'back';
  ping?: boolean;
}

const STEEL = 0x8fa0be;
const DARK_STEEL = 0x5c6b8a;
const HOUSING = 0x3d4a6b;
const FACE: Record<ArtKind, number> = {
  beam: 0x22304e, grapple: 0x17393b, smasher: 0x3b2a26, smelter: 0x3a2a24, solar: 0x14223f, engine: 0x2a2342, winch: 0x3a3020, melter: 0x1d3346, fab: 0x1d3a2c, rover: 0x33283a, open: 0x18223f,
};

const col = (c: number, dark?: boolean) => (dark ? grey(c) : c);

// ---- static bodies ------------------------------------------------------------------------------

export function drawBody(g: G, kind: ArtKind, x: number, y: number, o: BodyOpts): void {
  const cx = x + S / 2, cy = y + S / 2;
  if (kind === 'open') {
    g.fillStyle(0x18223f, 1).fillRoundedRect(x + 7, y + 7, S - 14, S - 14, 8);
    g.lineStyle(1, 0x26325a, 1).lineBetween(cx, y + 12, cx, y + S - 12).lineBetween(x + 12, cy, x + S - 12, cy);
    for (const [dx, dy] of [[12, 12], [S - 12, 12], [12, S - 12], [S - 12, S - 12]]) rivet(g, x + dx, y + dy, 0x6f7fa8);
    return;
  }
  const d = o.dark;
  frame(g, x, y, col(FACE[kind], d), o.level);
  switch (kind) {
    case 'beam': {
      // cable drum behind, a housing in the middle, a funnel emitter facing open space with a hazard lip
      polyAlong(g, cx, cy, o.dir, [[-19, -10], [-5, -10], [-5, 10], [-19, 10]], INK);
      polyAlong(g, cx, cy, o.dir, [[-17.5, -8.5], [-6.5, -8.5], [-6.5, 8.5], [-17.5, 8.5]], col(DARK_STEEL, d));
      for (const v of [-5, 0, 5]) {
        const a = along(cx, cy, o.dir, -17, v), b = along(cx, cy, o.dir, -7, v);
        g.lineStyle(1.2, INK, 0.7).lineBetween(a.x, a.y, b.x, b.y);
      }
      polyAlong(g, cx, cy, o.dir, [[0, -8], [20.5, -15], [20.5, 15], [0, 8]], INK);
      polyAlong(g, cx, cy, o.dir, [[1.5, -6.5], [19, -13], [19, 13], [1.5, 6.5]], col(STEEL, d));
      polyAlong(g, cx, cy, o.dir, [[1.5, -6.5], [19, -13], [19, -9], [1.5, -3]], col(tint(STEEL, 0.3), d));
      hazard(g, cx, cy, o.dir, 15.5, 12, 3.5);
      disc(g, cx, cy, 8.5, col(HOUSING, d));
      break;
    }
    case 'grapple': {
      // a rail along the outward axis and a cable spool behind it (the claw itself is drawn live)
      polyAlong(g, cx, cy, o.dir, [[-5, -5.5], [20, -5.5], [20, 5.5], [-5, 5.5]], INK);
      polyAlong(g, cx, cy, o.dir, [[-4, -4], [19, -4], [19, 4], [-4, 4]], col(STEEL, d));
      hazard(g, cx, cy, o.dir, 16, 5, 3);
      const sp = along(cx, cy, o.dir, -11, 0);
      disc(g, sp.x, sp.y, 9, col(0x6b5a3a, d));
      g.lineStyle(2, INK, 0.9).strokeCircle(sp.x, sp.y, 5.5);
      for (const v of [-9, 9]) { const r = along(cx, cy, o.dir, 6, v); rivet(g, r.x, r.y); }
      break;
    }
    case 'smasher': {
      // hopper on top, a piston column, a base plate; rust patches when Rusty
      g.fillStyle(INK, 1).fillTriangle(x + 13, y + 10, x + 43, y + 10, x + 28, y + 22);
      g.fillStyle(col(o.rusty ? 0x7a5a44 : 0x9a7a5a, d), 1).fillTriangle(x + 15.5, y + 11.5, x + 40.5, y + 11.5, x + 28, y + 20.5);
      plate(g, x + 25, y + 12, 6, 32, 2, col(DARK_STEEL, d), 1.5);
      plate(g, x + 12, y + 41, 32, 5, 2, col(0x6a5a50, d), 1.5);
      if (o.rusty) {
        g.fillStyle(0x8a4a22, 0.85).fillCircle(x + 16, y + 38, 3.5).fillCircle(x + 39, y + 15, 2.5).fillCircle(x + 34, y + 42, 2.2);
        g.fillStyle(0x5a2e16, 0.8).fillCircle(x + 17, y + 37, 1.5);
      }
      break;
    }
    case 'smelter': {
      // brick furnace, a chimney, the furnace mouth and an ingot tray
      plate(g, x + 12, y + 17, 26, 26, 4, col(0x8c4a2f, d));
      g.lineStyle(1, tint(col(0x8c4a2f, d), -0.45), 0.9);
      for (const yy of [23, 29, 35]) g.lineBetween(x + 13, y + yy, x + 37, y + yy);
      for (const [xx, yy] of [[20, 17], [30, 23], [20, 29], [30, 35]]) g.lineBetween(x + xx, y + yy, x + xx, y + yy + 6);
      plate(g, x + 31, y + 9, 8, 11, 2, col(0x5a4a44, d), 1.5);
      g.fillStyle(INK, 1).fillRoundedRect(x + 30, y + 8, 10, 3, 1.5);
      g.fillStyle(INK, 1).fillRoundedRect(x + 18, y + 30, 14, 13, { tl: 7, tr: 7, bl: 1, br: 1 });
      g.fillStyle(0x1a1010, 1).fillRoundedRect(x + 19.5, y + 31.5, 11, 11.5, { tl: 5.5, tr: 5.5, bl: 0, br: 0 });
      plate(g, x + 38, y + 38, 8, 4, 1, col(STEEL, d), 1.2);
      break;
    }
    case 'melter': {
      // a glass ice tank on a heater base, a pipe to a Coolant vial on the right
      plate(g, x + 11, y + 37, 26, 8, 2, col(DARK_STEEL, d), 1.5);
      for (const xx of [15, 21, 27, 33]) g.fillStyle(INK, 0.8).fillRect(x + xx, y + 39.5, 2.5, 3);
      g.fillStyle(INK, 1).fillRoundedRect(x + 12, y + 10, 24, 28, 7);
      g.fillStyle(col(0x2a4a66, d), 1).fillRoundedRect(x + 14, y + 12, 20, 24, 5.5);
      g.fillStyle(col(0x9fd8ff, d), 0.35).fillRoundedRect(x + 16, y + 14, 4, 18, 2); // glass glint
      g.fillStyle(INK, 1).fillRoundedRect(x + 16, y + 8, 16, 4, 2);
      g.lineStyle(3, INK, 1).lineBetween(x + 35, y + 30, x + 41, y + 30).lineBetween(x + 41, y + 30, x + 41, y + 34);
      g.lineStyle(1.6, col(STEEL, d), 1).lineBetween(x + 35, y + 30, x + 41, y + 30).lineBetween(x + 41, y + 30, x + 41, y + 34);
      g.fillStyle(INK, 1).fillRoundedRect(x + 37, y + 34, 9, 12, 3);
      g.fillStyle(col(0x18223f, d), 1).fillRoundedRect(x + 38.5, y + 35.5, 6, 9, 2);
      break;
    }
    case 'fab': {
      // a work bench with a circuit board, a gantry rail along the top and pins along the board's edge
      plate(g, x + 10, y + 22, 36, 22, 3, col(0x2f6b48, d));
      g.lineStyle(1.2, col(0xa8e6bf, d), 0.6);
      g.lineBetween(x + 14, y + 28, x + 26, y + 28).lineBetween(x + 26, y + 28, x + 30, y + 34).lineBetween(x + 30, y + 34, x + 42, y + 34);
      g.lineBetween(x + 14, y + 38, x + 22, y + 38).lineBetween(x + 22, y + 38, x + 22, y + 32);
      for (const [xx, yy] of [[14, 28], [42, 34], [14, 38], [22, 32]]) g.fillStyle(col(0xffc83d, d), 1).fillCircle(x + xx, y + yy, 1.4);
      for (let i = 0; i < 6; i++) g.fillStyle(INK, 0.85).fillRect(x + 13 + i * 5.5, y + 44.5, 2.5, 2.5);
      plate(g, x + 9, y + 10, 38, 5, 2, col(STEEL, d), 1.5);
      for (const xx of [11, 45]) g.fillStyle(INK, 1).fillRect(x + xx - 1, y + 14, 2.5, 9);
      break;
    }
    case 'rover': {
      // a hangar arch with a hazard sill; the Rover itself is drawn live (it leaves on trips)
      plate(g, x + 10, y + 12, 36, 30, 6, col(DARK_STEEL, d));
      g.fillStyle(INK, 1).fillRoundedRect(x + 14, y + 16, 28, 24, { tl: 10, tr: 10, bl: 1, br: 1 });
      g.fillStyle(col(0x15182a, d), 1).fillRoundedRect(x + 15.5, y + 17.5, 25, 22.5, { tl: 9, tr: 9, bl: 0, br: 0 });
      for (let i = 0; i < 5; i++) g.fillStyle(i % 2 ? INK : col(C.crit, d), 1).fillRect(x + 12 + i * 6.4, y + 42, 6.4, 3);
      rivet(g, x + 13, y + 15);
      rivet(g, x + 43, y + 15);
      break;
    }
    case 'solar': {
      // a panel grid on a hinge, with two small fins
      g.fillStyle(INK, 1).fillTriangle(x + 9, y + 20, x + 13, y + 16, x + 13, y + 36);
      g.fillStyle(INK, 1).fillTriangle(x + 47, y + 20, x + 43, y + 16, x + 43, y + 36);
      plate(g, x + 12, y + 13, 32, 26, 3, col(0x2b5fa8, d));
      g.lineStyle(1.4, col(0x9fd0ff, d), 0.75);
      for (const xx of [12 + 32 / 3, 12 + 64 / 3]) g.lineBetween(x + xx, y + 14, x + xx, y + 38);
      g.lineBetween(x + 13, y + 26, x + 43, y + 26);
      plate(g, x + 18, y + 41, 20, 4, 1.5, col(STEEL, d), 1.2);
      break;
    }
    case 'engine': {
      // intake grille (front, left), a nozzle bell toward the rear (right), heat vents
      plate(g, x + 11, y + 15, 14, 26, 3, col(DARK_STEEL, d));
      g.lineStyle(1.6, INK, 0.85);
      for (const yy of [20, 25, 30, 35]) g.lineBetween(x + 13, y + yy, x + 23, y + yy);
      g.fillStyle(INK, 1).fillPoints([{ x: x + 24, y: y + 17 }, { x: x + 44, y: y + 12 }, { x: x + 44, y: y + 44 }, { x: x + 24, y: y + 39 }], true);
      g.fillStyle(col(0x6a5a9a, d), 1).fillPoints([{ x: x + 25.5, y: y + 18.5 }, { x: x + 42.5, y: y + 14 }, { x: x + 42.5, y: y + 42 }, { x: x + 25.5, y: y + 37.5 }], true);
      g.fillStyle(col(tint(0x6a5a9a, 0.3), d), 1).fillPoints([{ x: x + 25.5, y: y + 18.5 }, { x: x + 42.5, y: y + 14 }, { x: x + 42.5, y: y + 19 }, { x: x + 25.5, y: y + 22 }], true);
      g.fillStyle(INK, 1).fillRoundedRect(x + 42, y + 13, 4, 30, 2);
      for (const xx of [28, 32, 36]) g.fillStyle(INK, 0.7).fillCircle(x + xx, y + 45.5, 1.1);
      break;
    }
    case 'winch': {
      // a big spool with flanges and a ratchet arm
      plate(g, x + 33, y + 12, 12, 5, 2, col(STEEL, d), 1.2);
      g.lineStyle(3, INK, 1).lineBetween(x + 28, y + 28, x + 40, y + 15);
      disc(g, cx, cy, 12.5, col(0x8a6a2a, d));
      g.lineStyle(2, INK, 0.9).strokeCircle(cx, cy, 8);
      for (const [dx, dy] of [[-15, -15], [15, 15]]) rivet(g, cx + dx, cy + dy);
      break;
    }
  }
}

// ---- live effects --------------------------------------------------------------------------------

const TEAL = C.beam;
const GLOW = 0xffa733;

export function drawFx(g: G, kind: ArtKind, x: number, y: number, o: FxOpts): void {
  const cx = x + S / 2, cy = y + S / 2;
  const t = o.calm ? o.t * 0.5 : o.t;
  const flash = o.calm ? 0 : o.flash;
  switch (kind) {
    case 'beam': {
      // lens: dark without power, charged teal while counting
      g.fillStyle(o.powered ? (o.working ? TEAL : tint(TEAL, -0.35)) : 0x2a3550, 1).fillCircle(cx, cy, 4.5);
      if (o.powered && o.working) {
        g.fillStyle(TEAL, 0.3 + 0.2 * Math.sin(t * 14)).fillCircle(cx, cy, 8);
        // the tractor cone reaches out past the hull; the rock grows as it is reeled in
        const L = 62, u0 = 21, ur = u0 + L * (1 - o.progress);
        polyAlong(g, cx, cy, o.dir, [[u0, -9], [u0 + L, -24], [u0 + L, 24], [u0, 9]], TEAL, 0.13);
        polyAlong(g, cx, cy, o.dir, [[u0, -3], [u0 + L, -8], [u0 + L, 8], [u0, 3]], TEAL, 0.18);
        const a = along(cx, cy, o.dir, 6, 0), r = along(cx, cy, o.dir, ur, Math.sin(t * 7) * 1.5);
        g.lineStyle(1.5, TEAL, 0.9).lineBetween(a.x, a.y, r.x, r.y);
        const rr = 3 + 6 * o.progress;
        g.fillStyle(INK, 0.9).fillCircle(r.x, r.y, rr + 1.5);
        g.fillStyle(0xa59a92, 1).fillCircle(r.x, r.y, rr);
      }
      if (flash > 0) {
        const p = along(cx, cy, o.dir, 22, 0);
        g.lineStyle(3, 0xd8cfc6, flash * 0.8).strokeCircle(p.x, p.y, 6 + 22 * (1 - flash));
        g.fillStyle(0xffffff, flash * 0.7).fillCircle(cx, cy, 6);
      }
      if (o.boosted && o.powered) sparks(g, cx, cy, 11, t);
      break;
    }
    case 'grapple': {
      // the claw: docked on the rail, shoots out, grabs, reels back with a heavy rock
      const L = 66;
      let u = 13;
      let carrying = false, open = false;
      if (o.working && o.powered) {
        const p = o.progress;
        if (p < 0.15) { u = 13 + L * (p / 0.15); open = true; } else { u = 13 + L * (1 - (p - 0.15) / 0.85); carrying = true; }
      } else if (o.working) {
        u = 13 + L * 0.5; carrying = true; // stalled without power
      }
      const sp = along(cx, cy, o.dir, -11, 0);
      const spin = o.working && o.powered ? t * (carrying ? 6 : 20) : 0;
      g.lineStyle(1.6, INK, 0.9);
      for (let i = 0; i < 3; i++) {
        const a = spin + (i * Math.PI * 2) / 3;
        g.lineBetween(sp.x, sp.y, sp.x + Math.cos(a) * 5, sp.y + Math.sin(a) * 5);
      }
      if (u > 14) {
        const wob = Math.sin(t * 9) * (carrying ? 1.5 : 0.5);
        const a = along(cx, cy, o.dir, -6, 0), b = along(cx, cy, o.dir, u - 4, wob);
        g.lineStyle(1.6, 0xc9b98a, 1).lineBetween(a.x, a.y, b.x, b.y);
      }
      claw(g, cx, cy, o.dir, u, open, carrying, o.powered);
      if (flash > 0) {
        const p = along(cx, cy, o.dir, 22, 0);
        g.lineStyle(4, 0xd8cfc6, flash * 0.9).strokeCircle(p.x, p.y, 8 + 26 * (1 - flash));
      }
      if (o.boosted && o.powered) sparks(g, cx, cy, 13, t);
      break;
    }
    case 'smasher': {
      // toothed jaws chomp while the Smasher works; one hangs loose while Rusty
      const busy = o.working && o.powered && !o.rusty;
      const gap = busy ? 3 + 7 * (0.5 + 0.5 * Math.sin(t * (7 + o.level * 2))) : 7;
      const top = cy + 2 - gap / 2, bot = cy + 2 + gap / 2;
      jaw(g, x + 13, top, 30, -1, o.powered ? STEEL : grey(STEEL), 0);
      jaw(g, x + 13, bot, 30, 1, o.powered ? STEEL : grey(STEEL), o.rusty ? 0.22 : 0);
      if (busy) {
        const n = o.calm ? 1 : 3;
        for (let i = 0; i < n; i++) {
          const ph = (t * 2.2 + i / n) % 1;
          const ang = i * 2.1 + 0.6;
          g.fillStyle(0xa59a92, 1 - ph).fillCircle(cx + Math.cos(ang) * 22 * ph, cy + 2 + Math.sin(ang) * 14 * ph - 6 * ph, 1.6);
        }
      }
      if (o.boosted && o.powered) sparks(g, cx, cy, 15, t);
      break;
    }
    case 'smelter': {
      const busy = o.working && o.powered;
      if (busy) {
        // furnace mouth glow follows the batch, smoke puffs from the chimney
        const heat = 0.45 + 0.55 * o.progress;
        g.fillStyle(tint(GLOW, -0.2 + 0.4 * o.progress), heat * (0.85 + 0.15 * Math.sin(t * 17))).fillRoundedRect(x + 20.5, y + 33, 9, 9.5, { tl: 4.5, tr: 4.5, bl: 0, br: 0 });
        g.fillStyle(0xffe08a, heat * 0.8).fillCircle(x + 25, y + 40, 2.5);
        const n = o.calm ? 1 : 3;
        for (let i = 0; i < n; i++) {
          const ph = (t * 0.55 + i / n) % 1;
          g.fillStyle(0x9aa0b0, 0.45 * (1 - ph)).fillCircle(x + 35 + Math.sin(t * 2 + i) * 2 * ph, y + 7 - ph * 20, 2.5 + 4.5 * ph);
        }
      }
      if (flash > 0) {
        // a Plate ingot slides out onto the tray
        const k = 1 - flash;
        const ix = x + 23 + 17 * Math.min(1, k * 1.6), iy = y + 37 - 2 * Math.min(1, k * 1.6);
        plate(g, ix, iy, 8, 4, 1, 0x9fb4d6, 1.2);
      }
      if (o.boosted && o.powered) sparks(g, cx, cy, 15, t);
      break;
    }
    case 'melter': {
      // ice chunks in the tank shrink with the batch, the heater coil glows, Coolant drips into the vial
      const busy = o.working && o.powered;
      const left = busy ? 1 - o.progress : 1;
      const ice = o.powered ? 0xd9f2ff : grey(0xd9f2ff);
      const cubes = [[19, 30, 4.2], [28, 31, 3.8], [23, 22.5, 3.6], [29.5, 22, 2.8]] as const;
      for (const [dx, dy, r] of cubes) {
        const rr = r * (0.35 + 0.65 * left);
        g.fillStyle(INK, 0.9).fillRoundedRect(x + dx - rr - 1.2, y + dy - rr - 1.2, 2 * rr + 2.4, 2 * rr + 2.4, 1.5);
        g.fillStyle(tint(ice, -0.12), 1).fillRoundedRect(x + dx - rr, y + dy - rr, 2 * rr, 2 * rr, 1);
        g.fillStyle(ice, 1).fillRoundedRect(x + dx - rr, y + dy - rr, 2 * rr - 1.2, 2 * rr - 1.6, 1);
        g.fillStyle(0xffffff, 0.9).fillRect(x + dx - rr + 0.8, y + dy - rr + 0.8, rr * 0.7, 1.1);
      }
      if (busy) {
        g.fillStyle(GLOW, 0.55 + 0.35 * Math.sin(t * 9)).fillRect(x + 14, y + 42.5, 20, 1.6);
        const n = o.calm ? 1 : 2;
        for (let i = 0; i < n; i++) {
          const ph = (t * 0.6 + i / n) % 1;
          g.fillStyle(0xe6ecff, 0.4 * (1 - ph)).fillCircle(x + 22 + i * 6 + Math.sin(t * 2 + i) * 2 * ph, y + 7 - ph * 16, 2 + 3 * ph);
        }
      }
      // the vial: blue Coolant level follows the batch; a drop falls when one is made
      const fill = busy ? 2 + 6 * o.progress : 2;
      g.fillStyle(o.powered ? C.power : grey(C.power), 1).fillRect(x + 38.5, y + 44.5 - fill, 6, fill);
      if (flash > 0) g.fillStyle(C.power, flash).fillCircle(x + 41.5, y + 34 + 8 * (1 - flash), 2);
      if (o.boosted && o.powered) sparks(g, cx, cy, 15, t);
      break;
    }
    case 'fab': {
      // the claw head runs along the gantry, dips to the board and solders; a Circuit pops out when one is done
      const busy = o.working && o.powered;
      const hx = busy ? x + 16 + 24 * (0.5 + 0.5 * Math.sin(t * 2.2)) : x + 28;
      const dip = busy ? 3 + 3 * Math.max(0, Math.sin(t * 6.6)) : 0;
      g.fillStyle(INK, 1).fillRect(hx - 5, y + 11, 10, 7);
      g.fillStyle(o.powered ? 0xcfd8ea : grey(0xcfd8ea), 1).fillRect(hx - 4, y + 12, 8, 5);
      g.lineStyle(2, INK, 1).lineBetween(hx, y + 17, hx, y + 22 + dip);
      g.lineStyle(2, INK, 1).lineBetween(hx - 3, y + 22 + dip, hx, y + 25 + dip).lineBetween(hx + 3, y + 22 + dip, hx, y + 25 + dip);
      if (busy && Math.sin(t * 6.6) > 0.6) {
        g.fillStyle(0xffe08a, 0.9).fillCircle(hx, y + 27 + dip, 1.8);
        if (!o.calm) g.fillStyle(0xffffff, 0.8).fillCircle(hx + 3, y + 25 + dip, 0.9).fillCircle(hx - 3, y + 26 + dip, 0.9);
      }
      // the chip being built fills in with the batch
      const w = 10 * (busy ? o.progress : 0);
      g.fillStyle(INK, 0.9).fillRect(x + 32, y + 26, 11, 7);
      if (w > 0) g.fillStyle(0x6fd08c, 1).fillRect(x + 32.5, y + 26.5, w, 6);
      if (flash > 0) {
        const k = 1 - flash;
        const yy = y + 26 - 14 * k;
        g.fillStyle(0x6fd08c, flash).fillRect(x + 34, yy, 8, 6);
        g.fillStyle(0xffffff, flash * 0.8).fillRect(x + 35, yy + 1, 2, 1.5);
      }
      if (o.boosted && o.powered) sparks(g, cx, cy, 15, t);
      break;
    }
    case 'rover': {
      const state = o.rover ?? 'home';
      if (state !== 'out') {
        // the Rover in the hangar: a small six-wheeled body with a mast light
        const by = y + 31;
        g.fillStyle(INK, 1).fillRoundedRect(x + 18, by - 6, 20, 9, 3);
        g.fillStyle(o.powered ? 0xd9a441 : grey(0xd9a441), 1).fillRoundedRect(x + 19.5, by - 4.5, 17, 6, 2);
        g.fillStyle(INK, 1).fillRect(x + 31, by - 12, 1.8, 7);
        const blink = state === 'back' ? 0.5 + 0.5 * Math.sin(t * 8) : 0.5 + 0.5 * Math.sin(t * 2);
        g.fillStyle(state === 'back' ? 0xffc83d : C.beam, o.powered ? blink : 0.2).fillCircle(x + 32, by - 13, 2);
        for (const wx of [21, 28, 35]) { g.fillStyle(INK, 1).fillCircle(x + wx, by + 4, 3); g.fillStyle(0x5c6b8a, 1).fillCircle(x + wx, by + 4, 1.6); }
        if (state === 'back') {
          // the haul: a gold crate bobbing beside it
          const bob = Math.sin(t * 4) * 1.5;
          g.fillStyle(INK, 1).fillRect(x + 37, y + 20 + bob, 8, 7);
          g.fillStyle(0xffc83d, 1).fillRect(x + 38, y + 21 + bob, 6, 5);
        }
      } else {
        // out on a trip: the hangar is empty; a trip bar fills along the sill
        g.fillStyle(INK, 0.9).fillRoundedRect(x + 16, y + 35, 24, 4, 2);
        g.fillStyle(C.beam, 1).fillRoundedRect(x + 16.5, y + 35.5, 23 * Math.max(0.05, o.progress), 3, 1.5);
        // tyre tracks leading out of the door
        for (let i = 0; i < 3; i++) g.fillStyle(0x5c6b8a, 0.5).fillRect(x + 22 + i * 5, y + 30, 2.5, 1.5);
      }
      if (o.ping) {
        const k = 0.5 + 0.5 * Math.sin(t * 10);
        g.lineStyle(3, 0xffc83d, 0.5 + 0.5 * k).strokeCircle(cx, cy, 20 + 4 * k);
        g.fillStyle(0xffc83d, 1).fillCircle(cx, y + 10, 4);
      }
      if (o.boosted && o.powered) sparks(g, cx, cy, 15, t);
      break;
    }
    case 'solar': {
      // a light sweep from cell to cell across the panel
      const cells: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]];
      const w = 32 / 3, h = 13;
      const k = (t * (o.calm ? 0.8 : 1.6)) % (cells.length + 2);
      cells.forEach(([cxi, cyi], i) => {
        const a = Math.max(0, 1 - Math.abs(k - i));
        if (a <= 0) return;
        g.fillStyle(0xd6ecff, 0.28 * a).fillRect(x + 12.5 + cxi * w, y + 13.5 + cyi * h, w - 1, h - 1);
      });
      break;
    }
    case 'engine': {
      // intake fan; a pilot light at the nozzle (flames come out of the hull's engine bells)
      const fx = x + 18, fy = y + 28;
      const speed = o.cruising && o.powered ? 16 : o.powered ? 1.5 : 0;
      g.fillStyle(INK, 1).fillCircle(fx, fy, 6.5);
      g.fillStyle(o.powered ? 0x9aa8c8 : 0x5a6274, 1);
      for (let i = 0; i < 3; i++) {
        const a = t * speed + (i * Math.PI * 2) / 3;
        g.fillTriangle(fx, fy, fx + Math.cos(a) * 6, fy + Math.sin(a) * 6, fx + Math.cos(a + 0.7) * 5, fy + Math.sin(a + 0.7) * 5);
      }
      if (o.powered) {
        const c = o.cruising ? GLOW : 0x8fd8ff;
        g.fillStyle(c, 0.6 + 0.4 * Math.sin(t * 19)).fillCircle(x + 44, y + 28, o.cruising ? 4 : 2.2);
      }
      if (flash > 0) g.fillStyle(0xffe08a, flash * 0.8).fillCircle(x + 44, y + 28, 6 + 10 * (1 - flash));
      if (o.boosted && o.powered) sparks(g, cx, cy, 15, t);
      break;
    }
    case 'winch': {
      // spokes spin while it is pulling a beam; a cable flicks toward each beam it works
      const active = o.working && o.powered;
      const a0 = active ? t * 10 : 0.4;
      g.lineStyle(2, INK, 0.9);
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i * Math.PI) / 2;
        g.lineBetween(cx, cy, cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
      }
      if (active) {
        for (const d of o.targets ?? []) {
          const v = DIR_V[d];
          const wob = Math.sin(t * 12) * 2;
          g.lineStyle(1.5, 0xc9b98a, 1).lineBetween(cx + v.x * 12, cy + v.y * 12, cx + v.x * 26 - v.y * wob, cy + v.y * 26 + v.x * wob);
        }
      }
      break;
    }
    default:
      break;
  }
}

/** A toothed jaw bar: `side` -1 has its teeth pointing down, +1 up. `tilt` rotates it (Rusty). */
function jaw(g: G, x: number, y: number, w: number, side: number, color: number, tilt: number): void {
  const yAt = (xx: number) => y + tilt * (xx - x);
  const thick = 5;
  const outer = side < 0 ? -thick : thick;
  g.fillStyle(INK, 1).fillPoints([{ x: x - 1, y: yAt(x) + outer - side }, { x: x + w + 1, y: yAt(x + w) + outer - side }, { x: x + w + 1, y: yAt(x + w) + side }, { x: x - 1, y: yAt(x) + side }], true);
  g.fillStyle(color, 1).fillPoints([{ x, y: yAt(x) + outer }, { x: x + w, y: yAt(x + w) + outer }, { x: x + w, y: yAt(x + w) }, { x, y: yAt(x) }], true);
  g.fillStyle(0xe6ecff, 1);
  for (let i = 0; i < 5; i++) {
    const tx = x + 2 + i * (w - 4) / 4.5;
    g.fillTriangle(tx, yAt(tx), tx + 5, yAt(tx + 5), tx + 2.5, yAt(tx) - side * 4);
  }
}

/** The Grapple claw at distance u along the outward axis. */
function claw(g: G, cx: number, cy: number, dir: Dir, u: number, open: boolean, carrying: boolean, powered: boolean): void {
  const metal = powered ? 0xcfd8ea : grey(0xcfd8ea);
  if (carrying) {
    const r = along(cx, cy, dir, u + 9, 0);
    g.fillStyle(INK, 1).fillCircle(r.x, r.y, 9);
    g.fillStyle(0x7d7480, 1).fillCircle(r.x, r.y, 7.5);
    g.fillStyle(0xe6f6ff, 1).fillCircle(r.x - 2, r.y - 2, 1.8).fillCircle(r.x + 3, r.y + 1, 1.4);
  }
  polyAlong(g, cx, cy, dir, [[u - 5, -5], [u + 2, -5], [u + 2, 5], [u - 5, 5]], INK);
  polyAlong(g, cx, cy, dir, [[u - 4, -4], [u + 1, -4], [u + 1, 4], [u - 4, 4]], metal);
  const spread = open ? 9 : carrying ? 8 : 4;
  for (const s of [-1, 1]) {
    polyAlong(g, cx, cy, dir, [[u, s * 3], [u + 9, s * spread], [u + 11, s * (spread - 3)], [u + 2, s * 1]], INK);
    polyAlong(g, cx, cy, dir, [[u + 1, s * 3], [u + 8.5, s * (spread - 1)], [u + 9.5, s * (spread - 2.5)], [u + 2, s * 1.6]], metal);
  }
}

/** Boost: two small blue sparks orbiting the module. */
function sparks(g: G, cx: number, cy: number, r: number, t: number): void {
  for (let i = 0; i < 2; i++) {
    const a = t * 3 + i * Math.PI;
    g.fillStyle(C.power, 0.9).fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 1.6);
  }
}

/** Label under a module's art when "Show labels" is on. */
export const ART_LABEL: Record<ArtKind, string> = {
  beam: 'Beam', grapple: 'Grapple', smasher: 'Smash', smelter: 'Smelt', solar: 'Solar', engine: 'Engine', winch: 'Winch', melter: 'Melt', fab: 'Fab', rover: 'Rover', open: 'Open',
};
