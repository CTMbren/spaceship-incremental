/**
 * Style A art kit (graphics pass, docs/graphics-pass-plan.md): the shared rules every module drawing uses.
 * 4px-ish dark outline (dark tint of the fill), flat fill, a lighter top-left rim, a darker lower shade, and a
 * frame whose material shows the level (bronze, steel, brass, gold). Pure drawing helpers, no game state.
 */
import type Phaser from 'phaser';
import { C } from '../palette';

export type G = Phaser.GameObjects.Graphics;
export type Dir = 'left' | 'right' | 'up' | 'down';
export interface Pt { x: number; y: number }

/** One tile in local units (matches shipLayout CELL). */
export const S = 56;
/** Ink: the outline colour used everywhere. */
export const INK = C.hullOutline;

/** Frame material by level 1..4: bronze, steel, brass, gold (the tier is readable by brightness too). */
export const TIER = [0xb07a45, 0x9aa8bf, 0xd8b25a, 0xffc83d] as const;

export const DIR_V: Record<Dir, Pt> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

/** Mix a colour toward black (k < 0) or white (k > 0). */
export function tint(color: number, k: number): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** Greyscale version of a colour (unpowered modules lose their colour). */
export function grey(color: number, amount = 0.75): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const m = (c: number) => Math.round(c + (l - c) * amount);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

/** A shaded plate: outline, fill, top-left rim light, lower shade. The basic building block. */
export function plate(g: G, x: number, y: number, w: number, h: number, r: number, fill: number, outline = 2): void {
  g.fillStyle(tint(fill, -0.55), 1).fillRoundedRect(x - outline, y - outline, w + 2 * outline, h + 2 * outline, r + outline);
  g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, r);
  g.fillStyle(tint(fill, -0.18), 1).fillRoundedRect(x, y + h * 0.58, w, h * 0.42, Math.min(r, h * 0.2));
  g.fillStyle(tint(fill, 0.35), 0.9).fillRoundedRect(x + 2, y + 2, Math.max(2, w * 0.6), 2.5, 1.2);
}

/** A shaded circle with outline and a small highlight. */
export function disc(g: G, cx: number, cy: number, r: number, fill: number): void {
  g.fillStyle(tint(fill, -0.55), 1).fillCircle(cx, cy, r + 2);
  g.fillStyle(fill, 1).fillCircle(cx, cy, r);
  g.fillStyle(tint(fill, -0.18), 1).fillCircle(cx + r * 0.18, cy + r * 0.22, r * 0.72);
  g.fillStyle(fill, 1).fillCircle(cx - r * 0.08, cy - r * 0.1, r * 0.68);
  g.fillStyle(tint(fill, 0.45), 0.9).fillCircle(cx - r * 0.38, cy - r * 0.38, Math.max(1.2, r * 0.18));
}

/** A small rivet. */
export function rivet(g: G, x: number, y: number, color = 0xc7d0e6): void {
  g.fillStyle(INK, 0.8).fillCircle(x, y + 0.5, 1.8);
  g.fillStyle(color, 1).fillCircle(x - 0.3, y - 0.3, 1.2);
}

/** Map a point given in a module's own frame (u = outward along `dir`, v = across) to tile coordinates. */
export function along(cx: number, cy: number, dir: Dir, u: number, v: number): Pt {
  const d = DIR_V[dir];
  return { x: cx + d.x * u - d.y * v, y: cy + d.y * u + d.x * v };
}

/** A filled polygon in a module's own frame. */
export function polyAlong(g: G, cx: number, cy: number, dir: Dir, pts: [number, number][], fill: number, alpha = 1): void {
  g.fillStyle(fill, alpha).fillPoints(pts.map(([u, v]) => along(cx, cy, dir, u, v)) as Phaser.Types.Math.Vector2Like[], true);
}

/** Alternating hazard stripes across a short bar (in the module's frame), the "dangerous end" marker. */
export function hazard(g: G, cx: number, cy: number, dir: Dir, u: number, halfW: number, depth: number): void {
  const n = 4;
  for (let i = 0; i < n; i++) {
    const v0 = -halfW + (i * 2 * halfW) / n, v1 = v0 + (2 * halfW) / n;
    polyAlong(g, cx, cy, dir, [[u, v0], [u, v1], [u + depth, v1], [u + depth, v0]], i % 2 ? INK : C.crit);
  }
}

/** The module tile: deck-coloured face with a frame whose material shows the level. */
export function frame(g: G, x: number, y: number, face: number, level: number): void {
  const t = TIER[Math.max(0, Math.min(TIER.length - 1, level - 1))];
  g.fillStyle(INK, 1).fillRoundedRect(x + 4, y + 4, S - 8, S - 8, 10);
  g.fillStyle(t, 1).fillRoundedRect(x + 5.5, y + 5.5, S - 11, S - 11, 9);
  g.fillStyle(tint(t, 0.4), 1).fillRoundedRect(x + 7, y + 6.5, S - 22, 2, 1);
  g.fillStyle(face, 1).fillRoundedRect(x + 8.5, y + 8.5, S - 17, S - 17, 7);
  g.fillStyle(tint(face, -0.25), 1).fillRoundedRect(x + 8.5, y + S - 20, S - 17, 11.5, 7);
}
