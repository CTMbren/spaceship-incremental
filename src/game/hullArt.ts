import type Phaser from 'phaser';
import { C } from './palette';
import { CELL as S, edgeRuns, key, toScreen, type Cell, type EdgeRun, type ScreenCell } from './shipLayout';

type G = Phaser.GameObjects.Graphics;
type Pt = { x: number; y: number };

const OUT = 9; // outline thickness around a tile
const IN = 5; // outline-to-fill inset
const ACCENT = 0xf0704a; // warm tug orange
/** Gold trim, the Fleet Partner rank reward (Day 9). */
export const GOLD_TRIM = 0xffc83d;
let accent = ACCENT; // set per draw (render-only state)

/** Where the live exterior effects go (graphics pass G4): nav lights, beacon, thruster exits, nose decal. */
export interface ExteriorInfo {
  lights: { x: number; y: number; color: number }[];
  bells: { x: number; y: number }[];
  beacon: { x: number; y: number } | null;
  decal: { x: number; y: number } | null;
}
let info: ExteriorInfo = { lights: [], bells: [], beacon: null, decal: null };
const PORT = 0xff5a5f; // red, top side (the ship points left)
const STARBOARD = 0x4ade80; // green, bottom side

const grow = (pts: Pt[], k: number): Pt[] => {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  return pts.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
};

/** Outlined flat shape: dark outline (grown), then fill. */
function shape(g: G, pts: Pt[], fill: number, outlineK = 1.16): void {
  g.fillStyle(C.hullOutline, 1).fillPoints(grow(pts, outlineK) as Phaser.Types.Math.Vector2Like[], true);
  g.fillStyle(fill, 1).fillPoints(pts as Phaser.Types.Math.Vector2Like[], true);
}

/**
 * Draws the exterior of the ship in local units (S = 56 per tile): fins, nose cone, engine bells, a
 * seam-free hull body, rim light, an orange accent stripe and rivets. Everything is derived from the
 * set of owned cells, so the silhouette changes as tiles are bought.
 *
 * `finished` is the screen-cell set of the finished hull; fins only go where it ends. `ghosts` are the screen
 * cells of the buyable tiles shown beside the hull; no engine bell is drawn under one.
 */
export function drawHullExterior(g: G, owned: Cell[], finished: Set<string>, ghosts: Set<string> = new Set(), trim: number = ACCENT): ExteriorInfo {
  accent = trim;
  info = { lights: [], bells: [], beacon: null, decal: null };
  const cells: ScreenCell[] = owned.map(toScreen);
  const set = new Set(cells.map(key));
  const has = (col: number, row: number) => set.has(`${col},${row}`);
  const runs = edgeRuns(cells);
  const minCol = Math.min(...cells.map((c) => c.col));

  // ---- appendages, drawn first so the body overlaps their roots ---------------------------------
  // Fins only where the finished hull also ends (no fin hangs where a future tile will go).
  for (const r of runs) {
    if (r.side !== 'top' && r.side !== 'bottom') continue;
    const dr = r.side === 'top' ? -1 : 1;
    const ends: number[] = [];
    for (let col = r.start; col <= r.end; col++) if (!finished.has(`${col},${r.line + dr}`)) ends.push(col);
    let a = 0;
    for (let i = 1; i <= ends.length; i++) {
      if (i === ends.length || ends[i] !== ends[i - 1] + 1) {
        if (ends.length) fin(g, { ...r, start: ends[a], end: ends[i - 1] });
        a = i;
      }
    }
  }
  for (const r of runs) {
    if (r.side === 'left') nose(g, r, r.line === minCol);
    if (r.side === 'right') engines(g, r, ghosts);
  }

  // ---- body: outline union, fill union (bridges hide the seams between tiles) -------------------
  const body = (pad: number, radius: number, color: number) => {
    g.fillStyle(color, 1);
    for (const c of cells) {
      g.fillRoundedRect(c.col * S - pad, c.row * S - pad, S + 2 * pad, S + 2 * pad, radius);
    }
    for (const c of cells) {
      if (has(c.col + 1, c.row)) g.fillRect(c.col * S + S - 22, c.row * S - pad, 44, S + 2 * pad);
      if (has(c.col, c.row + 1)) g.fillRect(c.col * S - pad, c.row * S + S - 22, S + 2 * pad, 44);
      // fill the inner corner of a 2x2 block
      if (has(c.col + 1, c.row) && has(c.col, c.row + 1) && has(c.col + 1, c.row + 1)) {
        g.fillRect(c.col * S + S - 22, c.row * S + S - 22, 44, 44);
      }
    }
  };
  body(OUT, 18, C.hullOutline);
  body(OUT - IN, 14, C.hull);

  // ---- rim light, accent stripe and rivets on exposed edges -----------------------------------
  for (const r of runs) {
    const along = (i: number) => i * S;
    if (r.side === 'top') {
      const x = along(r.start) + 8, w = (r.end - r.start + 1) * S - 16, y = r.line * S;
      g.fillStyle(C.hullRim, 1).fillRoundedRect(x, y - 4, w, 4, 2);
      g.fillStyle(accent, 1).fillRoundedRect(x, y + 1, w, 4, 2);
      rivets(g, x, y - 1, w, true);
    } else if (r.side === 'bottom') {
      const x = along(r.start) + 8, w = (r.end - r.start + 1) * S - 16, y = (r.line + 1) * S;
      g.fillStyle(accent, 1).fillRoundedRect(x, y - 5, w, 4, 2);
      rivets(g, x, y + 1, w, true);
    } else if (r.side === 'left') {
      const y = along(r.start) + 8, h = (r.end - r.start + 1) * S - 16, x = r.line * S;
      g.fillStyle(C.hullRim, 1).fillRoundedRect(x - 4, y, 4, h, 2);
    }
  }

  // ---- plating: vent slots on long top edges, a white beacon on the highest one ------------------
  let topMost: EdgeRun | null = null;
  for (const r of runs) {
    if (r.side !== 'top') continue;
    if (!topMost || r.line < topMost.line || (r.line === topMost.line && r.end - r.start > topMost.end - topMost.start)) topMost = r;
    const len = r.end - r.start + 1;
    if (len >= 2) {
      const vx = r.start * S + S - 6;
      for (let i = 0; i < 3; i++) g.fillStyle(C.hullOutline, 0.7).fillRoundedRect(vx + i * 5, r.line * S - 8, 2.5, 6, 1);
    }
  }
  if (topMost) info.beacon = { x: ((topMost.start + topMost.end + 1) / 2) * S, y: topMost.line * S - 6 };
  // a light whose fin tip is tucked behind a tile would shine through the hull: drop it
  info.lights = info.lights.filter((l) => !has(Math.floor(l.x / S), Math.floor(l.y / S)));
  return info;
}

function rivets(g: G, x: number, y: number, w: number, horizontal: boolean): void {
  if (!horizontal) return;
  const n = Math.max(2, Math.floor(w / 28));
  g.fillStyle(C.hullOutline, 0.55);
  for (let i = 0; i < n; i++) g.fillCircle(x + 6 + (i * (w - 12)) / (n - 1), y, 1.8);
}

/** Swept fin on a run of exposed top or bottom edges, tip pointing toward the rear (right). */
function fin(g: G, r: EdgeRun): void {
  const len = r.end - r.start + 1;
  const h = Math.min(24, 10 + 5 * len); // how far it sticks out
  const x0 = r.start * S + 14;
  const x1 = (r.end + 1) * S - 2;
  const tipX = x1 + 16;
  const edge = r.side === 'top' ? r.line * S - 2 : (r.line + 1) * S + 2;
  const dir = r.side === 'top' ? -1 : 1;
  const pts: Pt[] = [
    { x: x0, y: edge },
    { x: x1, y: edge },
    { x: tipX, y: edge + dir * h },
    { x: x0 + 12, y: edge + dir * h * 0.55 },
  ];
  shape(g, pts, C.hull, 1.12);
  // lower shade, panel seam and vent slots
  g.fillStyle(0x6a7894, 1).fillPoints([{ x: x0 + 12, y: edge + dir * h * 0.55 }, { x: tipX, y: edge + dir * h }, { x: x1 - 4, y: edge + dir * h * 0.72 }, { x: x0 + 16, y: edge + dir * h * 0.6 }], true);
  g.lineStyle(1.2, C.hullOutline, 0.55).lineBetween(x0 + 10, edge + dir * h * 0.3, x1, edge + dir * h * 0.3);
  for (let i = 0; i < 3; i++) g.fillStyle(C.hullOutline, 0.6).fillRoundedRect(x0 + 18 + i * 6, edge + dir * (h * 0.15) - 1.5, 3.5, 3, 1);
  // accent tip
  g.fillStyle(accent, 1).fillTriangle(tipX, edge + dir * h, x1 - 6, edge + dir * h * 0.62, x1 + 2, edge + dir * h * 0.3);
  info.lights.push({ x: tipX - 3, y: edge + dir * (h - 3), color: r.side === 'top' ? PORT : STARBOARD });
  // the tug number goes on the first long top fin
  if (!info.decal && r.side === 'top' && len >= 2) info.decal = { x: x0 + (x1 - x0) * 0.5, y: edge + dir * h * 0.32 };
}

/** Pointed nose on the leading column, small chamfered shoulders elsewhere. */
function nose(g: G, r: EdgeRun, leading: boolean): void {
  const top = r.start * S + 2, bottom = (r.end + 1) * S - 2;
  const mid = (top + bottom) / 2;
  const x = r.line * S;
  if (leading) {
    const tip = 30 + Math.min(10, (r.end - r.start) * 6);
    const pts: Pt[] = [
      { x: x + 2, y: top },
      { x: x - tip * 0.55, y: top + (bottom - top) * 0.2 },
      { x: x - tip, y: mid },
      { x: x - tip * 0.55, y: bottom - (bottom - top) * 0.2 },
      { x: x + 2, y: bottom },
    ];
    shape(g, pts, C.hull, 1.1);
    // canopy glass
    const ch = Math.min(26, (bottom - top) * 0.42);
    g.fillStyle(C.hullOutline, 1).fillRoundedRect(x - tip * 0.62, mid - ch / 2 - 2, tip * 0.7, ch + 4, 8);
    g.fillStyle(C.beam, 0.85).fillRoundedRect(x - tip * 0.62 + 2, mid - ch / 2, tip * 0.7 - 4, ch, 6);
    g.fillStyle(C.highlight, 0.7).fillRoundedRect(x - tip * 0.62 + 5, mid - ch / 2 + 3, tip * 0.7 - 12, 4, 2);
    g.fillStyle(accent, 1).fillCircle(x - tip + 3, mid, 3);
    // panel seams on the cone, and the tug number below the canopy
    g.lineStyle(1.2, C.hullOutline, 0.5);
    g.lineBetween(x - tip * 0.55, top + (bottom - top) * 0.2 + 3, x - 4, top + 6);
    g.lineBetween(x - tip * 0.55, bottom - (bottom - top) * 0.2 - 3, x - 4, bottom - 6);
    void ch;
  } else {
    const d = 12;
    const pts: Pt[] = [
      { x: x + 2, y: top },
      { x: x - d, y: mid - 2 },
      { x: x - d, y: mid + 2 },
      { x: x + 2, y: bottom },
    ];
    shape(g, pts, C.hull, 1.12);
  }
}

/** One engine bell per exposed rear cell. It disappears behind the next tile when the hull grows. */
function engines(g: G, r: EdgeRun, ghosts: Set<string>): void {
  for (let row = r.start; row <= r.end; row++) {
    if (ghosts.has(`${r.line + 1},${row}`)) continue; // a ghost tile (buy slot) sits there
    const x = (r.line + 1) * S - 2;
    const cy = row * S + S / 2;
    const pts: Pt[] = [
      { x, y: cy - 14 },
      { x: x + 18, y: cy - 20 },
      { x: x + 18, y: cy + 20 },
      { x, y: cy + 14 },
    ];
    shape(g, pts, 0x3a4668, 1.14);
    // hazard band on the bell housing, then the nozzle ring
    for (let i = 0; i < 4; i++) {
      g.fillStyle(i % 2 ? C.hullOutline : C.crit, 1).fillPoints([
        { x: x + 4 + i * 3, y: cy - 15 - i * 0.6 }, { x: x + 7 + i * 3, y: cy - 15.5 - i * 0.6 }, { x: x + 7 + i * 3, y: cy - 12 }, { x: x + 4 + i * 3, y: cy - 12 },
      ], true);
    }
    g.fillStyle(0x2a3350, 1).fillRoundedRect(x + 15, cy - 19, 5, 38, 2);
    g.fillStyle(0x8fa0be, 1).fillRoundedRect(x + 16, cy - 18, 2, 36, 1);
    g.fillStyle(C.beam, 0.35).fillRoundedRect(x + 18, cy - 11, 8, 22, 4);
    info.bells.push({ x: x + 20, y: cy });
  }
}
