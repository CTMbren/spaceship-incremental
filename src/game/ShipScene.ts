import Phaser from 'phaser';
import { buyTile, canAfford } from '../core/actions';
import { costText, currentGoal } from '../core/goals';
import { cellKey, nextTileCost, parseKey, unlockableCells } from '../core/hull';
import {
  canSend, handStats, holdCrush, nextBeamUpgrade, nextHandUpgrade, nextSmasherUpgrade, nextSmelterUpgrade,
  releaseHold, repairSmasher, sellAll, sendToSmasher, smasherQueueCap, tapAllBeams, tapBeam, tapCrush, tick,
  toggleSmelter, upgradeBeam, upgradeHand, upgradeSmasher, upgradeSmelter, weakActive,
} from '../core/loop';
import { freeCells, freeEdgeCells, isEdgeCell, moduleCost, placeModule } from '../core/modules';
import { applyOffline, stamp, type OfflineReport } from '../core/offline';
import { SELLABLE, sellValue } from '../core/reserve';
import { readyUpgrades } from '../core/upgrades';
import { loadFromStorage, saveToStorage } from '../core/save';
import { createInitialState } from '../core/state';
import type { Cell, Cost, GameEvent, GameState, ModuleId } from '../core/types';
import { BAL } from '../data/balance';
import { BEAM, MODULES, SMELTER } from '../data/modules';
import { HAND } from '../data/hand';
import { SMASHER } from '../data/smasher';
import { HULLS } from '../data/hulls';
import { drawHullExterior } from './hullArt';
import { C, FONT, T } from './palette';
import {
  arrowsFor, boundsOf, CELL, clampPan, localPos, panLimits, panToShow, toScreen, VIEW, ZOOM,
  type PanLimits,
} from './shipLayout';

export const W = 390;
export const H = 844;
/** Render at the device pixel ratio (capped) so text and shapes stay sharp on retina phones. */
export const DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
const TILE = CELL; // local tile size; the ship container is scaled by ZOOM on screen
const PAN_SPEED = 420; // px per second while an arrow is held
const MAX_GHOSTS = 4;
const STAGE = { x: 16, y: 466, w: 358, h: 184, cx: 195, cy: 556, r: 60 };
const STRIP_Y = 660;
const ACTION = { y: 706, h: 46 };

const SMELTER_COLOR = 0xb4552f;

type SheetRow =
  | { t: 'text'; text: string; color?: string }
  | { t: 'button'; label: string; fn: () => void }
  | { t: 'card'; title: string; sub: string; verb: string; cost: string; can: boolean; fn: () => void };

export class ShipScene extends Phaser.Scene {
  private state!: GameState;
  private layer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private toast?: Phaser.GameObjects.Text;
  private debug = new URLSearchParams(window.location.search).has('debug');
  private dyn!: Phaser.GameObjects.Graphics;
  private ship!: Phaser.GameObjects.Container; // zoomed, panned, clipped to VIEW
  private dynShip!: Phaser.GameObjects.Graphics; // per-frame overlays in ship (local) space
  private limits!: PanLimits;
  private pan = { x: 0, y: 0 };
  private panGoal = { x: 0, y: 0 };
  private panDir = { x: 0, y: 0 };
  private arrowZones: Partial<Record<'left' | 'right' | 'up' | 'down', Phaser.GameObjects.Zone>> = {};
  private tx!: Record<'stage' | 'fire' | 'sell' | 'heat' | 'bay' | 'hp' | 'send' | 'smash', Phaser.GameObjects.Text>;
  private shipLabels: Phaser.GameObjects.Text[] = []; // pooled tile labels inside the zoomed ship (beams 0-2, Smelter 3)
  private sheetBuild?: () => { title: string; rows: SheetRow[] };
  private sheetKind = '';
  private sheetScroll = 0;
  private holdPointer: Phaser.Input.Pointer | null = null;
  private sheet?: Phaser.GameObjects.Container;
  private forceGeode = false;
  private shake = 0;
  private saveTimer = 0;
  private elapsed = 0;

  constructor() {
    super('Ship');
  }

  create(): void {
    this.state = loadFromStorage();
    const cam = this.cameras.main;
    cam.setBackgroundColor(C.space);
    // The canvas is W*DPR x H*DPR; zoom so the 390x844 world fills it exactly.
    cam.setZoom(DPR);
    cam.setScroll(-(W * DPR - W) / 2, -(H * DPR - H) / 2);
    this.drawStars();
    this.ship = this.add.container(0, 0).setScale(ZOOM);
    this.layer = this.add.container(0, 0);
    this.dynShip = this.add.graphics();
    this.ship.add([this.layer, this.dynShip]);
    const clip = this.make.graphics({ x: 0, y: 0 }, false);
    clip.fillStyle(0xffffff, 1).fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    this.ship.setMask(clip.createGeometryMask());
    this.hud = this.add.container(0, 0);
    this.buildDynamic();
    this.updateLimits(true);
    this.redraw();
    if (this.debug) (window as unknown as { __ship: ShipScene }).__ship = this; // for scripted tests
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.endHold();
        this.persist(); // stamps "last seen" so the time away can be counted
      } else {
        this.catchUp(); // iOS freezes the page in the background, so catch up when it wakes
      }
    });
    this.catchUp();
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.25); // long gaps are offline progress (Day 4), not one big tick
    this.elapsed += dt;
    const out = tick(this.state, dt, this.forceGeode);
    this.state = out.state;
    this.handleEvents(out.events, W / 2, STAGE.cy);
    this.afterEvents(out.events);
    this.updateHold(dt);
    this.updatePan(dt);
    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      this.persist();
    }
    this.drawDynamic();
  }

  /** Static layer (HUD numbers, goal chip) only needs a rebuild when Ore or credits change. */
  private afterEvents(events: GameEvent[]): void {
    if (events.some((e) => e.kind === 'crushed' || e.kind === 'smashed' || e.kind === 'smelted')) this.redraw();
  }

  private updateHold(dt: number): void {
    const p = this.holdPointer;
    if (!p) return;
    if (!p.isDown || this.state.crusher.lockout > 0 || !this.state.crusher.rock) {
      this.endHold();
      return;
    }
    const nx = (p.worldX - STAGE.cx) / STAGE.r;
    const ny = (p.worldY - STAGE.cy) / STAGE.r;
    if (Math.hypot(nx, ny) * STAGE.r > STAGE.r + BAL.hold.slack) {
      this.endHold(); // finger drifted off the rock
      return;
    }
    const out = holdCrush(this.state, dt, nx, ny);
    this.state = out.state;
    this.handleEvents(out.events, p.worldX, p.worldY);
    this.afterEvents(out.events);
  }

  private endHold(): void {
    this.holdPointer = null;
    this.state = releaseHold(this.state).state;
  }

  /** Save, stamping the time so a later visit knows how long the player was away. */
  private persist(): void {
    this.state = stamp(this.state, Date.now());
    saveToStorage(this.state);
  }

  /** Count the time since the game was last seen (offline catch-up) and greet the player. */
  private catchUp(): void {
    const r = applyOffline(this.state, Date.now());
    this.state = r.state;
    saveToStorage(this.state);
    if (!r.report) return;
    this.redraw();
    this.showWelcomeBack(r.report);
  }

  /** Debug only: pretend the player was away for `sec` seconds. */
  debugAway(sec: number): void {
    this.state = { ...this.state, savedAt: Date.now() - sec * 1000 };
    this.catchUp();
  }

  private showWelcomeBack(r: OfflineReport): void {
    const dur = (sec: number): string => {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
    };
    const names: Record<string, string> = { ore: 'Ore', ice: 'Ice', plate: 'Plate', coolant: 'Coolant', circuit: 'Circuit', core_shard: 'Shard' };
    const gains = Object.entries(r.items).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${(v ?? 0) > 0 ? '+' : ''}${Math.round(v ?? 0)} ${names[k]}`);
    this.showSheet('welcome', () => {
      const rows: SheetRow[] = [{ t: 'text', text: `You were away ${dur(r.awaySec)}.${r.capped ? ' Time away counts up to 8 hours.' : ''}`, color: T.text }];
      if (r.rocksSmashed > 0 || gains.length > 0) {
        const parts = [r.rocksSmashed > 0 ? `The Smasher cleared ${r.rocksSmashed} rocks.` : '', gains.join(' · ')].filter(Boolean);
        rows.push({ t: 'text', text: parts.join(' '), color: T.gold });
      }
      if (r.smasherRusty) rows.push({ t: 'text', text: 'Repair the Smasher and your ship keeps working while you are away.' });
      else if (r.geodeWaiting) rows.push({ t: 'text', text: 'A geode is waiting in the stage. Only your hands can crack it, and it holds up the beams until you do.' });
      else if (r.rocksSmashed === 0 && gains.length === 0) rows.push({ t: 'text', text: 'Nothing happened while you were away. Fire the beams to give the Smasher rocks.' });
      rows.push({ t: 'text', text: 'While you are away the ship works at 30% for the first 2 hours, then 10%, up to 8 hours. Nothing is sold for you.' });
      rows.push({ t: 'button', label: 'Back to work', fn: () => this.closeSheet() });
      return { title: 'Welcome back', rows };
    });
  }

  private txt(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { ...style, resolution: DPR });
  }

  // ---- state -------------------------------------------------------------
  private apply(next: GameState): void {
    this.state = next;
    this.persist();
    this.redraw();
  }

  private tryBuy(cell: Cell): void {
    const res = buyTile(this.state, cell);
    if (res.ok) {
      this.apply(res.state);
      this.focusCell(cell);
      return;
    }
    const msg: Record<string, string> = {
      need_credits: 'Not enough credits',
      need_items: 'Not enough materials',
      hull_full: 'Hull complete',
      not_unlockable: 'Cannot build there',
      unknown_hull: 'Unknown hull',
    };
    this.showToast(msg[res.reason]);
  }

  // ---- drawing -----------------------------------------------------------
  private redraw(): void {
    this.layer.removeAll(true);
    this.hud.removeAll(true);
    this.updateLimits(false);
    this.drawHull();
    this.drawGhosts();
    this.drawHud();
    this.drawTabs();
  }

  // ---- ship camera: zoom, pan and the scroll arrows ---------------------------------------------
  private ghostCells(): Cell[] {
    const def = HULLS[this.state.ship.hullId];
    const owned = new Set(this.state.ship.ownedCells);
    if (!nextTileCost(def, owned.size)) return [];
    return unlockableCells(def, owned)
      .sort((a, b) => Math.abs(a.x - 2) + a.y - (Math.abs(b.x - 2) + b.y))
      .slice(0, MAX_GHOSTS);
  }

  /** Recompute scroll limits from the owned tiles and ghost tiles; `first` also sets the starting pan. */
  private updateLimits(first: boolean): void {
    this.limits = panLimits(boundsOf(this.state.ship.ownedCells.map(parseKey), this.ghostCells()));
    const l = this.limits;
    if (first) {
      this.panGoal = { x: l.fitsX ? l.minX : l.maxX, y: l.fitsY ? l.minY : (l.minY + l.maxY) / 2 };
      this.pan = { ...this.panGoal };
      this.ship.setPosition(this.pan.x, this.pan.y);
    } else {
      this.panGoal = clampPan(this.panGoal, l);
    }
  }

  private updatePan(dt: number): void {
    if (this.panDir.x || this.panDir.y) {
      this.panGoal = clampPan(
        { x: this.panGoal.x + this.panDir.x * PAN_SPEED * dt, y: this.panGoal.y + this.panDir.y * PAN_SPEED * dt },
        this.limits,
      );
    }
    const k = Math.min(1, dt * 10);
    this.pan.x += (this.panGoal.x - this.pan.x) * k;
    this.pan.y += (this.panGoal.y - this.pan.y) * k;
    this.ship.setPosition(this.pan.x, this.pan.y);
  }

  /** Scroll so a (newly bought) tile is visible. */
  private focusCell(c: Cell): void {
    this.panGoal = panToShow(this.panGoal, c, this.limits);
  }

  /** World (screen) position of the centre of a template cell, following the current pan. */
  private cellWorld(c: Cell): { x: number; y: number } {
    const p = localPos(c);
    return { x: this.pan.x + (p.x + TILE / 2) * ZOOM, y: this.pan.y + (p.y + TILE / 2) * ZOOM };
  }

  private inView(p: Phaser.Input.Pointer): boolean {
    return p.worldX >= VIEW.x && p.worldX < VIEW.x + VIEW.w && p.worldY >= VIEW.y && p.worldY < VIEW.y + VIEW.h;
  }

  /** Text that lives inside the zoomed ship container: rasterise at DPR * ZOOM so it stays sharp. */
  private shipTxt(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { ...style, resolution: DPR * ZOOM });
  }

  private arrowRects(): Record<'left' | 'right' | 'up' | 'down', { x: number; y: number; w: number; h: number }> {
    const cy = VIEW.y + VIEW.h / 2, cx = VIEW.x + VIEW.w / 2;
    return {
      left: { x: 4, y: cy - 30, w: 36, h: 60 },
      right: { x: VIEW.w - 40, y: cy - 30, w: 36, h: 60 },
      up: { x: cx - 30, y: VIEW.y + 4, w: 60, h: 36 },
      down: { x: cx - 30, y: VIEW.y + VIEW.h - 40, w: 60, h: 36 },
    };
  }

  private drawArrows(g: Phaser.GameObjects.Graphics): void {
    const a = arrowsFor(this.pan, this.limits);
    const r = this.arrowRects();
    const pulse = 0.75 + 0.25 * Math.sin(this.elapsed * 4);
    (['left', 'right', 'up', 'down'] as const).forEach((k) => {
      const z = this.arrowZones[k];
      if (z?.input && z.input.enabled !== a[k]) z.input.enabled = a[k]; // hidden arrows must not eat taps
      if (!a[k]) return;
      const { x, y, w, h } = r[k];
      g.fillStyle(C.panel, 0.9).fillRoundedRect(x, y, w, h, 16);
      g.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(x, y, w, h, 16);
      const cx = x + w / 2, cy = y + h / 2;
      g.fillStyle(C.highlight, pulse);
      if (k === 'left') g.fillTriangle(cx + 6, cy - 12, cx + 6, cy + 12, cx - 8, cy);
      if (k === 'right') g.fillTriangle(cx - 6, cy - 12, cx - 6, cy + 12, cx + 8, cy);
      if (k === 'up') g.fillTriangle(cx - 12, cy + 6, cx + 12, cy + 6, cx, cy - 8);
      if (k === 'down') g.fillTriangle(cx - 12, cy - 6, cx + 12, cy - 6, cx, cy + 8);
    });
  }

  private px(c: Cell): { x: number; y: number } {
    return localPos(c);
  }

  /** Ship exterior (silhouette, nose, fins, engines) plus the module placeholders on the start tiles. */
  private drawHull(): void {
    const ownedKeys = this.state.ship.ownedCells;
    const owned = ownedKeys.map(parseKey);
    const g = this.add.graphics();
    this.layer.add(g);
    const finished = new Set(HULLS[this.state.ship.hullId].template.map((c) => `${toScreen(c).col},${toScreen(c).row}`));
    drawHullExterior(g, owned, finished, new Set(this.ghostCells().map((c) => `${toScreen(c).col},${toScreen(c).row}`)));
    for (const c of owned) {
      const { x, y } = this.px(c);
      g.fillStyle(C.deck, 1).fillRoundedRect(x + 2, y + 2, TILE - 4, TILE - 4, 8);
      g.lineStyle(2, C.deckEdge, 1).strokeRoundedRect(x + 2, y + 2, TILE - 4, TILE - 4, 8);
    }

    // modules from the saved state; empty owned tiles are 'Open' and tap through to the Build sheet
    const mods = this.state.ship.modules;
    const byCell = new Map(mods.map((m) => [m.cell, m]));
    const beamMods = mods.filter((m) => m.defId === 'beam');
    const hitZone = (c: Cell, fn: () => void) => {
      const p = this.px(c);
      const z = this.add.zone(p.x + TILE / 2, p.y + TILE / 2, TILE, TILE).setInteractive();
      z.on('pointerdown', (ptr: Phaser.Input.Pointer) => { if (this.inView(ptr)) fn(); });
      this.layer.add(z);
    };
    for (const c of owned) {
      const key = cellKey(c);
      const m = byCell.get(key);
      if (!m) {
        this.placeholder(owned, c, 0x18223f, 'Open', true);
        hitZone(c, () => this.showBuildSheet(key));
      } else if (m.defId === 'beam') {
        const i = beamMods.indexOf(m);
        this.placeholder(owned, c, C.beamDeep, '');
        hitZone(c, () => this.onBeamTap(i));
      } else if (m.defId === 'smasher') {
        const rusty = !this.state.smasher.repaired;
        this.placeholder(owned, c, rusty ? 0x6b5648 : C.crusher, rusty ? 'Rusty' : 'Smash');
        hitZone(c, () => this.showSmasherSheet());
      } else if (m.defId === 'smelter') {
        this.placeholder(owned, c, SMELTER_COLOR, 'Smelt');
        hitZone(c, () => this.showSmelterSheet());
      }
    }
  }

  private placeholder(owned: Cell[], cell: Cell, color: number, label: string, outline = false): void {
    if (!owned.some((o) => cellKey(o) === cellKey(cell))) return;
    const { x, y } = this.px(cell);
    const g = this.add.graphics();
    g.fillStyle(color, 1).fillRoundedRect(x + 7, y + 7, TILE - 14, TILE - 14, 8);
    if (outline) g.lineStyle(2, C.beam, 0.9).strokeRoundedRect(x + 7, y + 7, TILE - 14, TILE - 14, 8);
    const t = this.shipTxt(x + TILE / 2, y + TILE / 2, label, { fontFamily: FONT, fontSize: '12px', color: T.text }).setOrigin(0.5);
    this.layer.add([g, t]);
  }

  private drawGhosts(): void {
    const def = HULLS[this.state.ship.hullId];
    const cost = nextTileCost(def, this.state.ship.ownedCells.length);
    if (!cost) return;
    const ok = canAfford(this.state, cost) === 'ok';
    for (const c of this.ghostCells()) {
      const { x, y } = this.px(c);
      const g = this.add.graphics();
      this.dashedRect(g, x + 3, y + 3, TILE - 6, TILE - 6, ok ? C.crit : C.ghost);
      const label = this
        .shipTxt(x + TILE / 2, y + TILE / 2, String(cost.credits), {
          fontFamily: FONT, fontSize: '15px', fontStyle: '600', color: ok ? T.gold : T.dim,
        })
        .setOrigin(0.5);
      const hit = this.add.zone(x + TILE / 2, y + TILE / 2, 56, 56).setInteractive({ useHandCursor: true });
      hit.on('pointerup', (p: Phaser.Input.Pointer) => { if (this.inView(p)) this.tryBuy(c); });
      this.layer.add([g, label, hit]);
    }
  }

  private dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number): void {
    g.lineStyle(2, color, 0.9);
    const dash = 6, gap = 5;
    const seg = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
      for (let d = 0; d < len; d += dash + gap) {
        const e = Math.min(d + dash, len);
        g.lineBetween(x1 + dx * d, y1 + dy * d, x1 + dx * e, y1 + dy * e);
      }
    };
    seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y);
  }

  private drawHud(): void {
    const st = this.state;
    const pill = this.add.graphics();
    pill.fillStyle(C.panel, 1).fillRoundedRect(16, 14, 140, 40, 20);
    pill.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(16, 14, 140, 40, 20);
    pill.fillStyle(C.crit, 1).fillCircle(40, 34, 10);
    const credits = this.txt(60, 34, String(Math.floor(st.credits)), {
      fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: T.text,
    }).setOrigin(0, 0.5);
    this.hud.add([pill, credits]);

    // Ore pill appears after the first rock (progressive reveal)
    if (st.stats.rocks > 0 || st.items.ore > 0) {
      const o = this.add.graphics();
      o.fillStyle(C.panel, 1).fillRoundedRect(166, 14, 104, 40, 20);
      o.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(166, 14, 104, 40, 20);
      o.fillStyle(0xa9937c, 1).fillCircle(190, 34, 9);
      const ore = this.txt(206, 34, String(Math.floor(st.items.ore)), {
        fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: T.text,
      }).setOrigin(0, 0.5);
      this.hud.add([o, ore]);
    }

    // Plate pill appears with the first Plate (progressive reveal)
    if (st.stats.smelted > 0 || st.items.plate > 0) {
      const o = this.add.graphics();
      o.fillStyle(C.panel, 1).fillRoundedRect(280, 14, 94, 40, 20);
      o.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(280, 14, 94, 40, 20);
      o.fillStyle(0x9fb4d6, 1).fillRoundedRect(292, 25, 18, 18, 4);
      const pl = this.txt(318, 34, String(Math.floor(st.items.plate)), {
        fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: T.text,
      }).setOrigin(0, 0.5);
      this.hud.add([o, pl]);
    }

    const def = HULLS[st.ship.hullId];
    const next = nextTileCost(def, st.ship.ownedCells.length);
    const goal = currentGoal(st);
    const chipText = goal
      ? `Next: ${goal.text}`
      : next ? `Next: Expand hull · ${costText(next)}` : 'Hull complete';
    const chip = this.add.graphics();
    chip.fillStyle(C.panel, 1).fillRoundedRect(16, 66, 358, 44, 22);
    chip.lineStyle(3, goal ? C.crit : C.panelEdge, 1).strokeRoundedRect(16, 66, 358, 44, 22);
    const chipLabel = this.txt(W / 2, 88, chipText, {
      fontFamily: FONT, fontSize: '15px', color: T.text, fixedWidth: 330, align: 'center',
    }).setOrigin(0.5);
    this.hud.add([chip, chipLabel]);

    if (!st.flags.tappedBeam) {
      const bw = this.cellWorld(this.moduleCell('beam', 0) ?? { x: 2, y: 0 });
      const bx = bw.x;
      const top = bw.y - 28 * ZOOM - 8 - 26 - 14; // above the nose tile (and its canopy)
      const b = this.add.graphics();
      b.fillStyle(C.highlight, 1).fillRoundedRect(bx - 62, top, 124, 26, 13);
      b.fillTriangle(bx - 7, top + 25, bx + 7, top + 25, bx, top + 33);
      const bt = this.txt(bx, top + 13, 'Tap the beam.', { fontFamily: FONT, fontSize: '14px', fontStyle: '600', color: '#0B1020' }).setOrigin(0.5);
      this.hud.add([b, bt]);
    }

    if (this.debug) {
      const mk = (x: number, label: string, fn: () => void) => {
        const t = this.txt(x, 436, label, { fontFamily: FONT, fontSize: '13px', color: T.coral })
          .setOrigin(0.5, 0).setInteractive();
        t.on('pointerup', fn);
        this.hud.add(t);
      };
      mk(52, '[+grant]', () => {
        const s = this.state;
        this.apply({ ...s, credits: s.credits + 500, items: Object.fromEntries(Object.entries(s.items).map(([k, v]) => [k, v + 20])) as GameState['items'] });
      });
      mk(140, '[+60s]', () => {
        this.debugAdvance(60);
      });
      mk(246, this.forceGeode ? '[geodes ON]' : '[geodes off]', () => { this.forceGeode = !this.forceGeode; this.redraw(); });
      mk(340, '[reset]', () => this.apply(createInitialState()));
    }
  }

  /** Debug only: run the simulation forward by `sec` game-seconds (used by +60s and scripted tests). */
  debugAdvance(sec: number): void {
    let cur = this.state;
    for (let i = 0; i < Math.round(sec * 10); i++) cur = tick(cur, 0.1, this.forceGeode).state;
    this.apply(cur);
  }

  private drawTabs(): void {
    const bar = this.add.graphics();
    bar.fillStyle(C.panel, 1).fillRect(0, H - 84, W, 84);
    bar.lineStyle(3, C.panelEdge, 1).lineBetween(0, H - 84, W, H - 84);
    const tab = (cx: number, label: string, active: boolean) => {
      const g = this.add.graphics();
      g.fillStyle(active ? C.beam : C.ghost, active ? 1 : 0.5).fillRoundedRect(cx - 18, H - 70, 36, 28, 10);
      const t = this.txt(cx, H - 32, label, { fontFamily: FONT, fontSize: '14px', color: active ? T.text : T.dim }).setOrigin(0.5);
      this.hud.add([g, t]);
    };
    this.hud.add(bar);
    const workshop = this.sheetKind === 'workshop';
    tab(W * 0.25, 'Ship', !workshop);
    tab(W * 0.75, 'Build', workshop);
    if (!workshop && readyUpgrades(this.state) > 0) {
      const dot = this.add.graphics();
      dot.fillStyle(C.space, 1).fillCircle(W * 0.75 + 20, H - 68, 9);
      dot.fillStyle(C.crit, 1).fillCircle(W * 0.75 + 20, H - 68, 6.5);
      this.hud.add(dot);
    }
  }

  private showToast(msg: string): void {
    this.toast?.destroy();
    const t = this.txt(W / 2, H - 130, msg, {
      fontFamily: FONT, fontSize: '16px', color: T.text, backgroundColor: '#2B3550', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(10);
    this.toast = t;
    this.tweens.add({ targets: t, alpha: 0, delay: 1400, duration: 300, onComplete: () => t.destroy() });
  }

  // ---- interaction ---------------------------------------------------------
  /** Template cell of the Nth module of a kind, from the saved module list. */
  private moduleCell(id: ModuleId, nth = 0): Cell | null {
    const m = this.state.ship.modules.filter((x) => x.defId === id)[nth];
    return m ? parseKey(m.cell) : null;
  }

  /** Floating text over a module tile, kept inside the ship view (skipped when the tile is scrolled away). */
  private floatAtModule(id: ModuleId, nth: number, msg: string, color: string): void {
    const cell = this.moduleCell(id, nth);
    if (!cell) return;
    const w = this.cellWorld(cell);
    if (w.x < VIEW.x + 10 || w.x > VIEW.x + VIEW.w - 10 || w.y < VIEW.y - 10 || w.y > VIEW.y + VIEW.h) return;
    this.floatText(w.x, Math.max(VIEW.y + 16, w.y - 28 * ZOOM - 6), msg, color);
  }

  /** Tap a beam tile: fires that beam. */
  private onBeamTap(index = 0): void {
    const out = tapBeam(this.state, index);
    if (out.state === this.state) return;
    this.apply(out.state);
    this.floatAtModule('beam', index, 'Beam on', T.gold);
  }

  /** The Fire button: every idle beam at once. */
  private onFire(): void {
    const out = tapAllBeams(this.state);
    if (out.state === this.state) return;
    this.apply(out.state);
    this.floatAtModule('beam', 0, this.state.beams.length > 1 ? 'Beams on' : 'Beam on', T.gold);
  }

  private onStageDown(p: Phaser.Input.Pointer): void {
    const c = this.state.crusher;
    if (!c.rock) return;
    const nx = (p.worldX - STAGE.cx) / STAGE.r;
    const ny = (p.worldY - STAGE.cy) / STAGE.r;
    if (!this.holdPointer && c.lockout <= 0) this.holdPointer = p; // first finger may become a hold
    const out = tapCrush(this.state, nx, ny);
    if (out.state === this.state) {
      if (c.lockout > 0) this.shake = 0.5;
      return;
    }
    this.state = out.state;
    this.handleEvents(out.events, p.worldX, p.worldY);
    this.afterEvents(out.events);
  }

  private onSend(): void {
    const chk = canSend(this.state);
    if (!chk.ok) {
      if (chk.reason !== 'no_rock') this.showToast(chk.label);
      return;
    }
    this.endHold();
    const out = sendToSmasher(this.state);
    this.state = out.state;
    this.persist();
    this.handleEvents(out.events, STAGE.cx, STAGE.cy);
    this.redraw();
  }

  // ---- sheets: one bottom sheet at a time, built from rows ---------------------------------------
  private closeSheet(): void {
    this.sheet?.destroy(true);
    this.sheet = undefined;
    this.sheetBuild = undefined;
    if (this.sheetKind) {
      this.sheetKind = '';
      this.redraw(); // tab highlight
    }
  }

  /** Open (or refresh) a sheet. `build` is re-run after every purchase so costs and levels stay current. */
  private showSheet(kind: string, build: () => { title: string; rows: SheetRow[] }): void {
    this.sheet?.destroy(true);
    const changed = this.sheetKind !== kind;
    if (changed) this.sheetScroll = 0;
    this.sheetKind = kind;
    this.sheetBuild = build;
    const { title, rows } = build();
    this.sheet = this.renderSheet(title, rows);
    if (changed) this.redraw();
  }

  private refreshSheet(): void {
    if (this.sheetBuild) this.showSheet(this.sheetKind, this.sheetBuild);
  }

  private renderSheet(title: string, rows: SheetRow[]): Phaser.GameObjects.Container {
    const X = 36, WID = 318, BTN_W = 136, TXT_W = WID - BTN_W - 12, HEAD = 58, BOTTOM = H - 92;
    const box = this.add.container(0, 0).setDepth(30);
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55).setInteractive();
    dim.on('pointerdown', () => this.closeSheet());
    box.add(dim);

    const laid = rows.map((row) => {
      if (row.t === 'text') {
        const a = this.txt(X, 0, row.text, { fontFamily: FONT, fontSize: '15px', color: row.color ?? T.dim, wordWrap: { width: WID } });
        return { row, a, b: undefined as Phaser.GameObjects.Text | undefined, h: a.height + 14 };
      }
      if (row.t === 'button') return { row, a: undefined, b: undefined, h: 70 };
      const a = this.txt(X, 0, row.title, { fontFamily: FONT, fontSize: '17px', fontStyle: '600', color: T.text, wordWrap: { width: TXT_W } });
      const b = this.txt(X, 0, row.sub, { fontFamily: FONT, fontSize: '13px', color: T.dim, wordWrap: { width: TXT_W } });
      return { row, a, b, h: Math.max(68, a.height + b.height + 20) };
    });
    const bodyH = laid.reduce((n, l) => n + l.h, 0);
    const panelH = Math.min(BOTTOM - 110, HEAD + bodyH + 16);
    const panelY = BOTTOM - panelH;
    const viewTop = panelY + HEAD - 4, viewBottom = panelY + panelH - 10;
    const maxScroll = Math.max(0, bodyH - (viewBottom - (panelY + HEAD)));
    this.sheetScroll = Math.min(Math.max(0, this.sheetScroll), maxScroll);

    const panel = this.add.graphics();
    panel.fillStyle(C.panel, 1).fillRoundedRect(16, panelY, 358, panelH, 26);
    panel.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(16, panelY, 358, panelH, 26);
    const absorb = this.add.zone(W / 2, panelY + panelH / 2, 358, panelH).setInteractive();
    box.add([panel, absorb]);
    box.add(this.txt(X, panelY + 18, title, { fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: T.text }));
    // scrolling body: everything below the header lives in `body`, clipped to the panel
    const body = this.add.container(0, -this.sheetScroll);
    box.add(body);
    const clip = this.make.graphics({ x: 0, y: 0 }, false);
    clip.fillStyle(0xffffff, 1).fillRect(16, viewTop, 358, viewBottom - viewTop);
    body.setMask(clip.createGeometryMask());
    const bar = this.add.graphics();
    box.add(bar);
    const close = this.txt(W - 40, panelY + 22, 'Close', { fontFamily: FONT, fontSize: '15px', color: T.dim }).setOrigin(1, 0).setInteractive();
    close.on('pointerdown', () => this.closeSheet());
    box.add(close); // after the body so scrolled rows can never sit on top of it
    const zones: { z: Phaser.GameObjects.Zone; top: number; bottom: number }[] = [];
    const syncZones = () => {
      for (const r of zones) {
        const top = r.top - this.sheetScroll, bottom = r.bottom - this.sheetScroll;
        const visible = bottom > viewTop && top < viewBottom;
        if (r.z.input && r.z.input.enabled !== visible) r.z.input.enabled = visible; // off-screen rows must not eat taps
      }
    };
    const drawBar = () => {
      bar.clear();
      if (maxScroll <= 0) return;
      const trackH = viewBottom - viewTop - 8;
      const h = Math.max(30, trackH * ((viewBottom - viewTop) / (bodyH + 4)));
      const y = viewTop + 4 + (trackH - h) * (this.sheetScroll / maxScroll);
      bar.fillStyle(C.ghost, 0.7).fillRoundedRect(366, y, 4, h, 2);
    };
    const setScroll = (v: number) => {
      this.sheetScroll = Math.min(Math.max(0, v), maxScroll);
      body.y = -this.sheetScroll;
      drawBar();
      syncZones();
    };
    drawBar();

    // drag to scroll; a press that moved is a drag, not a tap on a button
    let drag: { y0: number; s0: number } | null = null;
    let moved = false;
    const begin = (p: Phaser.Input.Pointer) => { drag = { y0: p.worldY, s0: this.sheetScroll }; moved = false; };
    const onMove = (p: Phaser.Input.Pointer) => {
      if (!drag || !p.isDown) { drag = null; return; }
      const dy = p.worldY - drag.y0;
      if (Math.abs(dy) > 6) moved = true;
      if (moved && maxScroll > 0) setScroll(drag.s0 - dy);
    };
    const onWheel = (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => { if (maxScroll > 0) setScroll(this.sheetScroll + dy * 0.5); };
    absorb.on('pointerdown', begin);
    this.input.on('pointermove', onMove);
    this.input.on('wheel', onWheel);
    box.once('destroy', () => {
      this.input.off('pointermove', onMove);
      this.input.off('wheel', onWheel);
      clip.destroy();
    });
    const tapOk = (p: Phaser.Input.Pointer) => !moved && p.worldY >= viewTop && p.worldY <= viewBottom;

    let y = panelY + HEAD;
    for (const l of laid) {
      if (l.row.t === 'text') {
        l.a!.setY(y);
        body.add(l.a!);
      } else if (l.row.t === 'button') {
        const row = l.row;
        const g = this.add.graphics();
        g.fillStyle(C.crit, 1).fillRoundedRect(X, y + 8, WID, 52, 26);
        const lab = this.txt(W / 2, y + 34, row.label, { fontFamily: FONT, fontSize: '18px', fontStyle: '600', color: '#0B1020' }).setOrigin(0.5);
        const z = this.add.zone(W / 2, y + 34, WID, 52).setInteractive();
        z.on('pointerdown', begin);
        z.on('pointerup', (p: Phaser.Input.Pointer) => { if (tapOk(p)) row.fn(); });
        zones.push({ z, top: y + 8, bottom: y + 60 });
        body.add([g, lab, z]);
      } else {
        const row = l.row;
        l.a!.setY(y + 6);
        l.b!.setY(y + 6 + l.a!.height + 2);
        const bx = X + WID - BTN_W, by = y + (l.h - 48) / 2;
        const g = this.add.graphics();
        g.fillStyle(row.can ? C.crit : C.panelEdge, 1).fillRoundedRect(bx, by, BTN_W, 48, 16);
        g.lineStyle(1, C.panelEdge, 1).lineBetween(X, y + l.h - 1, X + WID, y + l.h - 1);
        const ink = row.can ? '#0B1020' : T.dim;
        const verb = this.txt(bx + BTN_W / 2, by + (row.cost ? 14 : 24), row.verb, { fontFamily: FONT, fontSize: '16px', fontStyle: '600', color: ink }).setOrigin(0.5);
        body.add([g, l.a!, l.b!, verb]);
        if (row.cost) {
          body.add(this.txt(bx + BTN_W / 2, by + 34, row.cost, { fontFamily: FONT, fontSize: '12px', color: ink, align: 'center' }).setOrigin(0.5));
        }
        const z = this.add.zone(bx + BTN_W / 2, by + 24, BTN_W, 48).setInteractive();
        z.on('pointerdown', begin);
        z.on('pointerup', (p: Phaser.Input.Pointer) => { if (tapOk(p)) row.fn(); });
        zones.push({ z, top: by, bottom: by + 48 });
        body.add(z);
      }
      y += l.h;
    }
    syncZones();
    return box;
  }

  private spendFailToast(r: { ok: false; reason: string }): void {
    this.showToast(r.reason === 'need_items' ? 'Not enough materials' : r.reason === 'need_credits' ? 'Not enough credits' : r.reason === 'max_level' ? 'Already maxed' : 'Cannot do that');
  }

  /** A card row that spends something; refreshes the open sheet on success. */
  private upgradeCard(
    title: string, sub: string, cost: Cost | undefined, doIt: () => { ok: true; state: GameState; events: GameEvent[] } | { ok: false; reason: string },
    floatMsg: string,
  ): SheetRow {
    if (!cost) return { t: 'card', title, sub: 'Fully upgraded.', verb: 'Maxed', cost: '', can: false, fn: () => undefined };
    const can = canAfford(this.state, cost) === 'ok';
    return {
      t: 'card', title, sub, verb: 'Upgrade', cost: costText(cost), can,
      fn: () => {
        const r = doIt();
        if (!r.ok) { this.spendFailToast(r); return; }
        this.apply(r.state);
        this.handleEvents(r.events, STAGE.cx, STAGE.cy);
        this.floatText(W / 2, VIEW.y + 30, floatMsg, T.gold);
        this.refreshSheet();
      },
    };
  }

  /** Build tab: every upgrade in one place. */
  private showWorkshop(): void {
    this.showSheet('workshop', () => {
      const st = this.state;
      const rows: SheetRow[] = [];
      const hl = HAND.levels[st.handLevel - 1], hn = HAND.levels[st.handLevel];
      rows.push(this.upgradeCard(`Hand Tools · ${hl.name}`, hn ? `Next: ${hn.name}. ${hn.blurb}` : '', nextHandUpgrade(st), () => upgradeHand(this.state), 'Tools upgraded'));
      st.beams.forEach((b, i) => {
        const nx = BEAM.levels[b.level];
        const name = st.beams.length > 1 ? `Beam ${i + 1}` : 'Tractor Beam';
        rows.push(this.upgradeCard(
          `${name} · ${BEAM.levels[b.level - 1].name}`,
          nx ? `Next: ${nx.name}. Rocks carry ${Math.round((nx.oreMul - 1) * 100)}% more Ore.` : '',
          nextBeamUpgrade(st, i), () => upgradeBeam(this.state, i), 'Beam upgraded',
        ));
      });
      if (st.smelter.built) {
        const nx = SMELTER.levels[st.smelter.level];
        rows.push(this.upgradeCard(
          `Smelter · ${SMELTER.levels[st.smelter.level - 1].name}`,
          nx ? `Next: ${nx.name}. One Plate every ${nx.secPerBatch.toFixed(1)}s.` : '',
          nextSmelterUpgrade(st), () => upgradeSmelter(this.state), 'Smelter upgraded',
        ));
      }
      if (!st.smasher.repaired) {
        rows.push({
          t: 'card', title: 'Rock Smasher · Rusty', sub: 'Fix it and it smashes rocks while you do other things.',
          verb: 'Repair', cost: costText(SMASHER.repair), can: canAfford(st, SMASHER.repair) === 'ok',
          fn: () => {
            const r = repairSmasher(this.state);
            if (!r.ok) { this.spendFailToast(r); return; }
            this.apply(r.state);
            this.handleEvents(r.events, STAGE.cx, STAGE.cy);
            this.floatText(W / 2, VIEW.y + 30, 'Smasher repaired', T.gold);
            this.refreshSheet();
          },
        });
      } else {
        const nx = SMASHER.levels[st.smasher.level];
        rows.push(this.upgradeCard(
          `Rock Smasher · Level ${st.smasher.level}`,
          nx ? `Next: ${nx.hpPerSec} HP/s, holds ${nx.queue}${st.smasher.level + 1 >= SMASHER.autoIntakeLevel ? ', feeds itself from the Bay' : ''}.` : '',
          nextSmasherUpgrade(st), () => upgradeSmasher(this.state), 'Smasher upgraded',
        ));
      }
      const open = freeCells(st).length;
      rows.push({ t: 'text', text: open > 0 ? `You have ${open} Open ${open === 1 ? 'tile' : 'tiles'}. Tap one on the ship to build a module.` : 'No Open tiles. Buy a hull tile (dotted square) to make room for more modules.' });
      return { title: 'Workshop', rows };
    });
  }

  /** Tap an Open tile: what can go here. */
  private showBuildSheet(cell: string): void {
    this.showSheet('build', () => {
      const st = this.state;
      const owned = new Set(st.ship.ownedCells);
      const rows: SheetRow[] = [];
      const options: { id: ModuleId; sub: string }[] = [
        { id: 'smelter', sub: 'Turns 3 Ore into 1 Plate on its own. Plate fixes the Smasher and pays for bigger hull tiles.' },
        { id: 'beam', sub: 'Pulls in another asteroid. Fire starts every beam at once.' },
      ];
      for (const o of options) {
        const cost = moduleCost(st, o.id);
        if (!cost) continue;
        const edgeOk = o.id !== 'beam' || isEdgeCell(owned, cell);
        const can = edgeOk && canAfford(st, cost) === 'ok';
        rows.push({
          t: 'card', title: MODULES[o.id].name, sub: edgeOk ? o.sub : 'Needs an outside tile, one with a side facing open space.',
          verb: 'Build', cost: costText(cost), can,
          fn: () => {
            const r = placeModule(this.state, o.id, cell);
            if (!r.ok) {
              this.showToast(r.reason === 'not_edge' ? 'Needs an outside tile' : r.reason === 'need_items' ? 'Not enough materials' : r.reason === 'need_credits' ? 'Not enough credits' : 'Cannot build there');
              return;
            }
            this.apply(r.state);
            this.closeSheet();
            const n = r.state.ship.modules.filter((m) => m.defId === o.id).length - 1;
            this.floatAtModule(o.id, n, 'Built!', T.gold);
          },
        });
      }
      if (rows.length === 0) rows.push({ t: 'text', text: 'Nothing to build here yet. New modules arrive as your ship grows.' });
      return { title: 'Open tile', rows };
    });
  }

  private showSmelterSheet(): void {
    this.showSheet('smelter', () => {
      const st = this.state;
      const sm = st.smelter;
      const lv = SMELTER.levels[sm.level - 1];
      const nx = SMELTER.levels[sm.level];
      const rows: SheetRow[] = [
        { t: 'text', text: `Turns ${SMELTER.batchIn} Ore into ${SMELTER.batchOut} Plate every ${lv.secPerBatch.toFixed(1)}s. It never touches Ore your next goal needs.` },
        {
          t: 'card', title: sm.on ? 'Smelter is ON' : 'Smelter is OFF', sub: sm.on ? 'Switch it off to keep all your Ore.' : 'Switch it on to make Plate again.',
          verb: sm.on ? 'Turn off' : 'Turn on', cost: '', can: true,
          fn: () => { this.apply(toggleSmelter(this.state).state); this.refreshSheet(); },
        },
        this.upgradeCard(`Level ${sm.level} · ${lv.name}`, nx ? `Next: ${nx.name}. One Plate every ${nx.secPerBatch.toFixed(1)}s.` : '', nextSmelterUpgrade(st), () => upgradeSmelter(this.state), 'Smelter upgraded'),
      ];
      return { title: 'Smelter', rows };
    });
  }

  /** Repair the rusty Smasher, or upgrade it. */
  private showSmasherSheet(): void {
    this.showSheet('smasher', () => {
      const st = this.state;
      const sm = st.smasher;
      const rows: SheetRow[] = [];
      if (!sm.repaired) {
        rows.push({ t: 'text', text: 'Fix it and it smashes rocks while you do other things. It is slower than you and cannot open geodes.' });
        const can = canAfford(st, SMASHER.repair) === 'ok';
        rows.push({
          t: 'card', title: 'Repair the Smasher', sub: `Level 1: ${SMASHER.levels[0].hpPerSec} HP/s, holds ${SMASHER.levels[0].queue} rocks.`,
          verb: 'Repair', cost: costText(SMASHER.repair), can,
          fn: () => {
            const r = repairSmasher(this.state);
            if (!r.ok) { this.spendFailToast(r); return; }
            this.apply(r.state);
            this.handleEvents(r.events, STAGE.cx, STAGE.cy);
            this.closeSheet();
            this.floatAtModule('smasher', 0, 'Repaired!', T.gold);
          },
        });
        return { title: 'Rock Smasher (rusty)', rows };
      }
      const lv = SMASHER.levels[sm.level - 1];
      const nx = SMASHER.levels[sm.level];
      rows.push({ t: 'text', text: `Smashes ${lv.hpPerSec} HP per second. Holds ${lv.queue} rocks (${sm.queue.length} now). Tap Send on the stage to give it a rock; geodes stay with your hands.` });
      rows.push(this.upgradeCard(
        `Level ${sm.level}`,
        nx ? `Next: ${nx.hpPerSec} HP/s, holds ${nx.queue}${sm.level + 1 >= SMASHER.autoIntakeLevel ? ', feeds itself from the Bay' : ''}.` : '',
        nextSmasherUpgrade(st), () => upgradeSmasher(this.state), 'Smasher upgraded',
      ));
      return { title: 'Rock Smasher', rows };
    });
  }

  private onSell(): void {
    const out = sellAll(this.state);
    if (out.state === this.state) {
      const holding = SELLABLE.some((k) => Math.floor(this.state.items[k]) > 0);
      this.showToast(holding ? 'Keeping materials for your goal' : 'Nothing to sell');
      return;
    }
    this.apply(out.state);
    const total = out.events.reduce((n, e) => n + (e.kind === 'sold' ? e.credits : 0), 0);
    this.floatText(W - 90, ACTION.y - 6, `+${total}`, T.gold);
  }

  private handleEvents(events: GameEvent[], x: number, y: number): void {
    for (const e of events) {
      switch (e.kind) {
        case 'hit':
          this.shake = e.crit ? 1 : 0.45;
          this.chips(x, y, e.crit ? C.crit : 0xc8bdb2, e.crit ? 10 : 5);
          if (e.crit) this.floatText(x, y - 20, '3x', T.gold);
          break;
        case 'hold_tick':
          break;
        case 'overheat':
          this.floatText(STAGE.cx, STAGE.y + 24, 'Overheated!', T.coral);
          break;
        case 'crushed':
          this.floatText(STAGE.cx, STAGE.cy - 40, `+${e.ore} Ore`, T.text);
          if (e.geode) {
            this.floatText(STAGE.cx, STAGE.cy - 70, `Jackpot +${e.credits}`, T.gold);
            this.chips(STAGE.cx, STAGE.cy, C.crit, 22);
          }
          if (e.shard) this.floatText(STAGE.cx, STAGE.cy - 96, 'Core Shard!', '#8A5CE0');
          break;
        case 'rock_arrived':
          this.chips(STAGE.cx, STAGE.y + 10, C.beam, 8);
          break;
        case 'sent':
          this.chips(STAGE.cx, STAGE.cy, C.beam, 10);
          this.floatText(STAGE.cx, STAGE.cy - 30, 'Sent!', T.gold);
          break;
        case 'smashed':
          this.floatAtModule('smasher', 0, `+${e.ore} Ore`, T.text);
          break;
        case 'smelted':
          this.floatAtModule('smelter', 0, `+${e.plate} Plate`, '#9FB4D6');
          break;
        default:
          break;
      }
    }
  }

  private chips(x: number, y: number, color: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 18 + Math.random() * 40;
      const dot = this.add.circle(x, y, 2 + Math.random() * 3, color).setDepth(20);
      this.tweens.add({
        targets: dot, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: 320 + Math.random() * 200,
        onComplete: () => dot.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, msg: string, color: string): void {
    const t = this.txt(x, y, msg, { fontFamily: FONT, fontSize: '18px', fontStyle: '600', color, stroke: '#0B1020', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(21);
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  // ---- dynamic layer (redrawn every frame) -----------------------------------
  private buildDynamic(): void {
    this.dyn = this.add.graphics().setDepth(5);
    const mk = (size: number, color: string = T.text) =>
      this.txt(0, 0, '', { fontFamily: FONT, fontSize: `${size}px`, fontStyle: '600', color, align: 'center' }).setOrigin(0.5).setDepth(6);
    this.tx = { stage: mk(15, T.dim), fire: mk(17), sell: mk(17, '#0B1020'), heat: mk(12, T.dim), bay: mk(12, T.dim), hp: mk(12, T.dim), send: mk(15, '#0B1020'), smash: mk(12, T.text) };

    const stage = this.add.zone(STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2, STAGE.w, STAGE.h).setInteractive();
    stage.on('pointerdown', (p: Phaser.Input.Pointer) => this.onStageDown(p));
    const send = this.add.zone(328, STAGE.cy, 76, 56).setInteractive();
    send.on('pointerdown', () => this.onSend());
    const fire = this.add.zone(16 + 105, ACTION.y + ACTION.h / 2, 210, ACTION.h).setInteractive();
    fire.on('pointerdown', () => this.onFire());
    const tabShip = this.add.zone(W * 0.25, H - 42, 150, 80).setInteractive().setDepth(31);
    tabShip.on('pointerdown', () => this.closeSheet());
    const tabBuild = this.add.zone(W * 0.75, H - 42, 150, 80).setInteractive().setDepth(31);
    tabBuild.on('pointerdown', () => (this.sheetKind === 'workshop' ? this.closeSheet() : this.showWorkshop()));
    const sellZ = this.add.zone(238 + 68, ACTION.y + ACTION.h / 2, 136, ACTION.h).setInteractive();
    sellZ.on('pointerdown', () => this.onSell());

    // scroll arrows: hold to pan; only active while the arrow is visible
    const dirs = { left: { x: 1, y: 0 }, right: { x: -1, y: 0 }, up: { x: 0, y: 1 }, down: { x: 0, y: -1 } } as const;
    const rects = this.arrowRects();
    (['left', 'right', 'up', 'down'] as const).forEach((k) => {
      const r = rects[k];
      const z = this.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w + 12, r.h + 12).setInteractive().setDepth(7);
      this.arrowZones[k] = z;
      const stop = () => { this.panDir = { x: 0, y: 0 }; };
      z.on('pointerdown', () => { if (arrowsFor(this.pan, this.limits)[k]) this.panDir = { ...dirs[k] }; });
      z.on('pointerup', stop);
      z.on('pointerout', stop);
      z.on('pointerupoutside', stop);
    });
  }

  /** Pooled label inside the zoomed ship (beams use slots 0-2, the Smelter slot 3). */
  private shipLabel(i: number): Phaser.GameObjects.Text {
    if (!this.shipLabels[i]) {
      const t = this.shipTxt(0, 0, '', { fontFamily: FONT, fontSize: '17px', fontStyle: '600', color: T.text, align: 'center' }).setOrigin(0.5);
      this.ship.add(t); // sits above the overlay graphics inside the zoomed container
      this.shipLabels[i] = t;
    }
    return this.shipLabels[i];
  }

  private setText(t: Phaser.GameObjects.Text, x: number, y: number, str: string, color?: string): void {
    if (t.text !== str) t.setText(str);
    if (color && t.style.color !== color) t.setColor(color);
    t.setPosition(x, y);
    t.setVisible(str !== '');
  }

  private drawDynamic(): void {
    const g = this.dyn;
    const st = this.state;
    const c = st.crusher;
    const now = this.elapsed;
    g.clear();
    const sg = this.dynShip;
    sg.clear();

    // --- module overlays: every beam (ring + countdown) and the Smelter (progress ring)
    const hand = handStats(st);
    const counting = st.beams.some((b) => b.status === 'counting');
    const used = new Set<number>();
    const goalId = currentGoal(st)?.id;
    st.ship.modules.filter((m) => m.defId === 'beam').forEach((m, i) => {
      const beam = st.beams[i];
      if (!beam) return;
      const bp = this.px(parseKey(m.cell));
      const bcx = bp.x + TILE / 2, bcy = bp.y + TILE / 2;
      let label = '';
      if (beam.status === 'counting') {
        const frac = 1 - beam.remaining / BAL.beamCountdown;
        sg.lineStyle(4, C.beam, 1).beginPath().arc(bcx, bcy, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false).strokePath();
        sg.lineStyle(4, C.hull, 0.35).strokeCircle(bcx, bcy, 18);
        label = String(Math.ceil(Math.max(0, beam.remaining)));
      } else if (beam.status === 'idle' && c.rock) {
        sg.lineStyle(3, C.hull, 0.35).strokeRoundedRect(bp.x + 2, bp.y + 2, TILE - 4, TILE - 4, 10); // locked: rock in stage
      } else if (beam.status === 'idle') {
        const pulse = 0.55 + 0.45 * Math.sin(now * 5);
        sg.lineStyle(3, C.crit, st.flags.tappedBeam ? 0.9 : pulse).strokeRoundedRect(bp.x + 2, bp.y + 2, TILE - 4, TILE - 4, 10);
      } else {
        sg.lineStyle(3, 0xffa733, 1).strokeRoundedRect(bp.x + 2, bp.y + 2, TILE - 4, TILE - 4, 10);
        label = 'Full';
      }
      this.levelPips(sg, bp.x, bp.y, beam.level);
      this.setText(this.shipLabel(i), bcx, bcy, label);
      used.add(i);
    });
    const smMod = st.ship.modules.find((m) => m.defId === 'smelter');
    if (smMod && st.smelter.built) {
      const sp = this.px(parseKey(smMod.cell));
      const cx = sp.x + TILE / 2, cy = sp.y + TILE / 2;
      let label = '';
      if (!st.smelter.on) {
        sg.fillStyle(0x000000, 0.5).fillRoundedRect(sp.x + 7, sp.y + 7, TILE - 14, TILE - 14, 8);
        label = 'OFF';
      } else if (st.smelter.progress > 0) {
        sg.lineStyle(4, 0x2a1810, 0.45).strokeCircle(cx, cy, 20);
        sg.lineStyle(4, C.crit, 1).beginPath().arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.smelter.progress, false).strokePath();
      }
      this.levelPips(sg, sp.x, sp.y, st.smelter.level);
      this.setText(this.shipLabel(3), cx, cy, label);
      used.add(3);
    }
    for (let i = 0; i < 4; i++) if (!used.has(i) && this.shipLabels[i]) this.setText(this.shipLabels[i], -100, -100, '');
    // Open tiles that fit the current goal pulse
    if (goalId === 'smelter' || goalId === 'beam2') {
      const cells = goalId === 'smelter' ? freeCells(st) : freeEdgeCells(st);
      const pulse = 0.45 + 0.55 * Math.sin(now * 5);
      for (const k of cells) {
        const p = this.px(parseKey(k));
        sg.lineStyle(3, C.crit, pulse).strokeRoundedRect(p.x + 5, p.y + 5, TILE - 10, TILE - 10, 9);
      }
    }

    // --- crush stage panel
    g.fillStyle(C.panel, 1).fillRoundedRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 22);
    g.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 22);

    let stageText = '';
    if (c.rock) {
      this.shake = Math.max(0, this.shake - 0.06);
      const jx = (Math.random() - 0.5) * 8 * this.shake;
      const jy = (Math.random() - 0.5) * 8 * this.shake;
      this.drawRock(g, STAGE.cx + jx, STAGE.cy + jy, c.rock.geode, 1 - c.rock.hp / c.rock.maxHp);
      if (weakActive(st)) {
        const wx = STAGE.cx + c.weakX * STAGE.r, wy = STAGE.cy + c.weakY * STAGE.r;
        const left = 1 - c.weakT / BAL.weak.active;
        const pr = BAL.weak.hitRadius * STAGE.r;
        g.fillStyle(C.crit, 0.22).fillCircle(wx, wy, pr);
        g.lineStyle(4, C.crit, 1).strokeCircle(wx, wy, pr * (0.7 + 0.3 * left));
        g.fillStyle(C.crit, 1).fillCircle(wx, wy, 6);
      }
      // HP bar
      const frac = Math.max(0, c.rock.hp / c.rock.maxHp);
      g.fillStyle(C.deck, 1).fillRoundedRect(STAGE.cx - 70, STAGE.y + STAGE.h - 15, 140, 8, 4);
      g.fillStyle(C.crusher, 1).fillRoundedRect(STAGE.cx - 70, STAGE.y + STAGE.h - 15, 140 * frac, 8, 4);
      // radial heat arc
      const hf = Math.min(1, c.heat / hand.heatMax);
      if (c.lockout > 0) {
        const sweep = c.lockout / hand.lockout;
        g.lineStyle(6, 0x9fd8ff, 0.9).beginPath().arc(STAGE.cx, STAGE.cy, STAGE.r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep, false).strokePath();
      } else if (hf >= 0.3) {
        g.lineStyle(6, this.heatColor(hf), 1).beginPath().arc(STAGE.cx, STAGE.cy, STAGE.r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hf, false).strokePath();
      }
      if (c.lockout > 0) stageText = 'JAMMED';
      else if (st.stats.rocks === 0) stageText = 'Tap the rock. Hit the glow for 3x.';
      else if (st.stats.taps >= 15 && !st.flags.usedHold) stageText = 'Hold your finger to keep cracking.';
    } else if (counting) {
      stageText = 'Asteroid incoming...';
    } else {
      stageText = st.flags.tappedBeam ? 'Tap the beam for another asteroid' : 'Tap the beam to call an asteroid';
    }
    this.setText(this.tx.stage, STAGE.cx, c.rock ? STAGE.y + 13 : STAGE.cy, stageText, c.lockout > 0 ? '#9fd8ff' : T.dim);

    // --- Send button + Smasher overlay
    this.drawSend(g, st);
    this.drawSmasher(sg, st);

    // --- status strip: heat + Bay
    const heatFrac = Math.min(1, c.heat / hand.heatMax);
    const hx = 16, hy = STRIP_Y + 18, hw = 176;
    g.fillStyle(C.deck, 1).fillRoundedRect(hx, hy, hw, 16, 8);
    const hc = c.lockout > 0 ? 0x9fd8ff : this.heatColor(heatFrac);
    if (heatFrac > 0) g.fillStyle(hc, 1).fillRoundedRect(hx, hy, Math.max(16, hw * heatFrac), 16, 8);
    this.setText(this.tx.heat, hx + 18, STRIP_Y + 8, 'Heat');
    this.setText(this.tx.bay, 224, STRIP_Y + 26, 'Bay');
    for (let i = 0; i < BAL.baySlots; i++) {
      const sx = 250 + i * 40, sy = STRIP_Y + 6;
      g.fillStyle(C.deck, 1).fillRoundedRect(sx, sy, 30, 30, 9);
      g.lineStyle(2, C.deckEdge, 1).strokeRoundedRect(sx, sy, 30, 30, 9);
      const rock = st.bay[i];
      if (rock) g.fillStyle(rock.geode ? 0x8a5ce0 : 0xa9937c, 1).fillCircle(sx + 15, sy + 15, 9);
    }

    // --- action row: Fire (all idle beams) + Sell (everything not reserved for the goal)
    const idleN = st.beams.filter((b) => b.status === 'idle').length;
    const ready = idleN > 0 && !c.rock;
    g.fillStyle(ready ? C.beamDeep : C.panelEdge, 1).fillRoundedRect(16, ACTION.y, 210, ACTION.h, 23);
    g.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(16, ACTION.y, 210, ACTION.h, 23);
    const wait = Math.max(0, ...st.beams.filter((b) => b.status === 'counting').map((b) => b.remaining));
    const fireText = idleN > 0
      ? (c.rock ? 'Rock in stage' : idleN > 1 ? `Fire ${idleN} beams` : 'Fire beam')
      : counting ? `Incoming ${wait.toFixed(1)}s` : 'Bay full';
    this.setText(this.tx.fire, 121, ACTION.y + ACTION.h / 2, fireText, ready ? '#0B1020' : T.dim);

    const val = sellValue(st);
    const canSell = val > 0;
    const sellPulse = canSell && goalId === 'sell' ? 0.6 + 0.4 * Math.sin(now * 6) : 1;
    g.fillStyle(canSell ? C.crit : C.panelEdge, canSell ? sellPulse : 1).fillRoundedRect(238, ACTION.y, 136, ACTION.h, 23);
    g.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(238, ACTION.y, 136, ACTION.h, 23);
    this.setText(this.tx.sell, 306, ACTION.y + ACTION.h / 2, canSell ? `Sell +${val}` : 'Sell', canSell ? '#0B1020' : T.dim);
    this.setText(this.tx.hp, -100, -100, '');
    this.drawArrows(g);
  }

  /** Small level dots along the bottom of a tile (level 1 shows none). */
  private levelPips(g: Phaser.GameObjects.Graphics, x: number, y: number, level: number): void {
    for (let i = 1; i < level; i++) {
      g.fillStyle(C.crit, 1).fillCircle(x + 12 + (i - 1) * 9, y + TILE - 9, 2.6);
    }
  }

  private heatColor(f: number): number {
    return f >= 0.9 ? C.coral : f >= 0.7 ? C.crusher : f >= 0.5 ? C.crit : C.beam;
  }

  private drawSend(g: Phaser.GameObjects.Graphics, st: GameState): void {
    const x = 290, y = STAGE.cy - 28, w = 76, h = 56;
    if (!st.smasher.repaired || !st.crusher.rock) {
      this.setText(this.tx.send, -100, -100, '');
      return;
    }
    const chk = canSend(st);
    const ok = chk.ok;
    const pulse = ok && currentGoal(st)?.id === 'send' ? 0.6 + 0.4 * Math.sin(this.elapsed * 6) : 1;
    g.fillStyle(ok ? C.beam : C.panelEdge, ok ? pulse : 1).fillRoundedRect(x, y, w, h, 18);
    g.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(x, y, w, h, 18);
    this.setText(this.tx.send, x + w / 2, y + h / 2, ok ? 'Send' : chk.reason === 'geode' ? 'Geode' : 'Full', ok ? '#0B1020' : T.dim);
  }

  /** Smasher tile overlay: progress ring on the head rock, queue pips underneath. */
  private drawSmasher(g: Phaser.GameObjects.Graphics, st: GameState): void {
    const smCell = this.moduleCell('smasher', 0);
    if (!smCell) return;
    const sp = this.px(smCell);
    const cx = sp.x + TILE / 2, cy = sp.y + TILE / 2;
    const sm = st.smasher;
    if (!sm.repaired) {
      const goal = currentGoal(st)?.id === 'repair';
      if (goal) g.lineStyle(3, C.crit, 0.55 + 0.45 * Math.sin(this.elapsed * 5)).strokeRoundedRect(sp.x + 2, sp.y + 2, TILE - 4, TILE - 4, 10);
      this.setText(this.tx.smash, -100, -100, '');
      return;
    }
    const head = sm.queue[0];
    if (head) {
      const frac = 1 - head.hp / head.maxHp;
      g.lineStyle(4, 0x2a2320, 0.4).strokeCircle(cx, cy, 20);
      g.lineStyle(4, C.crit, 1).beginPath().arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false).strokePath();
    }
    const cap = smasherQueueCap(st);
    for (let i = 0; i < cap; i++) {
      const px = cx - ((cap - 1) * 7) / 2 + i * 7;
      g.fillStyle(i < sm.queue.length ? C.crit : C.deck, 1).fillCircle(px, sp.y + TILE - 6, 2.6);
    }
    this.setText(this.tx.smash, -100, -100, '');
  }

  private drawRock(g: Phaser.GameObjects.Graphics, cx: number, cy: number, geode: boolean, damage: number): void {
    const R = STAGE.r;
    const pts: Phaser.Math.Vector2[] = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (geode ? 0.3 : 0);
      const r = R * (0.86 + 0.14 * Math.sin(i * 2.3 + (geode ? 1 : 0)));
      pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    const grow = (k: number) => pts.map((p) => new Phaser.Math.Vector2(cx + (p.x - cx) * k, cy + (p.y - cy) * k));
    g.fillStyle(0x2a2320, 1).fillPoints(grow(1.1), true);
    g.fillStyle(geode ? 0x6f4cc2 : 0x8a7f78, 1).fillPoints(pts, true);
    g.fillStyle(geode ? 0x8a5ce0 : 0xa59a92, 1).fillPoints(grow(0.72), true);
    if (geode) {
      g.fillStyle(C.crit, 1);
      g.fillTriangle(cx - 8, cy + 6, cx, cy - 18, cx + 8, cy + 6);
      g.fillTriangle(cx + 6, cy + 10, cx + 16, cy - 6, cx + 24, cy + 10);
    }
    g.lineStyle(3, 0x2a2320, 1);
    const cracks = Math.floor(damage * 4);
    for (let i = 0; i < cracks; i++) {
      const a = i * 1.7 + 0.5;
      g.lineBetween(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, cx + Math.cos(a) * R * 0.85, cy + Math.sin(a + 0.4) * R * 0.85);
    }
  }

  private drawStars(): void {
    const g = this.add.graphics();
    const rnd = new Phaser.Math.RandomDataGenerator(['stars']);
    for (let i = 0; i < 60; i++) {
      g.fillStyle(0xe6ecff, rnd.realInRange(0.1, 0.45));
      g.fillCircle(rnd.between(0, W), rnd.between(0, H), rnd.realInRange(0.6, 1.6));
    }
  }
}
