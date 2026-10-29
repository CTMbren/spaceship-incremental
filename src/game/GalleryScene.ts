import Phaser from 'phaser';
import { HULL_TUG } from '../data/hulls';
import { drawExteriorFx, type ThrustState } from './art/exterior';
import { S, type Dir } from './art/kit';
import { drawBody, drawFx, type ArtKind } from './art/modules';
import { drawHullExterior } from './hullArt';
import { C, FONT, T } from './palette';
import { toScreen } from './shipLayout';
import { DPR, H, W } from './ShipScene';

/**
 * Art gallery (`?gallery`): every module in every state and level, and the hull exterior with its thrusters,
 * at the zoom levels the game uses. For reviewing the look on a phone without playing through.
 */
interface Cellspec { kind: ArtKind; title: string; level: number; working: boolean; powered: boolean; boosted: boolean; rusty?: boolean; cruising?: boolean; period: number; flashEvery?: number }

const COLS: { title: string; spec: (k: ArtKind) => Partial<Cellspec> }[] = [
  { title: 'Idle L1', spec: () => ({ level: 1, working: false, powered: true, boosted: false }) },
  { title: 'Working L2', spec: () => ({ level: 2, working: true, powered: true, boosted: false }) },
  { title: 'L4 Boost', spec: () => ({ level: 4, working: true, powered: true, boosted: true }) },
  { title: 'No power', spec: () => ({ level: 3, working: true, powered: false, boosted: false }) },
];
const ROWS: { kind: ArtKind; name: string; period: number; extra?: Partial<Cellspec>; extraTitle?: string }[] = [
  { kind: 'beam', name: 'Tractor Beam', period: 1.4 },
  { kind: 'grapple', name: 'Grapple Beam', period: 6 },
  { kind: 'smasher', name: 'Rock Smasher', period: 3, extra: { rusty: true, working: false, level: 1 }, extraTitle: 'Rusty' },
  { kind: 'smelter', name: 'Smelter', period: 3 },
  { kind: 'solar', name: 'Solar Wing', period: 3 },
  { kind: 'engine', name: 'Engine', period: 3, extra: { cruising: true, working: true, level: 2 }, extraTitle: 'Cruising' },
  { kind: 'winch', name: 'Auto-Winch', period: 3 },
  { kind: 'open', name: 'Open tile', period: 3 },
];
const ZOOMS = [0.6, 1, 1.5, 2.4];

export class GalleryScene extends Phaser.Scene {
  private box!: Phaser.GameObjects.Container;
  private bodies!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private cells: { x: number; y: number; spec: Cellspec; dir: Dir }[] = [];
  private hull = { x: 0, y: 0, info: null as ReturnType<typeof drawHullExterior> | null };
  private zoom = 1;
  private scroll = 0;
  private height = 0;
  private t = 0;

  constructor() {
    super('Gallery');
  }

  create(): void {
    const cam = this.cameras.main;
    cam.setBackgroundColor(C.space);
    cam.setZoom(DPR);
    cam.setScroll(-(W * DPR - W) / 2, -(H * DPR - H) / 2);
    this.box = this.add.container(0, 0);
    this.build();
    // header with zoom buttons
    const head = this.add.graphics().setDepth(10);
    head.fillStyle(C.panel, 1).fillRect(0, 0, W, 64);
    this.add.text(16, 20, 'Art gallery', { fontFamily: FONT, fontSize: '20px', fontStyle: '600', color: T.text, resolution: DPR }).setDepth(11);
    ZOOMS.forEach((z, i) => {
      const bx = W - 16 - (ZOOMS.length - i) * 52;
      const b = this.add.text(bx, 20, `${z}x`, { fontFamily: FONT, fontSize: '15px', color: '#0B1020', backgroundColor: '#FFC83D', padding: { x: 8, y: 4 }, resolution: DPR })
        .setDepth(11).setInteractive();
      b.on('pointerdown', () => { this.zoom = z; this.build(); });
    });
    let drag: { y: number; s: number } | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (p.worldY > 64) drag = { y: p.worldY, s: this.scroll }; });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!drag || !p.isDown) return;
      this.scroll = Math.max(0, Math.min(Math.max(0, this.height - (H - 80)), drag.s - (p.worldY - drag.y)));
      this.box.y = 72 - this.scroll;
    });
    this.input.on('pointerup', () => { drag = null; });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.scroll = Math.max(0, Math.min(Math.max(0, this.height - (H - 80)), this.scroll + dy * 0.5));
      this.box.y = 72 - this.scroll;
    });
  }

  private build(): void {
    this.box.removeAll(true);
    this.cells = [];
    this.box.setScale(1);
    this.box.y = 72 - this.scroll;
    const z = this.zoom;
    this.bodies = this.add.graphics();
    this.fx = this.add.graphics();
    const inner = this.add.container(0, 0, [this.bodies, this.fx]).setScale(z);
    this.box.add(inner);
    const colW = 72, x0 = 16 / z;
    let y = 30;
    const label = (x: number, yy: number, s: string, size = 12, color: string = T.dim) =>
      this.box.add(this.add.text(x, yy, s, { fontFamily: FONT, fontSize: `${size}px`, color, resolution: DPR * 2 }));
    COLS.forEach((c, i) => label(16 + i * colW * z, 4, c.title));
    label(16 + 4 * colW * z, 4, 'Special');
    for (const row of ROWS) {
      const beamy = row.kind === 'beam' || row.kind === 'grapple';
      const rowH = (beamy ? 150 : 96);
      label(16, y * z, row.name, 14, T.text);
      const yTile = y + (beamy ? 92 : 20);
      const specs = COLS.map((c) => ({ ...c.spec(row.kind) }));
      if (row.extra) specs.push({ level: 2, working: true, powered: true, boosted: false, ...row.extra });
      specs.forEach((sp, i) => {
        const full: Cellspec = { kind: row.kind, title: '', level: 1, working: false, powered: true, boosted: false, period: row.period, ...sp };
        const x = x0 + i * colW;
        this.cells.push({ x, y: yTile, spec: full, dir: 'up' });
        drawBody(this.bodies, row.kind, x, yTile, { level: full.level, dir: 'up', rusty: full.rusty, dark: !full.powered && row.kind !== 'open' && row.kind !== 'solar' });
      });
      if (row.extraTitle) label(16 + 4 * colW * z, (yTile + S + 4) * z, row.extraTitle);
      y += rowH;
    }
    // the full Tug exterior, thrusters cycling parked -> cruising -> off
    label(16, y * z, 'Hull exterior (thrusters: parked, cruising, off)', 14, T.text);
    const owned = HULL_TUG.template;
    const finished = new Set(owned.map((c) => `${toScreen(c).col},${toScreen(c).row}`));
    const hg = this.add.graphics();
    const hullBox = this.add.container(x0 * z + 40 * z, (y + 40) * z, [hg]).setScale(z);
    const decal = drawHullExterior(hg, owned, finished);
    for (const c of owned) {
      const s = toScreen(c);
      hg.fillStyle(C.deck, 1).fillRoundedRect(s.col * S + 2, s.row * S + 2, S - 4, S - 4, 8);
      drawBody(hg, 'open', s.col * S, s.row * S, { level: 1, dir: 'up' });
    }
    if (decal.decal) hullBox.add(this.add.text(decal.decal.x, decal.decal.y, 'LT-01', { fontFamily: FONT, fontSize: '9px', fontStyle: '600', color: '#1E2640', resolution: DPR * 3 }).setOrigin(0.5));
    const hfx = this.add.graphics();
    hullBox.add(hfx);
    this.hull = { x: 0, y: 0, info: decal };
    (this as unknown as { hfx: Phaser.GameObjects.Graphics }).hfx = hfx;
    this.box.add(hullBox);
    this.height = (y + 5 * S + 120) * z;
  }

  update(_t: number, delta: number): void {
    this.t += delta / 1000;
    const t = this.t;
    this.fx.clear();
    for (const c of this.cells) {
      const sp = c.spec;
      const p = (t % sp.period) / sp.period;
      const flash = sp.working && sp.powered ? Math.max(0, 1 - ((t % sp.period) / 0.6)) : 0;
      drawFx(this.fx, sp.kind, c.x, c.y, {
        t, dir: c.dir, level: sp.level, working: sp.working, progress: p, powered: sp.powered, boosted: sp.boosted,
        flash: sp.kind === 'beam' || sp.kind === 'grapple' || sp.kind === 'smelter' ? flash : 0, calm: false, rusty: sp.rusty,
        cruising: sp.cruising, targets: sp.kind === 'winch' ? ['left', 'right'] : undefined,
      });
    }
    const hfx = (this as unknown as { hfx?: Phaser.GameObjects.Graphics }).hfx;
    if (hfx && this.hull.info) {
      hfx.clear();
      const phase = Math.floor(t / 3) % 3;
      const thrust: ThrustState = phase === 0 ? 'parked' : phase === 1 ? 'cruising' : 'off';
      drawExteriorFx(hfx, this.hull.info, { t, thrust, boosted: false, flash: phase === 1 ? Math.max(0, 1 - (t % 3) / 0.5) : 0, calm: false });
    }
  }
}
