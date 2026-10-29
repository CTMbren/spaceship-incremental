import Phaser from 'phaser';
import { buyTile, canAfford } from '../core/actions';
import { chipText as hudChipText, costText, currentGoal } from '../core/goals';
import { cellKey, nextTileCost, parseKey, unlockableCells } from '../core/hull';
import {
  bayRoom, beamCountdown, beamLevels, beamReady, canSend, handStats, holdCrush, nextBeamUpgrade, nextHandUpgrade, nextModuleUpgrade, nextSmasherUpgrade, nextSmelterUpgrade,
  releaseHold, repairSmasher, sellAll, sellSelected, sellQty, sellSurplus, sendToSmasher, setHoldForGoal, smasherQueueCap, smasherQueued, tapAllBeams, tapBeam, tapCrush, tick,
  toggleSmelter, upgradeBeam, upgradeHand, upgradeModule, upgradeSmasher, upgradeSmelter, weakActive, winchedBeams,
} from '../core/loop';
import { fitsPlacement, freeCells, freeCellsFor, moduleCost, moduleCount, moduleUnlocked, placeModule, placementOf } from '../core/modules';
import { evaluatePower, solarLevel, type PowerInfo } from '../core/power';
import {
  canDepart, currentNode, depart, engineLevel, engineSpeed, etaSec, inTransit, legLength, nextLegSec, ROUTE,
} from '../core/travel';
import { applyOffline, stamp, type OfflineReport } from '../core/offline';
import { cargoRows, sellMode } from '../core/cargo';
import { moveModule, sellModule, sellRefund, smasherReady } from '../core/units';
import { fmtNum, formatVersion } from '../core/format';
import { SELLABLE, sellValue } from '../core/reserve';
import { readyUpgrades } from '../core/upgrades';
import { loadFromStorage, parseSave, saveToStorage, serialize } from '../core/save';
import { createInitialState } from '../core/state';
import type { Cell, Cost, GameEvent, GameState, ItemId, ModuleId, Rock } from '../core/types';
import { BAL } from '../data/balance';
import { BEAM, MODULES, SMELTER } from '../data/modules';
import { POWER, SOLAR } from '../data/power';
import { ENGINE, GRAPPLE, SYSTEM } from '../data/travel';
import { HAND } from '../data/hand';
import { HELP } from '../data/help';
import { SMASHER } from '../data/smasher';
import { HULLS } from '../data/hulls';
import { drawHullExterior, GOLD_TRIM } from './hullArt';
import {
  baySize, canDeliver, canSkip, deliverJob, finishableJobs, JOB_ITEMS, rank, repToNext, skipJob, slotKinds, stillNeeds,
} from '../core/jobs';
import { RANK, RANKS } from '../data/jobs';
import { C, FONT, T } from './palette';
import {
  arrowsFor, boundsOf, CELL, cellAt, clampPan, localPos, panLimits, panToShow, toScreen, VIEW, ZOOM, ZOOM_MAX, zoomAbout, zoomRange,
  setViewWidth, type PanLimits,
} from './shipLayout';

export const H = 844;
/** Narrowest and widest logical width. A phone with browser toolbars is shorter than 390x844, so the game
 *  would shrink to fit the height and leave empty bars at the sides; instead the layout gets wider. */
const MIN_W = 390;
const MAX_W = 520;
export const W = Math.round(Math.min(MAX_W, Math.max(MIN_W, H * (window.innerWidth / Math.max(1, window.innerHeight)))));
setViewWidth(W);
/** Content width: the screen minus a 16px margin on each side. */
const CW = W - 32;
/** Render at the device pixel ratio (capped) so text and shapes stay sharp on retina phones. */
export const DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
const TILE = CELL; // local tile size; the ship container is scaled by the current zoom on screen
/** Ship-view gestures: a press that moves more than this (px) is a swipe, not a tap; two taps this close (ms) reset the view. */
const DRAG_SLOP = 8;
const DOUBLE_TAP_MS = 320;
/** View settings kept on the device, not in the save. */
const VIEW_KEY = 'last-tug-view';
const PAN_SPEED = 420; // px per second while an arrow is held
const MAX_GHOSTS = 4;
const STAGE = { x: 16, y: 466, w: CW, h: 184, cx: W / 2, cy: 556, r: 60 };
const STRIP_Y = 660;
/** The Bay: its slots sit at the right of the status strip (3, or 4 from the Hauler rank). */
const BAY = { y: STRIP_Y + 3, size: 34, gap: 8 };
const bayX = (n: number): number => W - 28 - n * BAY.size - (n - 1) * BAY.gap;
const ACTION = { y: 706, h: 46 };
/** Fire takes about 60% of the action row, Sell the rest. */
const FIRE = { x: 16, w: Math.round((CW - 12) * 0.607) };
const SELL = { x: 16 + FIRE.w + 12, w: CW - FIRE.w - 12 };
/** The Smash button sits at the right end of the stage. */
const SMASH = { x: STAGE.x + STAGE.w - 84, w: 76, h: 56 };

const SMELTER_COLOR = 0xb4552f;
const SOLAR_COLOR = 0x2b5fa8;
const ENGINE_COLOR = 0x5a4a8a;
const GRAPPLE_COLOR = 0x167a72;
/** Rock colours by kind: [outer, inner]. Geodes are purple whatever the kind. */
const ROCK_LOOK: Record<Rock['kind'], { outer: number; inner: number; bay: number }> = {
  dust: { outer: 0x8a7f78, inner: 0xa59a92, bay: 0xa9937c },
  big: { outer: 0x7a6f68, inner: 0x968a80, bay: 0x968a80 },
  ice: { outer: 0x6fa9c9, inner: 0xbfe6ff, bay: 0x9fd8ff },
  heavy: { outer: 0x5d5560, inner: 0x7d7480, bay: 0x6d6470 },
};
/** Tab bar: Ship · Build · Map · Jobs. */
const TAB_X = { ship: W / 8, build: (W * 3) / 8, map: (W * 5) / 8, jobs: (W * 7) / 8 };
/** Map refresh while cruising, seconds. */
const MAP_REFRESH = 1;

const ITEM_LOOK: Record<ItemId, { name: string; color: number }> = {
  ore: { name: 'Ore', color: 0xa9937c },
  ice: { name: 'Ice', color: 0x9fd8ff },
  plate: { name: 'Plate', color: 0x9fb4d6 },
  coolant: { name: 'Coolant', color: 0x4da3ff },
  circuit: { name: 'Circuit', color: 0x6fd08c },
  core_shard: { name: 'Core Shard', color: 0x8a5ce0 },
};
const HOLD_RESET_MS = 1500;

interface SheetFooter { label: string; can: boolean; fn: () => void }
interface SheetSpec { title: string; rows: SheetRow[]; footer?: SheetFooter }

type SheetRow =
  | { t: 'text'; text: string; color?: string }
  | { t: 'heading'; text: string }
  | { t: 'button'; label: string; fn: () => void }
  | { t: 'switch'; title: string; sub: string; on: boolean; fn: () => void }
  | { t: 'hold'; label: string; fn: () => void }
  | {
      t: 'cargo'; item: ItemId; count: number; price: number; note: string; sellLabel: string; canSell: boolean;
      forSale: boolean; ticked: boolean; onTick: () => void; onSell: () => void; onSellOne: () => void;
    }
  | { t: 'card'; title: string; sub: string; verb: string; cost: string; can: boolean; fn: () => void }
  | { t: 'job'; title: string; sub: string; verb: string; can: boolean; fn: () => void; skip: string; canSkip: boolean; onSkip: () => void };

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
  private tx!: Record<'stage' | 'fire' | 'sell' | 'heat' | 'bay' | 'hp' | 'send' | 'smash' | 'loc' | 'power', Phaser.GameObjects.Text>;
  private shipLabels = new Map<string, Phaser.GameObjects.Text>(); // pooled tile labels inside the zoomed ship, keyed by module
  private starG!: Phaser.GameObjects.Graphics;
  private stars: { x: number; y: number; r: number; a: number; z: number }[] = [];
  private starShift = 0;
  private mapTimer = 0;
  /** Current ship zoom (pinch) and the touch gesture in progress on the ship view. */
  private zoom = ZOOM;
  private swiped = false;
  private gesture: {
    pts: Map<number, { x: number; y: number }>;
    start: { x: number; y: number; panX: number; panY: number } | null;
    pinch: { dist: number; zoom: number } | null;
    moved: boolean;
    overUi: boolean;
    lastTap: number;
  } = { pts: new Map(), start: null, pinch: null, moved: false, overUi: false, lastTap: 0 };
  private sheetBuild?: () => SheetSpec;
  /** What a tap on each ship cell does ("x,y" -> action), rebuilt with the ship drawing. */
  private tileActions = new Map<string, () => void>();
  private cargoOff = new Set<ItemId>(); // rows the player un-ticked in the Cargo sheet
  private moveUid: number | null = null; // module being moved: tap an Open tile to drop it there
  private sellArm: number | null = null; // module whose Sell button has been tapped once (tap again to confirm)
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
    this.initStars();
    this.loadView();
    this.ship = this.add.container(0, 0).setScale(this.zoom);
    this.layer = this.add.container(0, 0);
    this.dynShip = this.add.graphics();
    this.ship.add([this.layer, this.dynShip]);
    const clip = this.make.graphics({ x: 0, y: 0 }, false);
    clip.fillStyle(0xffffff, 1).fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    this.ship.setMask(clip.createGeometryMask());
    this.hud = this.add.container(0, 0);
    this.buildDynamic();
    this.setupGestures();
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
    if (!this.sheet && this.state.flags.powerNotice > 0) this.showPowerNotice();
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
    // the Map shows a live ETA while cruising
    this.mapTimer += dt;
    const fingerDown = this.input.pointer1?.isDown || this.input.activePointer.isDown; // never rebuild under a tap
    if (this.mapTimer >= MAP_REFRESH && !fingerDown && ((this.sheetKind === 'map' && inTransit(this.state)) || this.sheetKind === 'jobs')) {
      this.mapTimer = 0;
      this.refreshSheet();
    }
    this.drawStars(dt);
    this.drawDynamic();
  }

  /** Static layer (HUD numbers, goal chip) only needs a rebuild when Ore or credits change. */
  private afterEvents(events: GameEvent[]): void {
    if (events.some((e) => e.kind === 'crushed' || e.kind === 'smashed' || e.kind === 'smelted' || e.kind === 'arrived' || e.kind === 'job_posted' || e.kind === 'jobs_open')) this.redraw();
    if (events.some((e) => e.kind === 'jobs_open')) this.showToast('New: the Job Board. Open the Jobs tab.');
    const arrived = events.find((e) => e.kind === 'arrived');
    if (arrived && arrived.kind === 'arrived') {
      this.persist();
      this.showToast(`Arrived: ${ROUTE[arrived.node].name}`);
      if (this.sheetKind === 'map') this.refreshSheet();
    }
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
      if (r.arrived.length > 0) rows.push({ t: 'text', text: `The ship flew on while you were away and reached ${r.arrived.join(', then ')}.`, color: T.text });
      else if (r.stillCruising) rows.push({ t: 'text', text: 'The ship is still cruising. Open the Map to see how far it has left.' });
      if (r.smeltersCooled) rows.push({ t: 'text', text: 'Smelters ran for 30 minutes, then went cold, so you came back to raw Ore. They warm up again now you are here.' });
      if (r.smasherRusty) rows.push({ t: 'text', text: 'Repair the Smasher and your ship keeps working while you are away.' });
      else if (r.geodeWaiting) rows.push({ t: 'text', text: 'A geode is waiting in the stage. Only your hands can crack it, and it holds up the beams until you do.' });
      else if (r.rocksSmashed === 0 && gains.length === 0) rows.push({ t: 'text', text: 'Nothing happened while you were away. Fire the beams to give the Smasher rocks.' });
      rows.push({ t: 'text', text: 'While you are away the ship works at 30% for the first 2 hours, then 10%, up to 8 hours. Travel runs at full speed. Nothing is sold for you.' });
      rows.push({ t: 'button', label: 'Back to work', fn: () => this.closeSheet() });
      return { title: 'Welcome back', rows };
    });
  }

  /** One-time sheet for ships that existed before power: explains the Plate they were given. */
  private showPowerNotice(): void {
    const plate = this.state.flags.powerNotice;
    const done = () => {
      this.apply({ ...this.state, flags: { ...this.state.flags, powerNotice: 0 } });
      this.closeSheet();
    };
    this.showSheet('power-notice', () => ({
      title: 'New: power',
      rows: [
        { t: 'text', text: 'Modules now need power. The hull makes 3, enough for a beam, the Smasher and a Smelter. Modules without power stop and show a dark tile with a red bolt.', color: T.text },
        { t: 'text', text: `Your ship uses more than that, so you have been given ${plate} Plate to build Solar Wings. Tap an Open outside tile and build one. Each makes 2 power for modules up to 2 tiles away, and anything touching it works 15% faster.` },
        { t: 'text', text: 'Short on tiles? Switch a Smelter OFF to free its power, or Move and Sell modules from their tiles.' },
        { t: 'button', label: 'Got it', fn: done },
      ],
    }));
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
    if (this.moveUid !== null) { this.cancelMove(); return; }
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
    this.tileActions.clear();
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
  private shipBounds() {
    return boundsOf(this.state.ship.ownedCells.map(parseKey), this.ghostCells());
  }

  private updateLimits(first: boolean): void {
    const b = this.shipBounds();
    const zr = zoomRange(b);
    this.zoom = Math.min(zr.max, Math.max(zr.min, this.zoom));
    this.ship?.setScale(this.zoom);
    this.limits = panLimits(b, this.zoom);
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

  // ---- ship view gestures: swipe to scroll, pinch to zoom, tap a tile, double-tap to reset ----------
  private loadView(): void {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as { zoom?: number; swiped?: boolean };
      if (typeof v.zoom === 'number' && Number.isFinite(v.zoom)) this.zoom = v.zoom;
      this.swiped = !!v.swiped;
    } catch { /* blocked storage: defaults */ }
  }

  private saveView(): void {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ zoom: this.zoom, swiped: this.swiped })); } catch { /* ignore */ }
  }

  /** Zoom to z, keeping the point under `anchor` (screen) where it is, within the pan limits. */
  private setZoom(z: number, anchor: { x: number; y: number }): void {
    const next = zoomAbout(this.pan, this.zoom, z, anchor);
    this.zoom = z;
    this.ship.setScale(z);
    this.limits = panLimits(this.shipBounds(), z);
    this.pan = clampPan(next, this.limits);
    this.panGoal = { ...this.pan };
    this.ship.setPosition(this.pan.x, this.pan.y);
  }

  /** Double-tap on empty space: zoom out to fit the whole ship and centre it. */
  private resetView(): void {
    const b = this.shipBounds();
    this.zoom = zoomRange(b).fit;
    this.ship.setScale(this.zoom);
    this.limits = panLimits(b, this.zoom);
    this.panGoal = { x: (this.limits.minX + this.limits.maxX) / 2, y: (this.limits.minY + this.limits.maxY) / 2 };
    this.saveView();
  }

  private setupGestures(): void {
    const g = this.gesture;
    const arrowZones = () => Object.values(this.arrowZones) as Phaser.GameObjects.GameObject[];
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.sheet || !this.inView(p)) return;
      g.pts.set(p.id, { x: p.worldX, y: p.worldY });
      if (g.pts.size === 1) {
        g.start = { x: p.worldX, y: p.worldY, panX: this.pan.x, panY: this.pan.y };
        g.moved = false;
        g.pinch = null;
        g.overUi = over.some((o) => arrowZones().includes(o));
      } else if (g.pts.size === 2) {
        const [a, b] = [...g.pts.values()];
        g.pinch = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom: this.zoom };
        g.moved = true; // a pinch is never a tap
        this.panDir = { x: 0, y: 0 };
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!g.pts.has(p.id) || !p.isDown) return;
      g.pts.set(p.id, { x: p.worldX, y: p.worldY });
      if (g.pinch && g.pts.size >= 2) {
        const [a, b] = [...g.pts.values()];
        const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        const zr = zoomRange(this.shipBounds());
        const z = Math.min(zr.max, Math.max(zr.min, g.pinch.zoom * (dist / g.pinch.dist)));
        this.setZoom(z, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        return;
      }
      if (!g.start || g.overUi) return;
      const dx = p.worldX - g.start.x, dy = p.worldY - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) > DRAG_SLOP) g.moved = true;
      if (!g.moved) return;
      this.panGoal = clampPan({ x: g.start.panX + dx, y: g.start.panY + dy }, this.limits);
      this.pan = { ...this.panGoal };
      this.ship.setPosition(this.pan.x, this.pan.y);
      if (!this.swiped && (Math.abs(dx) > 24 || Math.abs(dy) > 24)) { this.swiped = true; this.saveView(); }
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (!g.pts.has(p.id)) return;
      g.pts.delete(p.id);
      if (g.pinch) {
        if (g.pts.size === 1) {
          // one finger stays down after a pinch: it pans from here, it never taps
          const [rest] = [...g.pts.values()];
          g.start = { x: rest.x, y: rest.y, panX: this.pan.x, panY: this.pan.y };
        }
        g.pinch = null;
        this.saveView();
        return;
      }
      if (g.pts.size > 0) return;
      const tap = !g.moved && !g.overUi && !this.sheet;
      g.start = null;
      if (tap) this.onShipTap(p.worldX, p.worldY);
    };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
  }

  /** A tap on the ship view: the tile under the finger acts; a double-tap on empty space resets the view. */
  private onShipTap(x: number, y: number): void {
    const fn = this.tileActions.get(cellKey(cellAt(this.pan, this.zoom, x, y)));
    if (fn) {
      this.gesture.lastTap = 0;
      fn();
      return;
    }
    if (this.moveUid !== null) { this.cancelMove(); return; }
    const now = this.time.now;
    if (now - this.gesture.lastTap < DOUBLE_TAP_MS) {
      this.gesture.lastTap = 0;
      this.resetView();
    } else {
      this.gesture.lastTap = now;
    }
  }

  /** Scroll so a (newly bought) tile is visible. */
  private focusCell(c: Cell): void {
    this.panGoal = panToShow(this.panGoal, c, this.limits, this.zoom);
  }

  /** World (screen) position of the centre of a template cell, following the current pan. */
  private cellWorld(c: Cell): { x: number; y: number } {
    const p = localPos(c);
    return { x: this.pan.x + (p.x + TILE / 2) * this.zoom, y: this.pan.y + (p.y + TILE / 2) * this.zoom };
  }

  private inView(p: Phaser.Input.Pointer): boolean {
    return p.worldX >= VIEW.x && p.worldX < VIEW.x + VIEW.w && p.worldY >= VIEW.y && p.worldY < VIEW.y + VIEW.h;
  }

  /** Text that lives inside the zoomed ship container: rasterise for the deepest zoom so it stays sharp. */
  private shipTxt(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { ...style, resolution: Math.min(6, DPR * ZOOM_MAX) });
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
    // the arrows are a backup: once the player has swiped the ship, they go away
    const a = this.swiped ? { left: false, right: false, up: false, down: false } : arrowsFor(this.pan, this.limits);
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
    const trim = rank(this.state) >= RANK.partner ? GOLD_TRIM : undefined;
    drawHullExterior(g, owned, finished, new Set(this.ghostCells().map((c) => `${toScreen(c).col},${toScreen(c).row}`)), trim);
    for (const c of owned) {
      const { x, y } = this.px(c);
      g.fillStyle(C.deck, 1).fillRoundedRect(x + 2, y + 2, TILE - 4, TILE - 4, 8);
      g.lineStyle(2, C.deckEdge, 1).strokeRoundedRect(x + 2, y + 2, TILE - 4, TILE - 4, 8);
    }

    // modules from the saved state; empty owned tiles are 'Open' and tap through to the Build sheet
    const mods = this.state.ship.modules;
    const byCell = new Map(mods.map((m) => [m.cell, m]));
    const beamIndex = (uid: number) => this.state.beams.findIndex((b) => b.uid === uid);
    // taps are resolved by the ship-view gesture handler (tap vs swipe vs pinch), cell by cell
    const hitZone = (c: Cell, fn: () => void) => { this.tileActions.set(cellKey(c), fn); };
    for (const c of owned) {
      const key = cellKey(c);
      const m = byCell.get(key);
      const moving = this.moveUid !== null;
      if (!m) {
        this.placeholder(owned, c, 0x18223f, 'Open', true);
        hitZone(c, () => (moving ? this.dropModule(key) : this.showBuildSheet(key)));
      } else if (m.defId === 'beam' || m.defId === 'grapple') {
        const grapple = m.defId === 'grapple';
        this.placeholder(owned, c, grapple ? GRAPPLE_COLOR : C.beamDeep, '');
        if (grapple) this.grappleGlyph(c);
        hitZone(c, () => (moving ? this.cancelMove() : this.onBeamTap(beamIndex(m.uid))));
      } else if (m.defId === 'solar') {
        this.solarTile(c);
        hitZone(c, () => (moving ? this.cancelMove() : this.showSolarSheet(m.uid)));
      } else if (m.defId === 'engine') {
        this.placeholder(owned, c, ENGINE_COLOR, 'Engine');
        hitZone(c, () => (moving ? this.cancelMove() : this.showEngineSheet(m.uid)));
      } else if (m.defId === 'winch') {
        this.placeholder(owned, c, 0x8a6a2a, 'Winch');
        hitZone(c, () => (moving ? this.cancelMove() : this.showWinchSheet(m.uid)));
      } else if (m.defId === 'smasher') {
        const rusty = !this.state.smashers.find((u) => u.uid === m.uid)?.repaired;
        this.placeholder(owned, c, rusty ? 0x6b5648 : C.crusher, rusty ? 'Rusty' : 'Smash');
        hitZone(c, () => (moving ? this.cancelMove() : this.showSmasherSheet(m.uid)));
      } else if (m.defId === 'smelter') {
        this.placeholder(owned, c, SMELTER_COLOR, 'Smelt');
        hitZone(c, () => (moving ? this.cancelMove() : this.showSmelterSheet(m.uid)));
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

  /** Solar Wing tile: a blue panel with cell lines, readable in greyscale by its stripes. */
  private solarTile(cell: Cell): void {
    const { x, y } = this.px(cell);
    const g = this.add.graphics();
    g.fillStyle(SOLAR_COLOR, 1).fillRoundedRect(x + 7, y + 7, TILE - 14, TILE - 14, 8);
    g.lineStyle(2, 0x9fd0ff, 0.8);
    for (let i = 1; i < 4; i++) g.lineBetween(x + 7 + ((TILE - 14) * i) / 4, y + 10, x + 7 + ((TILE - 14) * i) / 4, y + TILE - 10);
    g.lineBetween(x + 10, y + TILE / 2, x + TILE - 10, y + TILE / 2);
    const t = this.shipTxt(x + TILE / 2, y + TILE / 2, 'Solar', { fontFamily: FONT, fontSize: '12px', fontStyle: '600', color: T.text, stroke: '#0B1020', strokeThickness: 3 }).setOrigin(0.5);
    this.layer.add([g, t]);
  }

  /** A claw mark on the Grapple tile so it differs from a Tractor Beam without colour. */
  private grappleGlyph(cell: Cell): void {
    const { x, y } = this.px(cell);
    const g = this.add.graphics();
    const cx = x + TILE / 2, cy = y + TILE / 2 + 10;
    g.lineStyle(3, 0xbff5ef, 0.9);
    g.lineBetween(cx - 9, cy + 4, cx - 4, cy - 4);
    g.lineBetween(cx + 9, cy + 4, cx + 4, cy - 4);
    g.lineBetween(cx - 4, cy - 4, cx + 4, cy - 4);
    this.layer.add(g);
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
      this.tileActions.set(cellKey(c), () => this.tryBuy(c));
      this.layer.add([g, label]);
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
    // pills: credits always, then Ore, Plate and Ice as they first appear (progressive reveal)
    const pills: { value: number; icon: (g: Phaser.GameObjects.Graphics, cx: number, cy: number) => void }[] = [
      { value: st.credits, icon: (g, cx, cy) => g.fillStyle(C.crit, 1).fillCircle(cx, cy, 10) },
    ];
    if (st.stats.rocks > 0 || st.items.ore > 0) pills.push({ value: st.items.ore, icon: (g, cx, cy) => g.fillStyle(ITEM_LOOK.ore.color, 1).fillCircle(cx, cy, 9) });
    if (st.stats.smelted > 0 || st.items.plate > 0) pills.push({ value: st.items.plate, icon: (g, cx, cy) => g.fillStyle(ITEM_LOOK.plate.color, 1).fillRoundedRect(cx - 9, cy - 9, 18, 18, 4) });
    if (st.items.ice > 0 || st.travel.visited.length > 1) {
      pills.push({ value: st.items.ice, icon: (g, cx, cy) => g.fillStyle(ITEM_LOOK.ice.color, 1).fillTriangle(cx, cy - 11, cx + 8, cy, cx, cy + 11).fillTriangle(cx, cy - 11, cx - 8, cy, cx, cy + 11) });
    }
    const PW = Math.floor((CW - 3 * 8) / 4);
    pills.forEach((p, i) => {
      const x = 16 + i * (PW + 8);
      const g = this.add.graphics();
      g.fillStyle(C.panel, 1).fillRoundedRect(x, 14, PW, 40, 20);
      g.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(x, 14, PW, 40, 20);
      p.icon(g, x + 22, 34);
      const t = this.txt(x + 38, 34, fmtNum(p.value), { fontFamily: FONT, fontSize: '20px', fontStyle: '600', color: T.text }).setOrigin(0, 0.5);
      this.hud.add([g, t]);
    });

    const goal = currentGoal(st);
    const chipText = this.moveUid !== null ? 'Tap a glowing Open tile to drop it there' : hudChipText(st);
    const chip = this.add.graphics();
    chip.fillStyle(C.panel, 1).fillRoundedRect(16, 66, CW - 52, 44, 22);
    chip.lineStyle(3, goal ? C.crit : C.panelEdge, 1).strokeRoundedRect(16, 66, CW - 52, 44, 22);
    const chipLabel = this.txt(16 + (CW - 52) / 2, 88, chipText, {
      fontFamily: FONT, fontSize: '14px', color: T.text, fixedWidth: CW - 88, align: 'center', wordWrap: { width: CW - 88 },
    }).setOrigin(0.5);
    // gear button: opens the menu
    const gear = this.add.graphics();
    const gx = W - 38, gy = 88;
    gear.fillStyle(C.panel, 1).fillRoundedRect(gx - 22, gy - 22, 44, 44, 22);
    gear.lineStyle(3, this.sheetKind === 'menu' ? C.crit : C.panelEdge, 1).strokeRoundedRect(gx - 22, gy - 22, 44, 44, 22);
    gear.lineStyle(5, 0xaeb9d6, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      gear.lineBetween(gx + Math.cos(a) * 8, gy + Math.sin(a) * 8, gx + Math.cos(a) * 12.5, gy + Math.sin(a) * 12.5);
    }
    gear.fillStyle(0xaeb9d6, 1).fillCircle(gx, gy, 9);
    gear.fillStyle(C.panel, 1).fillCircle(gx, gy, 3.5);
    this.hud.add([chip, chipLabel, gear]);

    if (!st.flags.tappedBeam) {
      const bw = this.cellWorld(this.moduleCell('beam', 0) ?? { x: 2, y: 0 });
      const bx = bw.x;
      const top = bw.y - 28 * this.zoom - 8 - 26 - 14; // above the nose tile (and its canopy)
      const b = this.add.graphics();
      b.fillStyle(C.highlight, 1).fillRoundedRect(bx - 62, top, 124, 26, 13);
      b.fillTriangle(bx - 7, top + 25, bx + 7, top + 25, bx, top + 33);
      const bt = this.txt(bx, top + 13, 'Tap the beam.', { fontFamily: FONT, fontSize: '14px', fontStyle: '600', color: '#0B1020' }).setOrigin(0.5);
      this.hud.add([b, bt]);
    }

    if (this.debug) {
      const mk = (x: number, label: string, fn: () => void) => {
        const t = this.txt(Math.round((x * W) / 390), 436, label, { fontFamily: FONT, fontSize: '13px', color: T.coral })
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
    const map = this.sheetKind === 'map';
    const jobs = this.sheetKind === 'jobs';
    const dot = (cx: number) => {
      const d = this.add.graphics();
      d.fillStyle(C.space, 1).fillCircle(cx + 20, H - 68, 9);
      d.fillStyle(C.crit, 1).fillCircle(cx + 20, H - 68, 6.5);
      this.hud.add(d);
    };
    tab(TAB_X.ship, 'Ship', !workshop && !map && !jobs);
    tab(TAB_X.build, 'Build', workshop);
    tab(TAB_X.map, 'Map', map);
    tab(TAB_X.jobs, 'Jobs', jobs);
    if (!workshop && readyUpgrades(this.state) > 0) dot(TAB_X.build);
    if (!map && canDepart(this.state).ok) dot(TAB_X.map);
    if (!jobs && finishableJobs(this.state) > 0) dot(TAB_X.jobs);
  }

  private showToast(msg: string): void {
    this.toast?.destroy();
    const t = this.txt(W / 2, H - 130, msg, {
      fontFamily: FONT, fontSize: '16px', color: T.text, backgroundColor: '#2B3550', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(40);
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
    this.floatText(w.x, Math.max(VIEW.y + 16, w.y - 28 * this.zoom - 6), msg, color);
  }

  /** Floating text over the tile of the module with this uid (falls back to nothing if it is gone). */
  private floatAtUid(uid: number | undefined, msg: string, color: string): void {
    const m = this.state.ship.modules.find((x) => x.uid === uid);
    if (!m) return;
    this.floatAtModule(m.defId, this.state.ship.modules.filter((x) => x.defId === m.defId).indexOf(m), msg, color);
  }

  /** Tap a beam tile: fires that beam. */
  private onBeamTap(index = 0): void {
    const beam = this.state.beams[index];
    if (!beam) return;
    if (beam.status === 'idle' && !evaluatePower(this.state).powered.has(beam.uid)) {
      this.showToast('No power. Build a Solar Wing nearby.');
      return;
    }
    const out = tapBeam(this.state, index);
    if (out.state === this.state) return;
    this.apply(out.state);
    this.floatAtUid(beam.uid, beam.kind === 'grapple' ? 'Grapple on' : 'Beam on', T.gold);
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
    if (this.sheetKind === 'power-notice' && this.state.flags.powerNotice > 0) {
      this.state = { ...this.state, flags: { ...this.state.flags, powerNotice: 0 } };
      this.persist();
    }
    this.sheet?.destroy(true);
    this.sheet = undefined;
    this.sheetBuild = undefined;
    if (this.sheetKind) {
      this.sheetKind = '';
      this.redraw(); // tab highlight
    }
  }

  /** Open (or refresh) a sheet. `build` is re-run after every purchase so costs and levels stay current. */
  private showSheet(kind: string, build: () => SheetSpec): void {
    this.sheet?.destroy(true);
    const changed = this.sheetKind !== kind;
    if (changed) this.sheetScroll = 0;
    this.sheetKind = kind;
    this.sheetBuild = build;
    const spec = build();
    this.sheet = this.renderSheet(spec.title, spec.rows, spec.footer);
    if (changed) this.redraw();
  }

  private refreshSheet(): void {
    if (this.sheetBuild) this.showSheet(this.sheetKind, this.sheetBuild);
  }

  private renderSheet(title: string, rows: SheetRow[], footer?: SheetFooter): Phaser.GameObjects.Container {
    const X = 36, WID = CW - 40, BTN_W = 136, TXT_W = WID - BTN_W - 12, HEAD = 58, BOTTOM = footer ? ACTION.y - 8 : H - 92; // a footer sheet ends above the Sell button, so opening it cannot tap its footer
    const FOOT = footer ? 66 : 0;
    const CG_SELL = 88, CG_TXT = WID - 64 - CG_SELL - 8; // Cargo row: tick box + icon, text, Sell button
    const box = this.add.container(0, 0).setDepth(30);
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55).setInteractive();
    dim.on('pointerdown', () => this.closeSheet());
    box.add(dim);

    const laid = rows.map((row) => {
      if (row.t === 'text') {
        const a = this.txt(X, 0, row.text, { fontFamily: FONT, fontSize: '15px', color: row.color ?? T.dim, wordWrap: { width: WID } });
        return { row, a, b: undefined as Phaser.GameObjects.Text | undefined, h: a.height + 14 };
      }
      if (row.t === 'button' || row.t === 'hold') return { row, a: undefined, b: undefined, h: 70 };
      if (row.t === 'heading') {
        const a = this.txt(X, 0, row.text, { fontFamily: FONT, fontSize: '17px', fontStyle: '600', color: T.text, wordWrap: { width: WID } });
        return { row, a, b: undefined as Phaser.GameObjects.Text | undefined, h: a.height + 14 };
      }
      if (row.t === 'cargo') {
        const a = this.txt(X + 64, 0, `${ITEM_LOOK[row.item].name}  x${fmtNum(row.count)}`, { fontFamily: FONT, fontSize: '16px', fontStyle: '600', color: T.text, wordWrap: { width: CG_TXT } });
        const b = this.txt(X + 64, 0, row.note, { fontFamily: FONT, fontSize: '12px', color: T.dim, wordWrap: { width: CG_TXT } });
        return { row, a, b, h: Math.max(80, a.height + b.height + 24) };
      }
      if (row.t === 'switch') {
        const a = this.txt(X, 0, row.title, { fontFamily: FONT, fontSize: '16px', fontStyle: '600', color: T.text, wordWrap: { width: WID - 80 } });
        const b = this.txt(X, 0, row.sub, { fontFamily: FONT, fontSize: '12px', color: T.dim, wordWrap: { width: WID - 80 } });
        return { row, a, b, h: Math.max(64, a.height + b.height + 20) };
      }
      const a = this.txt(X, 0, row.title, { fontFamily: FONT, fontSize: '17px', fontStyle: '600', color: T.text, wordWrap: { width: TXT_W } });
      const b = this.txt(X, 0, row.sub, { fontFamily: FONT, fontSize: '13px', color: T.dim, wordWrap: { width: TXT_W } });
      return { row, a, b, h: Math.max(row.t === 'job' ? 104 : 68, a.height + b.height + 20) };
    });
    const bodyH = laid.reduce((n, l) => n + l.h, 0);
    const panelH = Math.min(BOTTOM - 110, HEAD + bodyH + 16 + FOOT);
    const panelY = BOTTOM - panelH;
    const viewTop = panelY + HEAD - 4, viewBottom = panelY + panelH - 10 - FOOT;
    const maxScroll = Math.max(0, bodyH - (viewBottom - (panelY + HEAD)));
    this.sheetScroll = Math.min(Math.max(0, this.sheetScroll), maxScroll);

    const panel = this.add.graphics();
    panel.fillStyle(C.panel, 1).fillRoundedRect(16, panelY, CW, panelH, 26);
    panel.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(16, panelY, CW, panelH, 26);
    const absorb = this.add.zone(W / 2, panelY + panelH / 2, CW, panelH).setInteractive();
    box.add([panel, absorb]);
    box.add(this.txt(X, panelY + 18, title, { fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: T.text }));
    // scrolling body: everything below the header lives in `body`, clipped to the panel
    const body = this.add.container(0, -this.sheetScroll);
    box.add(body);
    const clip = this.make.graphics({ x: 0, y: 0 }, false);
    clip.fillStyle(0xffffff, 1).fillRect(16, viewTop, CW, viewBottom - viewTop);
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
      bar.fillStyle(C.ghost, 0.7).fillRoundedRect(W - 24, y, 4, h, 2);
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
      } else if (l.row.t === 'heading') {
        l.a!.setY(y + 4);
        body.add(l.a!);
      } else if (l.row.t === 'switch') {
        const row = l.row;
        l.a!.setY(y + 8);
        l.b!.setY(y + 8 + l.a!.height + 2);
        const px = X + WID - 54, py = y + l.h / 2 - 15;
        const g = this.add.graphics();
        g.fillStyle(row.on ? C.beamDeep : C.panelEdge, 1).fillRoundedRect(px, py, 54, 30, 15);
        g.fillStyle(0xffffff, 1).fillCircle(row.on ? px + 39 : px + 15, py + 15, 11);
        g.lineStyle(1, C.panelEdge, 1).lineBetween(X, y + l.h - 1, X + WID, y + l.h - 1);
        const z = this.add.zone(X + WID / 2, y + l.h / 2, WID, l.h - 4).setInteractive();
        z.on('pointerdown', begin);
        z.on('pointerup', (p: Phaser.Input.Pointer) => { if (tapOk(p)) row.fn(); });
        zones.push({ z, top: y, bottom: y + l.h });
        body.add([g, l.a!, l.b!, z]);
      } else if (l.row.t === 'cargo') {
        const row = l.row;
        const look = ITEM_LOOK[row.item];
        const g = this.add.graphics();
        g.lineStyle(1, C.panelEdge, 1).lineBetween(X, y + l.h - 1, X + WID, y + l.h - 1);
        const cy = y + l.h / 2;
        if (row.forSale) {
          g.lineStyle(3, row.ticked ? C.crit : C.ghost, 1).strokeRoundedRect(X, cy - 13, 26, 26, 7);
          if (row.ticked) g.fillStyle(C.crit, 1).fillRoundedRect(X + 5, cy - 8, 16, 16, 4);
        }
        g.fillStyle(look.color, 1).fillCircle(X + 42, cy, 9);
        g.lineStyle(2, C.hullOutline, 1).strokeCircle(X + 42, cy, 9);
        l.a!.setY(y + 9);
        l.b!.setY(y + 9 + l.a!.height + 1);
        // two stacked buttons: Sell 1 on top, Sell all (the whole surplus) below
        const bx = X + WID - CG_SELL, by = cy - 35, bh = 32;
        const ok = row.forSale && row.canSell;
        const inkC = ok ? '#0B1020' : T.dim;
        g.fillStyle(ok ? C.crit : C.panelEdge, 1).fillRoundedRect(bx, by, CG_SELL, bh, 14);
        g.fillStyle(ok ? C.crit : C.panelEdge, 1).fillRoundedRect(bx, by + bh + 6, CG_SELL, bh, 14);
        const lab1 = this.txt(bx + CG_SELL / 2, by + bh / 2, row.forSale ? 'Sell 1' : 'Keep', { fontFamily: FONT, fontSize: '15px', fontStyle: '600', color: inkC, align: 'center' }).setOrigin(0.5);
        const lab = this.txt(bx + CG_SELL / 2, by + bh + 6 + bh / 2, row.sellLabel, { fontFamily: FONT, fontSize: '15px', fontStyle: '600', color: inkC, align: 'center' }).setOrigin(0.5);
        body.add([g, l.a!, l.b!, lab1, lab]);
        if (row.forSale) {
          const oz = this.add.zone(bx + CG_SELL / 2, by + bh / 2, CG_SELL, bh + 4).setInteractive();
          oz.on('pointerdown', begin);
          oz.on('pointerup', (p: Phaser.Input.Pointer) => { if (tapOk(p) && ok) row.onSellOne(); });
          zones.push({ z: oz, top: by, bottom: by + bh });
          body.add(oz);
        }
        if (row.forSale) {
          const tz = this.add.zone(X + 13, cy, 44, 56).setInteractive();
          tz.on('pointerdown', begin);
          tz.on('pointerup', (p: Phaser.Input.Pointer) => { if (tapOk(p)) row.onTick(); });
          zones.push({ z: tz, top: cy - 28, bottom: cy + 28 });
          body.add(tz);
        }
        const sz = this.add.zone(bx + CG_SELL / 2, by + bh + 6 + bh / 2, CG_SELL, bh + 4).setInteractive();
        sz.on('pointerdown', begin);
        sz.on('pointerup', (p: Phaser.Input.Pointer) => { if (tapOk(p) && ok) row.onSell(); });
        zones.push({ z: sz, top: by + bh + 6, bottom: by + 2 * bh + 6 });
        body.add(sz);
      } else if (l.row.t === 'hold') {
        // hold-to-confirm: the fill grows while the finger stays down; letting go cancels
        const row = l.row;
        const g = this.add.graphics();
        const lab = this.txt(W / 2, y + 34, row.label, { fontFamily: FONT, fontSize: '18px', fontStyle: '600', color: '#0B1020' }).setOrigin(0.5);
        const draw = (f: number) => {
          g.clear();
          g.fillStyle(C.panelEdge, 1).fillRoundedRect(X, y + 8, WID, 52, 26);
          if (f > 0) {
            const wd = Math.max(52, WID * f);
            g.fillStyle(C.coral, 1).fillRoundedRect(X, y + 8, wd, 52, 26);
          }
          g.lineStyle(3, C.coral, 1).strokeRoundedRect(X, y + 8, WID, 52, 26);
        };
        draw(0);
        lab.setColor(T.text);
        const prog = { v: 0 };
        let tw: Phaser.Tweens.Tween | undefined;
        const cancel = () => {
          if (!tw) return;
          tw.stop(); tw = undefined; prog.v = 0; draw(0);
        };
        const z = this.add.zone(W / 2, y + 34, WID, 52).setInteractive();
        z.on('pointerdown', (p: Phaser.Input.Pointer) => {
          begin(p);
          cancel();
          tw = this.tweens.add({
            targets: prog, v: 1, duration: HOLD_RESET_MS, ease: 'Linear',
            onUpdate: () => { if (moved) cancel(); else draw(prog.v); },
            onComplete: () => { tw = undefined; row.fn(); },
          });
        });
        z.on('pointerup', cancel);
        z.on('pointerout', cancel);
        z.on('pointerupoutside', cancel);
        box.once('destroy', () => tw?.stop());
        zones.push({ z, top: y + 8, bottom: y + 60 });
        body.add([g, lab, z]);
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
      } else if (l.row.t === 'job') {
        // a job card: Deliver (big) with a small Skip under it
        const row = l.row;
        l.a!.setY(y + 6);
        l.b!.setY(y + 6 + l.a!.height + 2);
        const bx = X + WID - BTN_W, by = y + 8;
        const g = this.add.graphics();
        g.fillStyle(row.can ? C.crit : C.panelEdge, 1).fillRoundedRect(bx, by, BTN_W, 48, 16);
        g.lineStyle(1, C.panelEdge, 1).lineBetween(X, y + l.h - 1, X + WID, y + l.h - 1);
        const verb = this.txt(bx + BTN_W / 2, by + 24, row.verb, { fontFamily: FONT, fontSize: '16px', fontStyle: '600', color: row.can ? '#0B1020' : T.dim, align: 'center', wordWrap: { width: BTN_W - 10 } }).setOrigin(0.5);
        const skip = this.txt(bx + BTN_W / 2, by + 68, row.skip, { fontFamily: FONT, fontSize: '13px', color: row.canSkip ? T.text : '#6F7FA8' }).setOrigin(0.5);
        if (row.canSkip) g.lineStyle(2, C.ghost, 1).strokeRoundedRect(bx + 18, by + 54, BTN_W - 36, 28, 14);
        body.add([g, l.a!, l.b!, verb, skip]);
        const z = this.add.zone(bx + BTN_W / 2, by + 24, BTN_W, 48).setInteractive();
        z.on('pointerdown', begin);
        z.on('pointerup', (p: Phaser.Input.Pointer) => { if (tapOk(p)) row.fn(); });
        zones.push({ z, top: by, bottom: by + 48 });
        const sz = this.add.zone(bx + BTN_W / 2, by + 68, BTN_W - 20, 32).setInteractive();
        sz.on('pointerdown', begin);
        sz.on('pointerup', (p: Phaser.Input.Pointer) => { if (tapOk(p) && row.canSkip) row.onSkip(); });
        zones.push({ z: sz, top: by + 52, bottom: by + 84 });
        body.add([z, sz]);
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
    if (footer) {
      const fy = panelY + panelH - 10 - 46; // lands where the Sell button sits on the main screen
      const fg = this.add.graphics();
      fg.fillStyle(footer.can ? C.crit : C.panelEdge, 1).fillRoundedRect(X, fy, WID, 46, 23);
      fg.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(X, fy, WID, 46, 23);
      const fl = this.txt(W / 2, fy + 23, footer.label, { fontFamily: FONT, fontSize: '18px', fontStyle: '600', color: footer.can ? '#0B1020' : T.dim }).setOrigin(0.5);
      const fz = this.add.zone(W / 2, fy + 23, WID, 46).setInteractive();
      let pressed = false; // only a press that started on the footer counts (the finger that opened the sheet must not)
      fz.on('pointerdown', () => { pressed = true; });
      fz.on('pointerout', () => { pressed = false; });
      fz.on('pointerup', () => { if (pressed && footer.can) footer.fn(); pressed = false; });
      box.add([fg, fl, fz]);
    }
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
      const tractors = st.beams.filter((b) => b.kind === 'tractor').length;
      let tn = 0;
      st.beams.forEach((b, i) => {
        if (b.kind === 'grapple') {
          const nx = GRAPPLE.levels[b.level];
          rows.push(this.upgradeCard(
            `Grapple Beam · ${GRAPPLE.levels[b.level - 1].name}`,
            nx ? `Next: ${nx.name}. Countdown ${(GRAPPLE.countdown * nx.cdMul).toFixed(1)}s.` : '',
            nextBeamUpgrade(st, i), () => upgradeBeam(this.state, i), 'Grapple upgraded',
          ));
          return;
        }
        tn += 1;
        const nx = BEAM.levels[b.level];
        const name = tractors > 1 ? `Beam ${tn}` : 'Tractor Beam';
        rows.push(this.upgradeCard(
          `${name} · ${beamLevels(b)[b.level - 1].name}`,
          nx ? `Next: ${nx.name}. Rocks carry ${Math.round((nx.oreMul - 1) * 100)}% more Ore.` : '',
          nextBeamUpgrade(st, i), () => upgradeBeam(this.state, i), 'Beam upgraded',
        ));
      });
      st.smelters.forEach((m, i) => {
        const nx = SMELTER.levels[m.level];
        const name = st.smelters.length > 1 ? `Smelter ${i + 1}` : 'Smelter';
        rows.push(this.upgradeCard(
          `${name} · ${SMELTER.levels[m.level - 1].name}`,
          nx ? `Next: ${nx.name}. One Plate every ${nx.secPerBatch.toFixed(1)}s.` : '',
          nextSmelterUpgrade(st, i), () => upgradeSmelter(this.state, i), 'Smelter upgraded',
        ));
      });
      st.smashers.forEach((m, i) => {
        const name = st.smashers.length > 1 ? `Rock Smasher ${i + 1}` : 'Rock Smasher';
        if (!m.repaired) {
          rows.push({
            t: 'card', title: `${name} · Rusty`, sub: 'Fix it and it smashes rocks while you do other things.',
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
          const nx = SMASHER.levels[m.level];
          rows.push(this.upgradeCard(
            `${name} · Level ${m.level}`,
            nx ? `Next: ${nx.hpPerSec} HP/s, holds ${nx.queue}${m.level + 1 >= SMASHER.autoIntakeLevel ? ', feeds itself from the Bay' : ''}.` : '',
            nextSmasherUpgrade(st, i), () => upgradeSmasher(this.state, i), 'Smasher upgraded',
          ));
        }
      });
      for (const m of st.ship.modules) {
        if (m.defId === 'solar') rows.push(this.solarCard(m.uid));
        if (m.defId === 'engine') rows.push(this.engineCard(m.uid));
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
      const power = evaluatePower(st);
      const spare = power.supply - power.draw;
      const rows: SheetRow[] = [];
      const options: { id: ModuleId; sub: string }[] = [
        { id: 'smelter', sub: 'Turns 3 Ore into 1 Plate on its own. Plate fixes the Smasher and pays for bigger hull tiles.' },
        { id: 'smasher', sub: 'Another Smasher breaks rocks while you do other things. It arrives repaired. Smash feeds the one with most room.' },
        { id: 'beam', sub: 'Pulls in another asteroid. Fire starts every beam at once.' },
        { id: 'solar', sub: `Makes ${SOLAR.levels[0].output} power for modules up to ${SOLAR.levels[0].reach} tiles away. Anything touching it works 15% faster.` },
        { id: 'engine', sub: 'Flies the ship to new fields on the Map. Your beams keep working while you cruise.' },
        { id: 'grapple', sub: `A slow beam (${GRAPPLE.countdown}s) that pulls one big rock. Here and further on: Heavy rocks full of Ore and Ice.` },
        { id: 'winch', sub: 'Fires every beam it touches as soon as the Bay has room, even while you are busy. Put it next to your beams.' },
      ];
      const placeHelp: Record<string, string> = {
        edge: 'Needs an outside tile, one with a side facing open space.',
        rear: 'Needs a back tile: open space behind it (to its right on screen).',
      };
      for (const o of options) {
        const cost = moduleCost(st, o.id);
        if (!cost || !moduleUnlocked(st, o.id)) continue;
        const placement = placementOf(o.id);
        const fits = fitsPlacement(owned, cell, placement);
        const draw = POWER.draw[o.id];
        const powerNote = draw > 0 ? ` Uses ${draw} power (${Math.max(0, spare)} spare).` : '';
        const can = fits && canAfford(st, cost) === 'ok';
        rows.push({
          t: 'card', title: moduleCount(st, o.id) > 0 ? `${MODULES[o.id].name} ${moduleCount(st, o.id) + 1} of ${MODULES[o.id].costs.length}` : MODULES[o.id].name,
          sub: fits ? `${o.sub}${powerNote}` : placeHelp[placement],
          verb: 'Build', cost: costText(cost), can,
          fn: () => {
            const r = placeModule(this.state, o.id, cell);
            if (!r.ok) {
              const why: Record<string, string> = { not_edge: 'Needs an outside tile', not_rear: 'Needs a back tile', need_items: 'Not enough materials', need_credits: 'Not enough credits' };
              this.showToast(why[r.reason] ?? 'Cannot build there');
              return;
            }
            this.apply(r.state);
            this.closeSheet();
            const uid = r.state.ship.modules[r.state.ship.modules.length - 1].uid;
            this.floatAtUid(uid, 'Built!', T.gold);
            if (draw > 0 && !evaluatePower(r.state).powered.has(uid)) this.showToast('Built, but it has no power yet. Add a Solar Wing nearby.');
          },
        });
      }
      if (rows.length === 0) rows.push({ t: 'text', text: 'Nothing to build here yet. New modules arrive as your ship grows.' });
      return { title: 'Open tile', rows };
    });
  }

  /** Workshop / tile-sheet row for a Solar Wing upgrade. */
  private solarCard(uid: number): SheetRow {
    const m = this.state.ship.modules.find((x) => x.uid === uid)!;
    const lv = solarLevel(m);
    const nx = SOLAR.levels[m.level ?? 1];
    const n = this.state.ship.modules.filter((x) => x.defId === 'solar');
    const name = n.length > 1 ? `Solar Wing ${n.indexOf(m) + 1}` : 'Solar Wing';
    return this.upgradeCard(
      `${name} · ${lv.name}`,
      nx ? `Next: ${nx.name}. ${nx.output} power, reaches ${nx.reach} tiles.` : '',
      nextModuleUpgrade(this.state, uid), () => upgradeModule(this.state, uid), 'Solar upgraded',
    );
  }

  private engineCard(uid: number): SheetRow {
    const m = this.state.ship.modules.find((x) => x.uid === uid)!;
    const lv = engineLevel(m);
    const nx = ENGINE.levels[m.level ?? 1];
    return this.upgradeCard(
      `Engine · ${lv.name}`,
      nx ? `Next: ${nx.name}. Trips take ${Math.round((1 - 1 / nx.speed) * 100)}% less time.` : '',
      nextModuleUpgrade(this.state, uid), () => upgradeModule(this.state, uid), 'Engine upgraded',
    );
  }

  /** Solar Wing tile: what it powers, upgrade, move, sell. */
  private showSolarSheet(uid: number): void {
    this.sellArm = null;
    this.showSheet(`solar:${uid}`, () => {
      const st = this.state;
      const m = st.ship.modules.find((x) => x.uid === uid);
      if (!m) { this.closeSheet(); return { title: 'Solar Wing', rows: [] }; }
      const lv = solarLevel(m);
      const power = evaluatePower(st);
      const rows: SheetRow[] = [
        { t: 'text', text: `Makes ${lv.output} power for modules up to ${lv.reach} tiles away, nearest first. Modules touching it get a Boost (15% faster, blue diamond). The hull adds ${POWER.hullBase} power of its own.` },
        { t: 'text', text: `Ship power: ${power.draw} used of ${power.supply}.${power.unpowered.length ? ` ${power.unpowered.length} module${power.unpowered.length > 1 ? 's have' : ' has'} no power.` : ''}`, color: power.unpowered.length ? T.coral : T.text },
        this.solarCard(uid),
        ...this.moveSellRows(uid),
      ];
      return { title: 'Solar Wing', rows };
    });
  }

  /** Auto-Winch tile: what it does, which beams it is touching, move, sell. */
  private showWinchSheet(uid: number): void {
    this.sellArm = null;
    this.showSheet(`winch:${uid}`, () => {
      const st = this.state;
      const n = winchedBeams(st).size;
      const live = evaluatePower(st).powered.has(uid);
      return {
        title: 'Auto-Winch',
        rows: [
          { t: 'text', text: `Fires every beam touching it as soon as the Bay has room. ${n > 0 ? `It is working ${n} beam${n > 1 ? 's' : ''} now.` : 'It touches no beam yet: Move it next to one.'}${live ? '' : ' It has no power.'}`, color: n > 0 && live ? T.text : T.coral },
          ...this.moveSellRows(uid),
        ],
      };
    });
  }

  /** Engine tile: speed, Depart, upgrade, move, sell. */
  private showEngineSheet(uid: number): void {
    this.sellArm = null;
    this.showSheet(`engine:${uid}`, () => {
      const st = this.state;
      const m = st.ship.modules.find((x) => x.uid === uid);
      if (!m) { this.closeSheet(); return { title: 'Engine', rows: [] }; }
      const power = evaluatePower(st);
      const live = power.powered.has(uid);
      const rows: SheetRow[] = [
        { t: 'text', text: `Flies the ship along the route on the Map. Uses ${POWER.draw.engine} power.${live ? '' : ' It has no power right now, so the ship cannot fly.'}`, color: live ? T.dim : T.coral },
        this.departCard(),
        this.engineCard(uid),
        ...this.moveSellRows(uid),
      ];
      return { title: 'Engine', rows };
    });
  }

  /** The Depart row (Map and Engine sheet): fly to the next stop, or why not. */
  private departCard(): SheetRow {
    const st = this.state;
    const next = ROUTE[st.travel.node + 1];
    if (inTransit(st)) {
      const eta = etaSec(st);
      return { t: 'card', title: `Cruising to ${ROUTE[st.travel.dest!].name}`, sub: eta === null ? 'Stalled: the Engine has no power.' : `Arriving in ${this.clock(eta)}.`, verb: 'Under way', cost: '', can: false, fn: () => undefined };
    }
    if (!next) return { t: 'card', title: 'End of the route', sub: '', verb: 'Depart', cost: '', can: false, fn: () => undefined };
    const chk = canDepart(st);
    const leg = nextLegSec(st);
    return {
      t: 'card', title: `Next: ${next.name}`, sub: `${next.blurb}${leg !== null && next.open ? ` About ${this.clock(leg)} away.` : ''}`,
      verb: 'Depart', cost: chk.ok ? '' : chk.label, can: chk.ok,
      fn: () => {
        const out = depart(this.state);
        if (out.state === this.state) { const c = canDepart(this.state); if (!c.ok) this.showToast(c.label); return; }
        this.apply(out.state);
        this.closeSheet();
        this.showToast(`Under way to ${next.name}`);
      },
    };
  }

  /** "50 Ore (20 in) · 10 Plate" for a job card. */
  private jobWants(job: NonNullable<GameState['jobs']['slots'][number]>): string {
    return JOB_ITEMS.filter((i) => (job.wants[i] ?? 0) > 0).map((i) => {
      const want = job.wants[i]!, got = job.delivered[i] ?? 0;
      return `${fmtNum(want)} ${ITEM_LOOK[i].name}${got > 0 ? ` (${fmtNum(got)} in)` : ''}`;
    }).join(' · ');
  }

  /** Jobs tab: rank, the job cards (Deliver / Skip), and what each rank unlocks. */
  private showJobs(): void {
    this.mapTimer = 0;
    this.showSheet('jobs', () => {
      const st = this.state;
      const rows: SheetRow[] = [];
      if (!st.jobs.unlocked) {
        rows.push({ t: 'text', text: 'The Job Board opens when your ship has a second Tractor Beam. Jobs ask for materials, pay more than selling, and earn Reputation.', color: T.text });
        return { title: 'Jobs', rows };
      }
      const r = rank(st);
      const toNext = repToNext(st);
      const next = RANKS[r + 1];
      rows.push({ t: 'heading', text: `${RANKS[r].name} · ${st.jobs.rep} Rep` });
      rows.push({ t: 'text', text: next ? `${toNext} more Rep to ${next.name}: ${next.perk}.` : 'Top rank. The fleet knows your name.' });
      const label: Record<string, string> = { quick: 'Quick job', standard: 'Job', local: 'Local job' };
      slotKinds(st).forEach((kind, i) => {
        const job = st.jobs.slots[i];
        if (!job) {
          const wait = st.jobs.refill[i] ?? 0;
          const text = kind === 'local' && inTransit(st)
            ? 'Local job: park at a field to see what it needs.'
            : `${label[kind]}: a new one is posted in ${this.clock(wait)}.`;
          rows.push({ t: 'text', text, color: '#6F7FA8' });
          return;
        }
        const chk = canDeliver(st, i);
        const where = job.node !== undefined ? ` · only at ${ROUTE[job.node].name}` : '';
        const skipCd = st.jobs.skipCd[i] ?? 0;
        rows.push({
          t: 'job',
          title: `${label[kind]} · ${job.client}`,
          sub: `Wants ${this.jobWants(job)}${where}\nPays ${fmtNum(job.credits)} credits + ${job.rep} Rep`,
          verb: chk.ok ? (chk.completes ? 'Finish' : 'Hand over') : chk.label,
          can: chk.ok,
          fn: () => {
            const out = deliverJob(this.state, i);
            if (out.state === this.state) return;
            this.apply(out.state);
            this.handleEvents(out.events, W / 2, VIEW.y + 40);
            if (!out.events.some((e) => e.kind === 'job_done')) {
              const left = JOB_ITEMS.filter((it) => stillNeeds(out.state.jobs.slots[i]!, it) > 0).length;
              this.showToast(left ? 'Handed over. Bring the rest later.' : 'Handed over');
            }
            if (!out.events.some((e) => e.kind === 'rank_up')) this.refreshSheet();
          },
          skip: canSkip(st, i) ? 'Skip' : `Skip in ${this.clock(skipCd)}`,
          canSkip: canSkip(st, i),
          onSkip: () => {
            const out = skipJob(this.state, i);
            if (out.state === this.state) return;
            this.apply(out.state);
            this.refreshSheet();
          },
        });
      });
      rows.push({ t: 'text', text: 'Hand over part of a job now and the rest later; what you hand over is kept safe in the job. A finished slot gets a new job after 10 minutes of play. Skip swaps a job (anything handed in comes back).' });
      rows.push({ t: 'heading', text: 'Reputation ranks' });
      RANKS.forEach((k, i) => {
        if (i === 0) return;
        rows.push({ t: 'text', text: `${k.name} (${k.rep} Rep)${i <= r ? ' · reached' : ''}\n${k.perk}`, color: i <= r ? T.gold : T.dim });
      });
      return { title: 'Jobs', rows };
    });
  }

  /** A short celebration when a rank is reached. */
  private showRankUp(r: number): void {
    const k = RANKS[r];
    this.showSheet('rank', () => ({
      title: `New rank: ${k.name}`,
      rows: [
        { t: 'text', text: `${k.perk}.`, color: T.gold },
        ...(r === RANK.winch ? [{ t: 'text' as const, text: 'Build it on an Open tile next to your beams. It fires them for you as soon as the Bay has room.' }] : []),
        ...(r === RANK.bay ? [{ t: 'text' as const, text: 'Fire one more rock into the Bay before it fills.' }] : []),
        { t: 'button', label: 'Back to the board', fn: () => this.showJobs() },
      ],
    }));
  }

  /** Map tab: the route through the system, where the ship is, and Depart. */
  private showMap(): void {
    this.mapTimer = 0;
    this.showSheet('map', () => {
      const st = this.state;
      const rows: SheetRow[] = [
        { t: 'text', text: 'Fly from field to field. While you cruise your beams pull small drifting rocks (half Ore), and the trip keeps going while you are away.' },
        this.departCard(),
        { t: 'heading', text: SYSTEM.name },
      ];
      ROUTE.forEach((n, i) => {
        const here = !inTransit(st) && st.travel.node === i;
        const passed = st.travel.visited.includes(i) && !here;
        const heading = inTransit(st) && st.travel.dest === i;
        const tag = here ? 'You are here' : heading ? 'On the way' : passed ? 'Visited' : n.open ? 'Ahead' : 'Coming in a later update';
        const color = here ? T.gold : heading ? T.text : n.open ? T.dim : '#6F7FA8';
        rows.push({ t: 'text', text: `${i + 1}. ${n.name} · ${tag}\n${n.blurb}`, color });
      });
      if (inTransit(st)) {
        const total = legLength(st);
        const pct = total > 0 ? Math.floor((st.travel.progress / total) * 100) : 0;
        rows.splice(2, 0, { t: 'text', text: `${pct}% of the way there.`, color: T.text });
      }
      return { title: 'Map', rows };
    });
  }

  /** The Move and Sell rows shared by the Smelter and Smasher tile sheets. */
  private moveSellRows(uid: number): SheetRow[] {
    const st = this.state;
    const rows: SheetRow[] = [];
    const spots = freeCells(st).length;
    rows.push({
      t: 'card', title: 'Move', sub: spots > 0 ? 'Pick it up and drop it on another Open tile. Free.' : 'No Open tile to move to. Buy hull first.',
      verb: 'Move', cost: '', can: spots > 0,
      fn: () => this.startMove(uid),
    });
    const refund = sellRefund(st, uid);
    if (refund) {
      const armed = this.sellArm === uid;
      rows.push({
        t: 'card', title: 'Sell', sub: `Pays back 75% of what it cost and of its upgrades.${armed ? ' Tap again to confirm.' : ''}`,
        verb: armed ? 'Sure?' : 'Sell', cost: `+${costText(refund)}`, can: true,
        fn: () => {
          if (!armed) { this.sellArm = uid; this.refreshSheet(); return; }
          const r = sellModule(this.state, uid);
          if (!r.ok) return;
          this.sellArm = null;
          this.apply(r.state);
          this.closeSheet();
          this.showToast(`Sold for ${costText(refund)}`);
        },
      });
    }
    return rows;
  }

  private showSmelterSheet(uid: number): void {
    this.sellArm = null;
    this.showSheet(`smelter:${uid}`, () => {
      const st = this.state;
      const i = st.smelters.findIndex((m) => m.uid === uid);
      if (i < 0) { this.closeSheet(); return { title: 'Smelter', rows: [] }; }
      const sm = st.smelters[i];
      const lv = SMELTER.levels[sm.level - 1];
      const nx = SMELTER.levels[sm.level];
      const rows: SheetRow[] = [
        { t: 'text', text: `Turns ${SMELTER.batchIn} Ore into ${SMELTER.batchOut} Plate every ${lv.secPerBatch.toFixed(1)}s. It never touches Ore your next goal needs.${st.smelters.length > 1 ? ' Your Smelters share one Ore stock.' : ''}` },
        {
          t: 'card', title: sm.on ? 'Smelter is ON' : 'Smelter is OFF', sub: sm.on ? 'Switch it off to keep all your Ore.' : 'Switch it on to make Plate again.',
          verb: sm.on ? 'Turn off' : 'Turn on', cost: '', can: true,
          fn: () => { this.apply(toggleSmelter(this.state, i).state); this.refreshSheet(); },
        },
        this.upgradeCard(`Level ${sm.level} · ${lv.name}`, nx ? `Next: ${nx.name}. One Plate every ${nx.secPerBatch.toFixed(1)}s.` : '', nextSmelterUpgrade(st, i), () => upgradeSmelter(this.state, i), 'Smelter upgraded'),
        ...this.moveSellRows(uid),
      ];
      return { title: st.smelters.length > 1 ? `Smelter ${i + 1}` : 'Smelter', rows };
    });
  }

  /** Repair the rusty Smasher, or upgrade / move / sell one. */
  private showSmasherSheet(uid: number): void {
    this.sellArm = null;
    this.showSheet(`smasher:${uid}`, () => {
      const st = this.state;
      const i = st.smashers.findIndex((m) => m.uid === uid);
      if (i < 0) { this.closeSheet(); return { title: 'Rock Smasher', rows: [] }; }
      const sm = st.smashers[i];
      const label = st.smashers.length > 1 ? `Rock Smasher ${i + 1}` : 'Rock Smasher';
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
            this.floatAtUid(uid, 'Repaired!', T.gold);
          },
        });
        rows.push(...this.moveSellRows(uid));
        return { title: `${label} (rusty)`, rows };
      }
      const lv = SMASHER.levels[sm.level - 1];
      const nx = SMASHER.levels[sm.level];
      rows.push({ t: 'text', text: `Smashes ${lv.hpPerSec} HP per second. Holds ${lv.queue} rocks (${sm.queue.length} now). Tap Smash on the stage to give it a rock; geodes stay with your hands.${st.smashers.length > 1 ? ' Smash feeds the Smasher with the most room.' : ''}` });
      rows.push(this.upgradeCard(
        `Level ${sm.level}`,
        nx ? `Next: ${nx.hpPerSec} HP/s, holds ${nx.queue}${sm.level + 1 >= SMASHER.autoIntakeLevel ? ', feeds itself from the Bay' : ''}.` : '',
        nextSmasherUpgrade(st, i), () => upgradeSmasher(this.state, i), 'Smasher upgraded',
      ));
      rows.push(...this.moveSellRows(uid));
      return { title: label, rows };
    });
  }

  // ---- move mode: pick a module up, tap an Open tile to drop it ----------------------------------
  private startMove(uid: number): void {
    this.closeSheet();
    this.moveUid = uid;
    this.redraw();
    this.showToast('Tap an Open tile to move it. Tap anything else to cancel.');
  }

  private cancelMove(): void {
    if (this.moveUid === null) return;
    this.moveUid = null;
    this.redraw();
  }

  private dropModule(cell: string): void {
    const uid = this.moveUid;
    if (uid === null) return;
    const r = moveModule(this.state, uid, cell);
    if (!r.ok) {
      this.showToast(r.reason === 'not_edge' ? 'Needs an outside tile' : r.reason === 'not_rear' ? 'Needs a back tile' : 'Cannot move it there');
      return;
    }
    this.moveUid = null;
    this.apply(r.state);
    this.floatAtUid(uid, 'Moved', T.gold);
  }

  /** The Sell button: one tap while there is only Ore; after the first Plate it opens the Cargo sheet. */
  private onSell(): void {
    if (sellMode(this.state) === 'cargo') {
      if (this.sheetKind === 'cargo') this.closeSheet();
      else this.showCargoSheet();
      return;
    }
    const out = sellAll(this.state);
    if (out.state === this.state) {
      const holding = SELLABLE.some((k) => Math.floor(this.state.items[k]) > 0);
      this.showToast(holding ? 'Keeping materials for your goal' : 'Nothing to sell');
      return;
    }
    this.apply(out.state);
    this.floatSold(out.events);
  }

  private floatSold(events: GameEvent[]): void {
    const total = events.reduce((n, e) => n + (e.kind === 'sold' ? e.credits : 0), 0);
    if (total > 0) this.floatText(80, 70, `+${fmtNum(total)}`, T.gold);
  }

  /** Items the Cargo footer will sell: every for-sale row that is still ticked. */
  private tickedItems(): ItemId[] {
    return cargoRows(this.state).filter((r) => r.forSale && !this.cargoOff.has(r.item)).map((r) => r.item);
  }

  /** The Cargo sheet: one row per item, per-row Sell, tick boxes, and a sticky "Sell selected" footer. */
  private showCargoSheet(): void {
    if (this.sheetKind !== 'cargo') this.cargoOff.clear();
    this.showSheet('cargo', () => {
      const st = this.state;
      const rows: SheetRow[] = [];
      for (const r of cargoRows(st)) {
        const note = !r.forSale
          ? 'Not for sale. Needed for upgrades later.'
          : [`${r.price} credit${r.price === 1 ? '' : 's'} each`, r.keptNote, r.tip].filter(Boolean).join('. ');
        rows.push({
          t: 'cargo', item: r.item, count: r.count, price: r.price, note, forSale: r.forSale,
          ticked: !this.cargoOff.has(r.item), canSell: r.surplus > 0,
          sellLabel: !r.forSale ? 'Not for sale' : r.surplus > 0 ? `Sell ${fmtNum(r.surplus)}` : 'Sell',
          onTick: () => {
            if (this.cargoOff.has(r.item)) this.cargoOff.delete(r.item); else this.cargoOff.add(r.item);
            this.refreshSheet();
          },
          onSellOne: () => {
            const out = sellQty(this.state, r.item, 1);
            if (out.state === this.state) return;
            this.apply(out.state);
            this.floatSold(out.events);
            this.refreshSheet();
          },
          onSell: () => {
            const out = sellSurplus(this.state, r.item);
            if (out.state === this.state) return;
            this.apply(out.state);
            this.floatSold(out.events);
            this.refreshSheet();
          },
        });
      }
      rows.push({
        t: 'switch', title: 'Hold materials for my goal',
        sub: st.flags.holdForGoal ? 'On: Sell skips what your next goal needs.' : 'Off: Sell sells everything you pick.',
        on: st.flags.holdForGoal,
        fn: () => { this.apply(setHoldForGoal(this.state, !this.state.flags.holdForGoal).state); this.refreshSheet(); },
      });
      const picked = this.tickedItems();
      const total = sellValue(st, picked);
      return {
        title: 'Cargo', rows,
        footer: {
          label: total > 0 ? `Sell selected +${fmtNum(total)}` : 'Nothing selected to sell',
          can: total > 0,
          fn: () => {
            const out = sellSelected(this.state, this.tickedItems());
            if (out.state === this.state) return;
            this.apply(out.state);
            this.closeSheet();
            this.floatSold(out.events);
          },
        },
      };
    });
  }

  // ---- menu: version, help, save copy / paste, reset ---------------------------------------------
  private versionLine(): string {
    return formatVersion(__APP_VERSION__, __BUILD_SHA__, __BUILD_DATE__);
  }

  private showMenu(): void {
    this.showSheet('menu', () => ({
      title: 'Menu',
      rows: [
        { t: 'text', text: `Version ${this.versionLine()}` },
        { t: 'button', label: 'Help', fn: () => this.showHelp() },
        { t: 'button', label: 'Copy save', fn: () => this.copySave() },
        { t: 'button', label: 'Paste save', fn: () => this.pasteSave() },
        { t: 'button', label: 'Reset save', fn: () => this.showResetConfirm() },
      ],
    }));
  }

  private showHelp(): void {
    this.showSheet('help', () => {
      const rows: SheetRow[] = [];
      for (const card of HELP) {
        rows.push({ t: 'heading', text: card.title });
        for (const line of card.lines) rows.push({ t: 'text', text: line });
      }
      rows.push({ t: 'button', label: 'Back', fn: () => this.showMenu() });
      return { title: 'Help', rows };
    });
  }

  private copySave(): void {
    const text = serialize(stamp(this.state, Date.now()));
    const fallback = () => { window.prompt('Copy this save text:', text); };
    try {
      if (!navigator.clipboard) { fallback(); return; }
      navigator.clipboard.writeText(text).then(() => this.showToast('Save copied'), fallback);
    } catch {
      fallback();
    }
  }

  private pasteSave(): void {
    const raw = window.prompt('Paste your save text here:');
    if (!raw) return;
    const r = parseSave(raw.trim());
    if (!r.ok) { this.showToast('That is not a Last Tug save'); return; }
    this.showImportConfirm(r.state);
  }

  private showImportConfirm(incoming: GameState): void {
    this.showSheet('import', () => ({
      title: 'Replace your save?',
      rows: [
        { t: 'text', text: `The pasted save has ${fmtNum(incoming.credits)} credits, ${incoming.ship.ownedCells.length} hull tiles and ${fmtNum(incoming.stats.rocks)} rocks cracked.` },
        { t: 'text', text: `Your current game has ${fmtNum(this.state.credits)} credits and ${this.state.ship.ownedCells.length} hull tiles. This replaces it.`, color: T.text },
        {
          t: 'button', label: 'Replace my save',
          fn: () => {
            this.loadState(stamp(incoming, Date.now())); // "now", so pasting never earns free offline time
            this.showToast('Save loaded');
          },
        },
        { t: 'button', label: 'Cancel', fn: () => this.showMenu() },
      ],
    }));
  }

  private showResetConfirm(): void {
    this.showSheet('reset', () => ({
      title: 'Reset save?',
      rows: [
        { t: 'text', text: 'This wipes your ship, credits and progress and starts again. Copy your save first if you want a backup.', color: T.text },
        {
          t: 'hold', label: 'Hold to reset',
          fn: () => { this.loadState(createInitialState()); this.showToast('Save reset'); },
        },
        { t: 'button', label: 'Cancel', fn: () => this.showMenu() },
      ],
    }));
  }

  /** Replace the whole game state (reset / paste) and rebuild everything that is derived from it. */
  private loadState(next: GameState): void {
    this.endHold();
    this.cargoOff.clear();
    this.moveUid = null;
    this.state = next;
    this.persist();
    this.closeSheet();
    this.updateLimits(true);
    this.redraw();
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
          this.floatText(STAGE.cx, STAGE.cy - 40, `+${e.ore} Ore${e.ice ? ` +${e.ice} Ice` : ''}`, T.text);
          if (e.geode) {
            this.floatText(STAGE.cx, STAGE.cy - 70, `Jackpot +${e.credits}`, T.gold);
            this.chips(STAGE.cx, STAGE.cy, C.crit, 22);
          }
          if (e.shard) this.floatText(STAGE.cx, STAGE.cy - 96, 'Core Shard!', '#8A5CE0');
          break;
        case 'rock_arrived':
          if (e.to === 'smasher') {
            this.floatAtModule('smasher', 0, 'To Smasher', T.dim);
          } else {
            // pop over the Bay slot the rock landed in
            const n = baySize(this.state);
            const slot = Math.max(0, Math.min(this.state.bay.length, n) - 1);
            this.chips(bayX(n) + slot * (BAY.size + BAY.gap) + BAY.size / 2, BAY.y + BAY.size / 2, C.beam, 8);
            this.floatText(bayX(n) + (BAY.size * n + BAY.gap * (n - 1)) / 2, BAY.y - 8, `+1 Bay`, T.dim);
          }
          break;
        case 'job_done':
          this.floatText(80, 70, `+${fmtNum(e.credits)}`, T.gold);
          this.showToast(`Job done! +${e.rep} Rep`);
          break;
        case 'rank_up':
          this.showRankUp(e.rank);
          break;
        case 'sent':
          this.chips(STAGE.cx, STAGE.cy, C.crusher, 10);
          this.floatText(STAGE.cx, STAGE.cy - 30, 'To the Smasher', T.gold);
          break;
        case 'smashed':
          this.floatAtUid(e.uid, `+${e.ore} Ore${e.ice ? ` +${e.ice} Ice` : ''}`, T.text);
          break;
        case 'smelted':
          this.floatAtUid(e.uid, `+${e.plate} Plate`, '#9FB4D6');
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
    this.tx = { stage: mk(15, T.dim), fire: mk(17), sell: mk(17, '#0B1020'), heat: mk(12, T.dim), bay: mk(12, T.dim), hp: mk(12, T.dim), send: mk(15, '#0B1020'), smash: mk(12, T.text), loc: mk(13, T.dim), power: mk(13, T.dim) };
    for (const k of ['loc', 'power'] as const) this.tx[k].setStroke('#0B1020', 4);
    this.tx.loc.setOrigin(0, 0.5);
    this.tx.power.setOrigin(1, 0.5);

    const stage = this.add.zone(STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2, STAGE.w, STAGE.h).setInteractive();
    stage.on('pointerdown', (p: Phaser.Input.Pointer) => this.onStageDown(p));
    const send = this.add.zone(SMASH.x + SMASH.w / 2, STAGE.cy, SMASH.w, SMASH.h).setInteractive();
    send.on('pointerdown', () => this.onSend());
    const fire = this.add.zone(FIRE.x + FIRE.w / 2, ACTION.y + ACTION.h / 2, FIRE.w, ACTION.h).setInteractive();
    fire.on('pointerdown', () => this.onFire());
    const tabW = W / 4 - 4;
    const tabShip = this.add.zone(TAB_X.ship, H - 42, tabW, 80).setInteractive().setDepth(31);
    tabShip.on('pointerdown', () => this.closeSheet());
    const tabBuild = this.add.zone(TAB_X.build, H - 42, tabW, 80).setInteractive().setDepth(31);
    tabBuild.on('pointerdown', () => (this.sheetKind === 'workshop' ? this.closeSheet() : this.showWorkshop()));
    const tabMap = this.add.zone(TAB_X.map, H - 42, tabW, 80).setInteractive().setDepth(31);
    tabMap.on('pointerdown', () => (this.sheetKind === 'map' ? this.closeSheet() : this.showMap()));
    const tabJobs = this.add.zone(TAB_X.jobs, H - 42, tabW, 80).setInteractive().setDepth(31);
    tabJobs.on('pointerdown', () => (this.sheetKind === 'jobs' ? this.closeSheet() : this.showJobs()));
    const gearZ = this.add.zone(W - 38, 88, 48, 48).setInteractive();
    gearZ.on('pointerdown', () => (this.sheetKind === 'menu' ? this.closeSheet() : this.showMenu()));
    const sellZ = this.add.zone(SELL.x + SELL.w / 2, ACTION.y + ACTION.h / 2, SELL.w, ACTION.h).setInteractive();
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

  /** Pooled label inside the zoomed ship, one per module key (`b<uid>` beams, `s<uid>` Smelters). */
  private shipLabel(key: string): Phaser.GameObjects.Text {
    let t = this.shipLabels.get(key);
    if (!t) {
      t = this.shipTxt(0, 0, '', { fontFamily: FONT, fontSize: '17px', fontStyle: '600', color: T.text, align: 'center' }).setOrigin(0.5);
      this.ship.add(t); // sits above the overlay graphics inside the zoomed container
      this.shipLabels.set(key, t);
    }
    return t;
  }

  /** "4:05" for a number of seconds. */
  private clock(sec: number): string {
    const t = Math.max(0, Math.ceil(sec));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  /**
   * Power badges on the tiles: an unpowered module is dimmed with a red bolt and a slash (never colour alone:
   * the slash reads in greyscale); a Boosted one gets a small blue diamond in its corner.
   */
  private drawPowerBadges(g: Phaser.GameObjects.Graphics, st: GameState, power: PowerInfo): void {
    const unpowered = new Set(power.unpowered);
    for (const m of st.ship.modules) {
      const p = this.px(parseKey(m.cell));
      if (unpowered.has(m.uid)) {
        g.fillStyle(0x000000, 0.55).fillRoundedRect(p.x + 7, p.y + 7, TILE - 14, TILE - 14, 8);
        const cx = p.x + TILE / 2, cy = p.y + TILE / 2;
        g.fillStyle(C.coral, 1);
        g.fillTriangle(cx + 2, cy - 13, cx - 7, cy + 2, cx, cy + 2);
        g.fillTriangle(cx - 2, cy + 13, cx + 7, cy - 2, cx, cy - 2);
        g.lineStyle(3, C.highlight, 0.95).lineBetween(cx - 12, cy - 12, cx + 12, cy + 12);
      } else if (power.boosted.has(m.uid)) {
        const x = p.x + TILE - 13, y = p.y + 13;
        g.fillStyle(C.power, 1).fillTriangle(x, y - 6, x + 6, y, x, y + 6).fillTriangle(x, y - 6, x - 6, y, x, y + 6);
        g.lineStyle(1.5, C.hullOutline, 1).strokeTriangle(x, y - 6, x + 6, y, x, y + 6).strokeTriangle(x, y - 6, x - 6, y, x, y + 6);
      }
    }
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

    // --- module overlays: every beam and Grapple (ring + countdown), Smelters (progress ring), power badges
    const hand = handStats(st);
    const power = evaluatePower(st);
    const counting = st.beams.some((b) => b.status === 'counting');
    const room = bayRoom(st);
    const used = new Set<string>();
    const goalId = currentGoal(st)?.id;
    const label = (key: string, x: number, y: number, str: string, color?: string) => {
      this.setText(this.shipLabel(key), x, y, str, color);
      used.add(key);
    };
    for (const m of st.ship.modules) {
      if (m.defId !== 'beam' && m.defId !== 'grapple') continue;
      const beam = st.beams.find((b) => b.uid === m.uid);
      if (!beam) continue;
      const bp = this.px(parseKey(m.cell));
      const bcx = bp.x + TILE / 2, bcy = bp.y + TILE / 2;
      const live = power.powered.has(m.uid);
      let text = '';
      if (beam.status === 'counting') {
        const total = beamCountdown(beam, power.boosted.has(m.uid));
        const frac = Math.min(1, 1 - beam.remaining / total);
        sg.lineStyle(4, C.beam, 1).beginPath().arc(bcx, bcy, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false).strokePath();
        sg.lineStyle(4, C.hull, 0.35).strokeCircle(bcx, bcy, 18);
        text = String(Math.ceil(Math.max(0, beam.remaining)));
      } else if (beam.status === 'idle' && (room <= 0 || !live)) {
        sg.lineStyle(3, C.hull, 0.35).strokeRoundedRect(bp.x + 2, bp.y + 2, TILE - 4, TILE - 4, 10); // no room in the Bay, or no power
      } else if (beam.status === 'idle') {
        const pulse = 0.55 + 0.45 * Math.sin(now * 5);
        sg.lineStyle(3, C.crit, st.flags.tappedBeam ? 0.9 : pulse).strokeRoundedRect(bp.x + 2, bp.y + 2, TILE - 4, TILE - 4, 10);
      } else {
        sg.lineStyle(3, 0xffa733, 1).strokeRoundedRect(bp.x + 2, bp.y + 2, TILE - 4, TILE - 4, 10);
        text = 'Full';
      }
      this.levelPips(sg, bp.x, bp.y, beam.level);
      label(`b${m.uid}`, bcx, bcy, text);
    }
    st.ship.modules.filter((m) => m.defId === 'smelter').forEach((m) => {
      const unit = st.smelters.find((u) => u.uid === m.uid);
      if (!unit) return;
      const sp = this.px(parseKey(m.cell));
      const cx = sp.x + TILE / 2, cy = sp.y + TILE / 2;
      let text = '';
      if (!unit.on) {
        sg.fillStyle(0x000000, 0.5).fillRoundedRect(sp.x + 7, sp.y + 7, TILE - 14, TILE - 14, 8);
        text = 'OFF';
      } else if (unit.progress > 0) {
        sg.lineStyle(4, 0x2a1810, 0.45).strokeCircle(cx, cy, 20);
        sg.lineStyle(4, C.crit, 1).beginPath().arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * unit.progress, false).strokePath();
      }
      this.levelPips(sg, sp.x, sp.y, unit.level);
      label(`s${m.uid}`, cx, cy, text);
    });
    for (const m of st.ship.modules) {
      if (m.defId === 'solar' || m.defId === 'engine') {
        const p = this.px(parseKey(m.cell));
        this.levelPips(sg, p.x, p.y, m.level ?? 1);
      }
      if (m.defId === 'engine' && inTransit(st) && power.powered.has(m.uid)) {
        // exhaust flicker while cruising
        const p = this.px(parseKey(m.cell));
        const f = 0.6 + 0.4 * Math.sin(now * 23);
        sg.fillStyle(0xffa733, f).fillTriangle(p.x + TILE - 4, p.y + TILE / 2 - 8, p.x + TILE - 4, p.y + TILE / 2 + 8, p.x + TILE + 14 + 6 * f, p.y + TILE / 2);
      }
    }
    this.drawPowerBadges(sg, st, power);
    for (const [k, t] of this.shipLabels) if (!used.has(k)) this.setText(t, -100, -100, '');
    // Move mode: every tile the picked-up module can drop on pulses
    if (this.moveUid !== null) {
      const mv = st.ship.modules.find((m) => m.uid === this.moveUid);
      const owned = new Set(st.ship.ownedCells);
      const pulse = 0.45 + 0.55 * Math.sin(now * 6);
      for (const k of freeCells(st)) {
        if (mv && !fitsPlacement(owned, k, placementOf(mv.defId))) continue;
        const p = this.px(parseKey(k));
        sg.lineStyle(4, C.beam, pulse).strokeRoundedRect(p.x + 4, p.y + 4, TILE - 8, TILE - 8, 9);
      }
    }
    // Open tiles that fit the current goal pulse
    const goalModule: Partial<Record<string, ModuleId>> = { smelter: 'smelter', beam2: 'beam', solar: 'solar', engine: 'engine', grapple: 'grapple' };
    const gm = goalId ? goalModule[goalId] : undefined;
    if (gm) {
      const pulse = 0.45 + 0.55 * Math.sin(now * 5);
      for (const k of freeCellsFor(st, gm)) {
        const p = this.px(parseKey(k));
        sg.lineStyle(3, C.crit, pulse).strokeRoundedRect(p.x + 5, p.y + 5, TILE - 10, TILE - 10, 9);
      }
    }
    // location and power, top of the ship view
    const eta = etaSec(st, power);
    const loc = inTransit(st)
      ? `To ${ROUTE[st.travel.dest!].name} · ${eta === null ? 'no power' : this.clock(eta)}`
      : currentNode(st).name;
    this.setText(this.tx.loc, 16, VIEW.y + 12, loc, inTransit(st) ? T.gold : T.dim);
    const showPower = st.ship.modules.some((m) => m.defId === 'solar') || power.unpowered.length > 0 || power.draw >= POWER.hullBase;
    this.setText(this.tx.power, W - 16, VIEW.y + 12, showPower ? `Power ${power.draw}/${power.supply}` : '', power.unpowered.length > 0 ? T.coral : T.dim);

    // --- crush stage panel
    g.fillStyle(C.panel, 1).fillRoundedRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 22);
    g.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 22);

    let stageText = '';
    if (c.rock) {
      this.shake = Math.max(0, this.shake - 0.06);
      const jx = (Math.random() - 0.5) * 8 * this.shake;
      const jy = (Math.random() - 0.5) * 8 * this.shake;
      this.drawRock(g, STAGE.cx + jx, STAGE.cy + jy, c.rock, 1 - c.rock.hp / c.rock.maxHp);
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
    const nBay = baySize(st), BX = bayX(nBay);
    const hx = 16, hy = STRIP_Y + 18, hw = BX - 16 - 52;
    g.fillStyle(C.deck, 1).fillRoundedRect(hx, hy, hw, 16, 8);
    const hc = c.lockout > 0 ? 0x9fd8ff : this.heatColor(heatFrac);
    if (heatFrac > 0) g.fillStyle(hc, 1).fillRoundedRect(hx, hy, Math.max(16, hw * heatFrac), 16, 8);
    this.setText(this.tx.heat, hx + 18, STRIP_Y + 8, 'Heat');
    const bayFull = st.bay.length >= nBay;
    this.setText(this.tx.bay, BX - 26, STRIP_Y + 21, `Bay\n${st.bay.length}/${nBay}`, bayFull ? T.gold : T.dim);
    const flying = st.beams
      .filter((b) => b.status !== 'idle')
      .map((b) => (b.status === 'blocked' ? 1 : Math.min(1, 1 - b.remaining / beamCountdown(b, power.boosted.has(b.uid)))))
      .sort((a, b) => b - a); // the rock that lands first takes the first free slot
    for (let i = 0; i < nBay; i++) {
      const sx = BX + i * (BAY.size + BAY.gap), sy = BAY.y, mid = BAY.size / 2;
      g.fillStyle(C.deck, 1).fillRoundedRect(sx, sy, BAY.size, BAY.size, 10);
      g.lineStyle(2, C.deckEdge, 1).strokeRoundedRect(sx, sy, BAY.size, BAY.size, 10);
      const rock = st.bay[i];
      if (rock) {
        const rr = rock.kind === 'heavy' || rock.kind === 'big' ? 14 : 11;
        g.fillStyle(rock.geode ? 0x8a5ce0 : (ROCK_LOOK[rock.kind] ?? ROCK_LOOK.dust).bay, 1).fillCircle(sx + mid, sy + mid, rr);
        g.lineStyle(2, 0x2a2320, 1).strokeCircle(sx + mid, sy + mid, rr);
        if (!rock.geode && (rock.ice ?? 0) > 0) g.fillStyle(0xe6f6ff, 1).fillCircle(sx + mid + 4, sy + mid - 4, 3);
      } else {
        const p = flying[i - st.bay.length]; // progress of the rock on its way to this slot
        if (p !== undefined) {
          const pulse = 0.6 + 0.4 * Math.sin(now * 8);
          g.lineStyle(2, C.beam, pulse).strokeRoundedRect(sx, sy, BAY.size, BAY.size, 10);
          g.fillStyle(0xa9937c, 0.35 + 0.5 * p).fillCircle(sx + mid, sy + mid, 3 + 8 * p);
        }
      }
    }

    // --- action row: Fire (as many idle beams as the Bay has room for) + Sell
    const idleN = st.beams.filter((b) => beamReady(st, b, power)).length;
    const dark = idleN === 0 && st.beams.some((b) => b.status === 'idle' && !power.powered.has(b.uid));
    const canFire = idleN > 0 && room > 0;
    const fireN = Math.min(idleN, room);
    g.fillStyle(canFire ? C.beamDeep : C.panelEdge, 1).fillRoundedRect(FIRE.x, ACTION.y, FIRE.w, ACTION.h, 23);
    g.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(FIRE.x, ACTION.y, FIRE.w, ACTION.h, 23);
    const wait = Math.max(0, ...st.beams.filter((b) => b.status === 'counting').map((b) => b.remaining));
    const fireText = canFire
      ? (fireN > 1 ? `Fire ${fireN} beams` : 'Fire beam')
      : counting ? `Incoming ${wait.toFixed(1)}s` : dark && room > 0 ? 'No power' : `Bay full ${st.bay.length}/${nBay}`;
    this.setText(this.tx.fire, FIRE.x + FIRE.w / 2, ACTION.y + ACTION.h / 2, fireText, canFire ? '#0B1020' : T.dim);

    const val = sellValue(st);
    const canSell = val > 0;
    const cargoMode = sellMode(st) === 'cargo';
    const sellPulse = canSell && goalId === 'sell' ? 0.6 + 0.4 * Math.sin(now * 6) : 1;
    g.fillStyle(canSell ? C.crit : C.panelEdge, canSell ? sellPulse : 1).fillRoundedRect(SELL.x, ACTION.y, SELL.w, ACTION.h, 23);
    g.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(SELL.x, ACTION.y, SELL.w, ACTION.h, 23);
    this.setText(this.tx.sell, SELL.x + SELL.w / 2, ACTION.y + ACTION.h / 2, canSell ? `${cargoMode ? 'Sell…' : 'Sell'} +${fmtNum(val)}` : cargoMode ? 'Sell…' : 'Sell', canSell ? '#0B1020' : T.dim);
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

  /** The Smash button on the stage: gives the stage rock to the Smasher. Orange like the Smasher tile. */
  private drawSend(g: Phaser.GameObjects.Graphics, st: GameState): void {
    const x = SMASH.x, y = STAGE.cy - 28, w = SMASH.w, h = SMASH.h;
    if (!smasherReady(st) || !st.crusher.rock) {
      this.setText(this.tx.send, -100, -100, '');
      return;
    }
    const chk = canSend(st);
    const ok = chk.ok;
    const cap = smasherQueueCap(st), held = smasherQueued(st);
    const pulse = ok && currentGoal(st)?.id === 'send' ? 0.6 + 0.4 * Math.sin(this.elapsed * 6) : 1;
    g.fillStyle(ok ? C.crusher : C.panelEdge, ok ? pulse : 1).fillRoundedRect(x, y, w, h, 18);
    g.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(x, y, w, h, 18);
    const label = ok ? `Smash\n${held}/${cap}` : chk.reason === 'geode' ? 'Geode\nby hand' : chk.reason === 'unpowered' ? 'No\npower' : `Full\n${held}/${cap}`;
    this.setText(this.tx.send, x + w / 2, y + h / 2, label, ok ? '#0B1020' : T.dim);
  }

  /** Smasher tile overlays: progress ring on the head rock, queue pips underneath, one per Smasher. */
  private drawSmasher(g: Phaser.GameObjects.Graphics, st: GameState): void {
    for (const m of st.ship.modules.filter((x) => x.defId === 'smasher')) {
      const sm = st.smashers.find((u) => u.uid === m.uid);
      if (!sm) continue;
      const sp = this.px(parseKey(m.cell));
      const cx = sp.x + TILE / 2, cy = sp.y + TILE / 2;
      if (!sm.repaired) {
        const goal = currentGoal(st)?.id === 'repair';
        if (goal) g.lineStyle(3, C.crit, 0.55 + 0.45 * Math.sin(this.elapsed * 5)).strokeRoundedRect(sp.x + 2, sp.y + 2, TILE - 4, TILE - 4, 10);
        continue;
      }
      const head = sm.queue[0];
      if (head) {
        const frac = 1 - head.hp / head.maxHp;
        g.lineStyle(4, 0x2a2320, 0.4).strokeCircle(cx, cy, 20);
        g.lineStyle(4, C.crit, 1).beginPath().arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false).strokePath();
      }
      const cap = SMASHER.levels[sm.level - 1].queue;
      for (let i = 0; i < cap; i++) {
        const px = cx - ((cap - 1) * 7) / 2 + i * 7;
        g.fillStyle(i < sm.queue.length ? C.crit : C.deck, 1).fillCircle(px, sp.y + TILE - 6, 2.6);
      }
    }
    this.setText(this.tx.smash, -100, -100, '');
  }

  private drawRock(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rock: Rock, damage: number): void {
    const geode = rock.geode;
    const look = ROCK_LOOK[rock.kind] ?? ROCK_LOOK.dust;
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
    g.fillStyle(geode ? 0x6f4cc2 : look.outer, 1).fillPoints(pts, true);
    g.fillStyle(geode ? 0x8a5ce0 : look.inner, 1).fillPoints(grow(0.72), true);
    if (!geode && (rock.ice ?? 0) > 0) {
      // ice crystals: pale diamonds (shape, not just colour)
      g.fillStyle(0xe6f6ff, 1);
      for (const [dx, dy] of [[-18, -10], [14, -16], [6, 16]] as const) {
        g.fillTriangle(cx + dx, cy + dy - 9, cx + dx + 6, cy + dy, cx + dx, cy + dy + 9);
        g.fillTriangle(cx + dx, cy + dy - 9, cx + dx - 6, cy + dy, cx + dx, cy + dy + 9);
      }
    }
    if (!geode && rock.kind === 'heavy') {
      g.lineStyle(4, 0x3a333d, 1);
      g.lineBetween(cx - R * 0.5, cy - R * 0.2, cx + R * 0.45, cy - R * 0.35); // banded heavy rock
      g.lineBetween(cx - R * 0.45, cy + R * 0.3, cx + R * 0.5, cy + R * 0.15);
    }
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

  private initStars(): void {
    this.starG = this.add.graphics(); // created first, so it sits behind everything
    const rnd = new Phaser.Math.RandomDataGenerator(['stars']);
    for (let i = 0; i < 60; i++) {
      this.stars.push({ x: rnd.between(0, W), y: rnd.between(0, H), r: rnd.realInRange(0.6, 1.6), a: rnd.realInRange(0.1, 0.45), z: rnd.realInRange(0.3, 1) });
    }
    this.drawStars(0);
  }

  /** Stars drift slowly when parked and streak past (left to right: the nose points left) while cruising. */
  private drawStars(dt: number): void {
    const cruising = inTransit(this.state) && engineSpeed(this.state) > 0;
    const speed = cruising ? 260 : 3;
    this.starShift += speed * dt;
    const g = this.starG;
    g.clear();
    for (const st of this.stars) {
      const x = (((st.x + this.starShift * st.z) % W) + W) % W;
      g.fillStyle(0xe6ecff, st.a);
      if (cruising) {
        const len = 6 + 22 * st.z;
        g.fillRect(x - len, st.y - st.r / 2, len, Math.max(1, st.r));
      } else {
        g.fillCircle(x, st.y, st.r);
      }
    }
  }
}
