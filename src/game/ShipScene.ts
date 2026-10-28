import Phaser from 'phaser';
import { buyTile, canAfford } from '../core/actions';
import { cellKey, nextTileCost, parseKey, unlockableCells } from '../core/hull';
import { loadFromStorage, saveToStorage } from '../core/save';
import { createInitialState } from '../core/state';
import type { Cell, Cost, GameState } from '../core/types';
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

const ITEM_LABEL: Record<string, string> = {
  ore: 'Ore', ice: 'Ice', plate: 'Plate', coolant: 'Coolant', circuit: 'Circuit', core_shard: 'Shard',
};

export class ShipScene extends Phaser.Scene {
  private state!: GameState;
  private layer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private toast?: Phaser.GameObjects.Text;
  private debug = new URLSearchParams(window.location.search).has('debug');

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
    this.redraw();
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
    this.placeholder(owned, { x: 2, y: 0 }, C.beamDeep, 'Beam');
    this.placeholder(owned, { x: 2, y: 1 }, C.crusher, 'Crush');
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
    const pill = this.add.graphics();
    pill.fillStyle(C.panel, 1).fillRoundedRect(16, 14, 140, 40, 20);
    pill.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(16, 14, 140, 40, 20);
    pill.fillStyle(C.crit, 1).fillCircle(40, 34, 10);
    const credits = this.txt(60, 34, String(Math.floor(this.state.credits)), {
      fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: T.text,
    }).setOrigin(0, 0.5);

    const def = HULLS[this.state.ship.hullId];
    const next = nextTileCost(def, this.state.ship.ownedCells.length);
    const chipText = next ? `Next: Expand hull · ${this.costText(next)}` : 'Hull complete';
    const chip = this.add.graphics();
    chip.fillStyle(C.panel, 1).fillRoundedRect(16, 66, 358, 44, 22);
    chip.lineStyle(3, C.panelEdge, 1).strokeRoundedRect(16, 66, 358, 44, 22);
    const chipLabel = this.txt(W / 2, 88, chipText, {
      fontFamily: FONT, fontSize: '15px', color: T.text, fixedWidth: 330, align: 'center',
    }).setOrigin(0.5);

    this.hud.add([pill, credits, chip, chipLabel]);

    if (this.debug) {
      const dbg = this.txt(W - 16, 34, '[+grant]', { fontFamily: FONT, fontSize: '16px', color: T.coral })
        .setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      dbg.on('pointerup', () => {
        const s = this.state;
        this.apply({ ...s, credits: s.credits + 500, items: Object.fromEntries(Object.entries(s.items).map(([k, v]) => [k, v + 20])) as GameState['items'] });
      });
      const reset = this.txt(W - 16, 14, '[reset]', { fontFamily: FONT, fontSize: '12px', color: T.dim })
        .setOrigin(1, 0).setInteractive();
      reset.on('pointerup', () => this.apply(createInitialState()));
      this.hud.add([dbg, reset]);
    }
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

  private drawStars(): void {
    const g = this.add.graphics();
    const rnd = new Phaser.Math.RandomDataGenerator(['stars']);
    for (let i = 0; i < 60; i++) {
      g.fillStyle(0xe6ecff, rnd.realInRange(0.1, 0.45));
      g.fillCircle(rnd.between(0, W), rnd.between(0, H), rnd.realInRange(0.6, 1.6));
    }
  }
}
