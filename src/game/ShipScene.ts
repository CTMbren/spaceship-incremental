import Phaser from 'phaser';
import { buyTile, canAfford } from '../core/actions';
import { currentGoal } from '../core/goals';
import { cellKey, nextTileCost, parseKey, unlockableCells } from '../core/hull';
import {
  canSend, holdCrush, nextSmasherUpgrade, releaseHold, repairSmasher, sell, sellableOre, sendToSmasher,
  smasherQueueCap, tapBeam, tapCrush, tick, upgradeSmasher, weakActive,
} from '../core/loop';
import { loadFromStorage, saveToStorage } from '../core/save';
import { createInitialState } from '../core/state';
import type { Cell, Cost, GameEvent, GameState } from '../core/types';
import { BAL } from '../data/balance';
import { SMASHER } from '../data/smasher';
import { HULLS } from '../data/hulls';
import { C, FONT, T } from './palette';

export const W = 390;
export const H = 844;
/** Render at the device pixel ratio (capped) so text and shapes stay sharp on retina phones. */
export const DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
const TILE = 56;
const OX = 55; // 5 columns * 56 = 280, centred in 390
const OY = 150;
const MAX_GHOSTS = 4;
const STAGE = { x: 16, y: 466, w: 358, h: 184, cx: 195, cy: 556, r: 60 };
const STRIP_Y = 660;
const ACTION = { y: 706, h: 46 };

const ITEM_LABEL: Record<string, string> = {
  ore: 'Ore', ice: 'Ice', plate: 'Plate', coolant: 'Coolant', circuit: 'Circuit', core_shard: 'Shard',
};

export class ShipScene extends Phaser.Scene {
  private state!: GameState;
  private layer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private toast?: Phaser.GameObjects.Text;
  private debug = new URLSearchParams(window.location.search).has('debug');
  private dyn!: Phaser.GameObjects.Graphics;
  private tx!: Record<'stage' | 'fire' | 'sell' | 'beam' | 'heat' | 'bay' | 'hp' | 'send' | 'smash', Phaser.GameObjects.Text>;
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
    this.layer = this.add.container(0, 0);
    this.hud = this.add.container(0, 0);
    this.buildDynamic();
    this.redraw();
    if (this.debug) (window as unknown as { __ship: ShipScene }).__ship = this; // for scripted tests
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveToStorage(this.state);
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.25); // long gaps are offline progress (Day 4), not one big tick
    this.elapsed += dt;
    const out = tick(this.state, dt, this.forceGeode);
    this.state = out.state;
    this.handleEvents(out.events, W / 2, STAGE.cy);
    this.afterEvents(out.events);
    this.updateHold(dt);
    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      saveToStorage(this.state);
    }
    this.drawDynamic();
  }

  /** Static layer (HUD numbers, goal chip) only needs a rebuild when Ore or credits change. */
  private afterEvents(events: GameEvent[]): void {
    if (events.some((e) => e.kind === 'crushed' || e.kind === 'smashed')) this.redraw();
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

  private txt(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { ...style, resolution: DPR });
  }

  // ---- state -------------------------------------------------------------
  private apply(next: GameState): void {
    this.state = next;
    saveToStorage(next);
    this.redraw();
  }

  private tryBuy(cell: Cell): void {
    const res = buyTile(this.state, cell);
    if (res.ok) {
      this.apply(res.state);
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
    this.drawHull();
    this.drawGhosts();
    this.drawHud();
    this.drawTabs();
  }

  private px(c: Cell): { x: number; y: number } {
    return { x: OX + c.x * TILE, y: OY + c.y * TILE };
  }

  /** Hull silhouette = union of per-tile rounded rects (outline layer, then fill layer, then deck). */
  private drawHull(): void {
    const owned = this.state.ship.ownedCells.map(parseKey);
    const set = new Set(this.state.ship.ownedCells);
    const g = this.add.graphics();
    this.layer.add(g);

    // engine nozzles under bottom-edge cells (only where the finished hull also ends)
    const finished = new Set(HULLS[this.state.ship.hullId].template.map(cellKey));
    for (const c of owned) {
      if (!finished.has(cellKey({ x: c.x, y: c.y + 1 }))) {
        const { x, y } = this.px(c);
        g.fillStyle(C.hullOutline, 1).fillRoundedRect(x + 10, y + TILE - 2, 36, 18, 6);
        g.fillStyle(C.beam, 0.35).fillRoundedRect(x + 16, y + TILE + 14, 24, 14, 7);
      }
    }
    for (const c of owned) {
      const { x, y } = this.px(c);
      g.fillStyle(C.hullOutline, 1).fillRoundedRect(x - 9, y - 9, TILE + 18, TILE + 18, 18);
    }
    for (const c of owned) {
      const { x, y } = this.px(c);
      g.fillStyle(C.hull, 1).fillRoundedRect(x - 5, y - 5, TILE + 10, TILE + 10, 14);
    }
    // top-left rim light on cells with an exposed top edge
    for (const c of owned) {
      if (!set.has(cellKey({ x: c.x, y: c.y - 1 }))) {
        const { x, y } = this.px(c);
        g.fillStyle(C.hullRim, 1).fillRoundedRect(x + 2, y - 3, TILE - 4, 4, 2);
      }
    }
    for (const c of owned) {
      const { x, y } = this.px(c);
      g.fillStyle(C.deck, 1).fillRoundedRect(x + 2, y + 2, TILE - 4, TILE - 4, 8);
      g.lineStyle(2, C.deckEdge, 1).strokeRoundedRect(x + 2, y + 2, TILE - 4, TILE - 4, 8);
    }

    // Day 1 placeholder modules on the 1x3 start: beam, crusher, empty smelter slot
    this.placeholder(owned, { x: 2, y: 0 }, C.beamDeep, '');
    const bp = this.px({ x: 2, y: 0 });
    const beamHit = this.add.zone(bp.x + TILE / 2, bp.y + TILE / 2, TILE, TILE).setInteractive();
    beamHit.on('pointerdown', () => this.onBeamTap());
    this.layer.add(beamHit);
    const rusty = !this.state.smasher.repaired;
    this.placeholder(owned, { x: 2, y: 1 }, rusty ? 0x6b5648 : C.crusher, rusty ? 'Rusty' : 'Smash');
    const sp = this.px({ x: 2, y: 1 });
    const smHit = this.add.zone(sp.x + TILE / 2, sp.y + TILE / 2, TILE, TILE).setInteractive();
    smHit.on('pointerdown', () => this.onSmasherTap());
    this.layer.add(smHit);
    this.placeholder(owned, { x: 2, y: 2 }, 0x18223f, 'Open', true);
  }

  private placeholder(owned: Cell[], cell: Cell, color: number, label: string, outline = false): void {
    if (!owned.some((o) => cellKey(o) === cellKey(cell))) return;
    const { x, y } = this.px(cell);
    const g = this.add.graphics();
    g.fillStyle(color, 1).fillRoundedRect(x + 7, y + 7, TILE - 14, TILE - 14, 8);
    if (outline) g.lineStyle(2, C.beam, 0.9).strokeRoundedRect(x + 7, y + 7, TILE - 14, TILE - 14, 8);
    const t = this.txt(x + TILE / 2, y + TILE / 2, label, { fontFamily: FONT, fontSize: '12px', color: T.text }).setOrigin(0.5);
    this.layer.add([g, t]);
  }

  private drawGhosts(): void {
    const def = HULLS[this.state.ship.hullId];
    const owned = new Set(this.state.ship.ownedCells);
    const cost = nextTileCost(def, owned.size);
    if (!cost) return;
    const ghosts = unlockableCells(def, owned)
      .sort((a, b) => Math.abs(a.x - 2) + a.y - (Math.abs(b.x - 2) + b.y))
      .slice(0, MAX_GHOSTS);
    const ok = canAfford(this.state, cost) === 'ok';
    for (const c of ghosts) {
      const { x, y } = this.px(c);
      const g = this.add.graphics();
      this.dashedRect(g, x + 3, y + 3, TILE - 6, TILE - 6, ok ? C.crit : C.ghost);
      const label = this
        .txt(x + TILE / 2, y + TILE / 2, String(cost.credits), {
          fontFamily: FONT, fontSize: '15px', fontStyle: '600', color: ok ? T.gold : T.dim,
        })
        .setOrigin(0.5);
      const hit = this.add.zone(x + TILE / 2, y + TILE / 2, 56, 56).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.tryBuy(c));
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

  private costText(cost: Cost): string {
    const mats = Object.entries(cost.items ?? {}).map(([k, v]) => `${v} ${ITEM_LABEL[k]}`);
    return [`${cost.credits} credits`, ...mats].join(' · ');
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

    const def = HULLS[st.ship.hullId];
    const next = nextTileCost(def, st.ship.ownedCells.length);
    const goal = currentGoal(st);
    const chipText = goal
      ? `Next: ${goal.text}`
      : next ? `Next: Expand hull · ${this.costText(next)}` : 'Hull complete';
    const chip = this.add.graphics();
    chip.fillStyle(C.panel, 1).fillRoundedRect(16, 66, 358, 44, 22);
    chip.lineStyle(3, goal ? C.crit : C.panelEdge, 1).strokeRoundedRect(16, 66, 358, 44, 22);
    const chipLabel = this.txt(W / 2, 88, chipText, {
      fontFamily: FONT, fontSize: '15px', color: T.text, fixedWidth: 330, align: 'center',
    }).setOrigin(0.5);
    this.hud.add([chip, chipLabel]);

    if (!st.flags.tappedBeam) {
      const bx = OX + 2 * TILE + TILE / 2;
      const b = this.add.graphics();
      b.fillStyle(C.highlight, 1).fillRoundedRect(bx - 62, 116, 124, 26, 13);
      b.fillTriangle(bx - 7, 141, bx + 7, 141, bx, 149);
      const bt = this.txt(bx, 129, 'Tap the beam.', { fontFamily: FONT, fontSize: '14px', fontStyle: '600', color: '#0B1020' }).setOrigin(0.5);
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
    tab(W * 0.25, 'Ship', true);
    tab(W * 0.75, 'Build', false);
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
  private onBeamTap(): void {
    const out = tapBeam(this.state);
    if (out.state === this.state) return;
    this.apply(out.state);
    this.floatText(OX + 2 * TILE + TILE / 2, OY - 6, 'Beam on', T.gold);
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
    saveToStorage(this.state);
    this.handleEvents(out.events, STAGE.cx, STAGE.cy);
    this.redraw();
  }

  private onSmasherTap(): void {
    this.showSmasherSheet();
  }

  private closeSheet(): void {
    this.sheet?.destroy(true);
    this.sheet = undefined;
  }

  /** One bottom sheet at a time: repair the rusty Smasher, or upgrade it. */
  private showSmasherSheet(): void {
    this.closeSheet();
    const st = this.state;
    const sm = st.smasher;
    const box = this.add.container(0, 0).setDepth(30);
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55).setInteractive();
    dim.on('pointerdown', () => this.closeSheet());
    const panelY = 420, panelH = 330;
    const panel = this.add.graphics();
    panel.fillStyle(C.panel, 1).fillRoundedRect(16, panelY, 358, panelH, 26);
    panel.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(16, panelY, 358, panelH, 26);
    const absorb = this.add.zone(W / 2, panelY + panelH / 2, 358, panelH).setInteractive();
    absorb.on('pointerdown', () => undefined);
    box.add([dim, panel, absorb]);

    const t = (x: number, y: number, str: string, size: number, color: string = T.text, bold = false, ox = 0) =>
      this.txt(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: bold ? '600' : '400', color, wordWrap: { width: 320 }, align: ox === 0.5 ? 'center' : 'left' }).setOrigin(ox, 0);
    const lines: Phaser.GameObjects.Text[] = [];
    const cost = sm.repaired ? nextSmasherUpgrade(st) : SMASHER.repair;
    const costStr = cost
      ? [cost.credits > 0 ? `${cost.credits} credits` : '', ...Object.entries(cost.items ?? {}).map(([k, v]) => `${v} ${k[0].toUpperCase()}${k.slice(1)}`)].filter(Boolean).join(' · ')
      : '';
    let can = false;
    let actionLabel = '';
    let action: () => void = () => undefined;
    if (!sm.repaired) {
      lines.push(t(36, panelY + 20, 'Rock Smasher (rusty)', 22, T.text, true));
      lines.push(t(36, panelY + 58, 'Fix it and it smashes rocks while you do other things. It is slower than you and cannot open geodes.', 15, T.dim));
      lines.push(t(36, panelY + 128, `Level 1: ${SMASHER.levels[0].hpPerSec} HP/s · holds ${SMASHER.levels[0].queue} rocks`, 15));
      can = repairSmasher(st).ok;
      actionLabel = can ? `Repair · ${costStr}` : `Need ${costStr}`;
      action = () => {
        const r = repairSmasher(this.state);
        if (r.ok) { this.apply(r.state); this.handleEvents(r.events, STAGE.cx, STAGE.cy); this.floatText(OX + 2 * TILE + TILE / 2, OY + TILE + 10, 'Repaired!', T.gold); this.closeSheet(); }
        else this.showToast('Not enough materials');
      };
    } else {
      const lv = SMASHER.levels[sm.level - 1];
      lines.push(t(36, panelY + 20, `Rock Smasher · Level ${sm.level}`, 22, T.text, true));
      lines.push(t(36, panelY + 58, `Smashes ${lv.hpPerSec} HP per second. Holds ${lv.queue} rocks (${sm.queue.length} now).`, 15, T.dim));
      lines.push(t(36, panelY + 108, 'Tap Send in the stage to give it a rock. Geodes stay with your hands.', 15, T.dim));
      const nxt = SMASHER.levels[sm.level];
      if (nxt) {
        lines.push(t(36, panelY + 168, `Level ${sm.level + 1}: ${nxt.hpPerSec} HP/s · holds ${nxt.queue}${sm.level + 1 >= SMASHER.autoIntakeLevel ? ' · feeds itself from the beam' : ''}`, 15));
        can = upgradeSmasher(st).ok;
        actionLabel = can ? `Upgrade · ${costStr}` : `Need ${costStr}`;
        action = () => {
          const r = upgradeSmasher(this.state);
          if (r.ok) { this.apply(r.state); this.showSmasherSheet(); }
          else this.showToast('Not enough credits');
        };
      } else {
        lines.push(t(36, panelY + 168, 'Fully upgraded.', 15, T.gold));
      }
    }
    box.add(lines);
    if (actionLabel) {
      const by = panelY + panelH - 76;
      const btn = this.add.graphics();
      btn.fillStyle(can ? C.crit : C.panelEdge, 1).fillRoundedRect(36, by, 318, 52, 26);
      const lab = this.txt(W / 2, by + 26, actionLabel, { fontFamily: FONT, fontSize: '18px', fontStyle: '600', color: can ? '#0B1020' : T.dim }).setOrigin(0.5);
      const z = this.add.zone(W / 2, by + 26, 318, 52).setInteractive();
      z.on('pointerdown', action);
      box.add([btn, lab, z]);
    }
    const close = this.txt(W - 40, panelY + 18, 'Close', { fontFamily: FONT, fontSize: '15px', color: T.dim }).setOrigin(1, 0).setInteractive();
    close.on('pointerdown', () => this.closeSheet());
    box.add(close);
    this.sheet = box;
  }

  private onSell(): void {
    const n = sellableOre(this.state);
    const out = sell(this.state, 'ore', n);
    if (out.state === this.state) {
      this.showToast(this.state.items.ore >= 1 ? 'Keeping Ore for your goal' : 'No Ore to sell');
      return;
    }
    this.apply(out.state);
    for (const e of out.events) {
      if (e.kind === 'sold') this.floatText(W - 90, ACTION.y - 6, `+${e.credits}`, T.gold);
    }
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
          this.floatText(OX + 2 * TILE + TILE / 2, OY + TILE + 6, `+${e.ore} Ore`, T.text);
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
    this.tx = { stage: mk(15, T.dim), fire: mk(17), sell: mk(17, '#0B1020'), beam: mk(17), heat: mk(12, T.dim), bay: mk(12, T.dim), hp: mk(12, T.dim), send: mk(15, '#0B1020'), smash: mk(12, T.text) };

    const stage = this.add.zone(STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2, STAGE.w, STAGE.h).setInteractive();
    stage.on('pointerdown', (p: Phaser.Input.Pointer) => this.onStageDown(p));
    const send = this.add.zone(328, STAGE.cy, 76, 56).setInteractive();
    send.on('pointerdown', () => this.onSend());
    const fire = this.add.zone(16 + 105, ACTION.y + ACTION.h / 2, 210, ACTION.h).setInteractive();
    fire.on('pointerdown', () => this.onBeamTap());
    const sellZ = this.add.zone(238 + 68, ACTION.y + ACTION.h / 2, 136, ACTION.h).setInteractive();
    sellZ.on('pointerdown', () => this.onSell());
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
    const beam = st.beams[0];
    const now = this.elapsed;
    g.clear();

    // --- beam tile overlay (ring + countdown)
    const bp = this.px({ x: 2, y: 0 });
    const bcx = bp.x + TILE / 2, bcy = bp.y + TILE / 2;
    let beamLabel = '';
    if (beam.status === 'counting') {
      const frac = 1 - beam.remaining / BAL.beamCountdown;
      g.lineStyle(4, C.beam, 1).beginPath().arc(bcx, bcy, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false).strokePath();
      g.lineStyle(4, C.hull, 0.35).strokeCircle(bcx, bcy, 18);
      beamLabel = String(Math.ceil(Math.max(0, beam.remaining)));
    } else if (beam.status === 'idle') {
      const pulse = 0.55 + 0.45 * Math.sin(now * 5);
      g.lineStyle(3, C.crit, st.flags.tappedBeam ? 0.9 : pulse).strokeRoundedRect(bp.x + 2, bp.y + 2, TILE - 4, TILE - 4, 10);
      beamLabel = st.flags.tappedBeam ? '' : '';
    } else {
      g.lineStyle(3, 0xffa733, 1).strokeRoundedRect(bp.x + 2, bp.y + 2, TILE - 4, TILE - 4, 10);
      beamLabel = 'Full';
    }
    this.setText(this.tx.beam, bcx, bcy, beamLabel);

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
      const hf = Math.min(1, c.heat / BAL.heat.max);
      if (c.lockout > 0) {
        const sweep = c.lockout / BAL.heat.lockout;
        g.lineStyle(6, 0x9fd8ff, 0.9).beginPath().arc(STAGE.cx, STAGE.cy, STAGE.r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep, false).strokePath();
      } else if (hf >= 0.3) {
        g.lineStyle(6, this.heatColor(hf), 1).beginPath().arc(STAGE.cx, STAGE.cy, STAGE.r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hf, false).strokePath();
      }
      if (c.lockout > 0) stageText = 'JAMMED';
      else if (st.stats.rocks === 0) stageText = 'Tap the rock. Hit the glow for 3x.';
      else if (st.stats.taps >= 15 && !st.flags.usedHold) stageText = 'Hold your finger to keep cracking.';
    } else if (beam.status === 'counting') {
      stageText = 'Asteroid incoming...';
    } else {
      stageText = st.flags.tappedBeam ? 'Tap the beam for another asteroid' : 'Tap the beam to call an asteroid';
    }
    this.setText(this.tx.stage, STAGE.cx, c.rock ? STAGE.y + 13 : STAGE.cy, stageText, c.lockout > 0 ? '#9fd8ff' : T.dim);

    // --- Send button + Smasher overlay
    this.drawSend(g, st);
    this.drawSmasher(g, st);

    // --- status strip: heat + Bay
    const heatFrac = Math.min(1, c.heat / BAL.heat.max);
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

    // --- action row: Fire + Sell
    const ready = beam.status === 'idle';
    g.fillStyle(ready ? C.beamDeep : C.panelEdge, 1).fillRoundedRect(16, ACTION.y, 210, ACTION.h, 23);
    g.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(16, ACTION.y, 210, ACTION.h, 23);
    const fireText = beam.status === 'idle' ? 'Fire beam' : beam.status === 'counting' ? `Incoming ${Math.max(0, beam.remaining).toFixed(1)}s` : 'Bay full';
    this.setText(this.tx.fire, 121, ACTION.y + ACTION.h / 2, fireText, ready ? '#0B1020' : T.dim);

    const ore = sellableOre(st);
    const canSell = ore > 0;
    const sellPulse = canSell && currentGoal(st)?.id === 'sell' ? 0.6 + 0.4 * Math.sin(now * 6) : 1;
    g.fillStyle(canSell ? C.crit : C.panelEdge, canSell ? sellPulse : 1).fillRoundedRect(238, ACTION.y, 136, ACTION.h, 23);
    g.lineStyle(3, C.hullOutline, 1).strokeRoundedRect(238, ACTION.y, 136, ACTION.h, 23);
    this.setText(this.tx.sell, 306, ACTION.y + ACTION.h / 2, canSell ? `Sell ${ore} Ore` : 'Sell', canSell ? '#0B1020' : T.dim);
    this.setText(this.tx.hp, -100, -100, '');
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
    const sp = this.px({ x: 2, y: 1 });
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
