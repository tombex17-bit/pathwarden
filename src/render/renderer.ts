import { ABILITIES, HERO, type AbilityKind, type EnemyKind, type TowerKind } from '../config/balance';
import { GRID_H, GRID_W, SLOT_RADIUS, type Point } from '../config/map';
import { currentSlow } from '../sim/enemies';
import { cellCenter, layoutOf, pointAt, type Layout } from '../sim/path';
import { rankOf } from '../sim/stats';
import { towerStats } from '../sim/stats';
import type { SimEvent, State } from '../sim/types';
import { drawEnemy, drawTower, paintScenery } from './art';
import { COLORS, SHADES } from './palette';
import { ENEMY_RADIUS, traceEnemy } from './shapes';
import { fitView, type View } from './view';

const SHOT_MS = 80;
const DEATH_MS = 300;
const CAST_MS = 250;

const LIFE_MS = { shot: SHOT_MS, flash: SHOT_MS, death: DEATH_MS, cast: CAST_MS, tap: DEATH_MS } as const;

const ABILITY_COLORS = {
  meteor: COLORS.cannon, stasis: COLORS.frost, bounty: COLORS.gold, smite: COLORS.text,
} as const;

export interface Preview { ability: AbilityKind; at: Point }

type Effect = { ageMs: number } & (
  | { type: 'shot'; kind: TowerKind; points: Point[]; splash: number; still: boolean }
  | { type: 'flash'; enemyId: number }
  | { type: 'cast'; ability: AbilityKind; at: Point; still: boolean }
  | { type: 'death'; kind: EnemyKind; at: Point }
  | { type: 'tap'; at: Point }
);

/** Draws the state. It never changes the state. */
export class Renderer {
  private view: View = fitView(GRID_W, GRID_H);
  private effects: Effect[] = [];
  private readonly ctx: CanvasRenderingContext2D;
  /** Hit flashes, death fades and cast pulses are left out for players who ask for less motion. */
  private readonly lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** Where each slot's turret last aimed, in radians. */
  private readonly aims = new Map<number, number>();
  /** The scenery, painted once per map, road and canvas size. */
  private scenery: { canvas: HTMLCanvasElement; key: string; layout: Layout } | undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    this.ctx = ctx;
  }

  onEvents(events: readonly SimEvent[]): void {
    const still = this.lessMotion.matches;
    for (const e of events) {
      if (e.type === 'shot') {
        this.effects.push({ type: 'shot', kind: e.kind, points: e.points, splash: e.splash, still, ageMs: 0 });
        const [from, to] = e.points as [Point, Point];
        this.aims.set(e.slot, Math.atan2(to.y - from.y, to.x - from.x));
      } else if (e.type === 'hit' && e.kind !== 'beam' && !still) {
        // Beams hit constantly, so flashing would turn their target solid white.
        this.effects.push({ type: 'flash', enemyId: e.enemyId, ageMs: 0 });
      } else if (e.type === 'cast') {
        this.effects.push({ type: 'cast', ability: e.ability, at: { x: e.x, y: e.y }, still, ageMs: 0 });
      } else if (e.type === 'tap') {
        this.effects.push({ type: 'tap', at: { x: e.x, y: e.y }, ageMs: 0 });
      } else if (e.type === 'death' && !still) {
        this.effects.push({ type: 'death', kind: e.kind, at: { x: e.x, y: e.y }, ageMs: 0 });
      }
    }
  }

  draw(
    state: State, alpha: number, frameMs: number, selectedSlot: number | undefined, preview?: Preview, guideSlot?: number,
    editingWalls = false,
  ): void {
    this.resize();
    const { ctx, view } = this;
    for (const fx of this.effects) fx.ageMs += frameMs;
    this.effects = this.effects.filter((fx) => fx.ageMs < LIFE_MS[fx.type]);

    const ratio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const layout = layoutOf(state);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.paintedScenery(state, layout, ratio), 0, 0);
    // From here on, one unit is one grid cell and `px` is one CSS pixel.
    ctx.setTransform(view.scale * ratio, 0, 0, view.scale * ratio, view.left * ratio, view.top * ratio);
    // Clip left and right only, where enemies enter and leave.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, -GRID_H * 10, GRID_W, GRID_H * 21);
    ctx.clip();
    const px = 1 / view.scale;

    if (editingWalls) this.drawGrid(px);
    this.drawWalls(state, px, editingWalls);
    this.drawZones(state, px);
    this.drawSlots(state, selectedSlot, px);
    if (guideSlot !== undefined) this.drawGuide(layout, guideSlot, px);
    this.drawEnemies(state, alpha, px);
    this.drawEffects(px);
    if (preview) this.drawRing(preview.ability, preview.at, px);
    ctx.restore();
  }

  /** The scenery canvas, painted again only when the map, its road or the canvas size changes. */
  private paintedScenery(state: State, layout: Layout, ratio: number): HTMLCanvasElement {
    const { canvas, view } = this;
    const key = `${canvas.width}x${canvas.height}|${state.map}`;
    if (this.scenery && this.scenery.key === key && this.scenery.layout === layout) return this.scenery.canvas;
    const painted = this.scenery?.canvas ?? document.createElement('canvas');
    painted.width = canvas.width;
    painted.height = canvas.height;
    const g = painted.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = COLORS.background;
    g.fillRect(0, 0, painted.width, painted.height);
    g.setTransform(view.scale * ratio, 0, 0, view.scale * ratio, view.left * ratio, view.top * ratio);
    g.save();
    g.beginPath();
    g.rect(0, -GRID_H * 10, GRID_W, GRID_H * 21);
    g.clip();
    paintScenery(g, state.map, layout, state.map === 'wilds' ? state.wildSeed : 0, 1 / view.scale);
    g.restore();
    this.scenery = { canvas: painted, key, layout };
    return painted;
  }

  private resize(): void {
    const { canvas } = this;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.view = fitView(canvas.clientWidth, canvas.clientHeight);
  }

  /** Faint cell lines while the player places Maze walls. */
  private drawGrid(px: number): void {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.path;
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let x = 1; x < GRID_W; x++) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, GRID_H);
    }
    for (let y = 1; y < GRID_H; y++) {
      ctx.moveTo(0, y);
      ctx.lineTo(GRID_W, y);
    }
    ctx.stroke();
  }

  /** Maze walls: stone blocks with a lighter top. Shown on the Maze, or while planning one. */
  private drawWalls(state: State, px: number, planning: boolean): void {
    if (state.walls.length === 0 || (state.map !== 'maze' && !planning)) return;
    const { ctx } = this;
    ctx.lineWidth = 2 * px;
    for (const cell of state.walls) {
      const c = cellCenter(cell);
      ctx.fillStyle = SHADES.stone;
      ctx.fillRect(c.x - 0.42, c.y - 0.42, 0.84, 0.84);
      ctx.fillStyle = SHADES.stoneLight;
      ctx.fillRect(c.x - 0.42, c.y - 0.42, 0.84, 0.22);
      ctx.strokeStyle = SHADES.roadEdge;
      ctx.strokeRect(c.x - 0.42, c.y - 0.42, 0.84, 0.84);
    }
  }

  private drawZones(state: State, px: number): void {
    const { ctx } = this;
    for (const zone of state.zones) {
      this.drawRing(zone.kind, zone, px);
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = ABILITY_COLORS[zone.kind];
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Outlines an ability's area and leaves that circle as the current path. */
  private drawRing(ability: AbilityKind, at: Point, px: number): void {
    const { ctx } = this;
    ctx.strokeStyle = ABILITY_COLORS[ability];
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(at.x, at.y, ABILITIES[ability].radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawSlots(state: State, selected: number | undefined, px: number): void {
    const { ctx } = this;
    ctx.lineWidth = 2 * px;
    const { slots } = layoutOf(state);
    slots.forEach((slot, i) => {
      const tower = state.towers.find((t) => t.slot === i);
      ctx.fillStyle = COLORS.panel;
      ctx.strokeStyle = i === selected ? COLORS.text : tower ? COLORS[tower.kind] : COLORS.path;
      ctx.beginPath();
      ctx.arc(slot.x, slot.y, SLOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (tower) {
        drawTower(ctx, tower.kind, slot, this.aims.get(i) ?? -Math.PI / 2);
        ctx.lineWidth = 2 * px;
        // Merged tiers add rings; ranks show as dots underneath.
        ctx.strokeStyle = COLORS[tower.kind];
        for (let t = 1; t < tower.tier; t++) {
          ctx.beginPath();
          ctx.arc(slot.x, slot.y, SLOT_RADIUS + t * 5 * px, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Overdrive and Rally show as a gold ring while they last.
        if (tower.boostTicks > 0 || (state.rallyTicks > 0 && tower.kind === 'warden')) {
          ctx.strokeStyle = COLORS.gold;
          ctx.beginPath();
          ctx.arc(slot.x, slot.y, SLOT_RADIUS + tower.tier * 5 * px, 0, Math.PI * 2);
          ctx.stroke();
        }
        const rank = rankOf(tower.kills);
        ctx.fillStyle = COLORS.gold;
        for (let r = 0; r < rank; r++) {
          ctx.beginPath();
          ctx.arc(slot.x + (r - (rank - 1) / 2) * 0.14, slot.y + SLOT_RADIUS + 0.12, 0.05, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = COLORS.muted;
        ctx.beginPath();
        ctx.moveTo(slot.x - 0.14, slot.y);
        ctx.lineTo(slot.x + 0.14, slot.y);
        ctx.moveTo(slot.x, slot.y - 0.14);
        ctx.lineTo(slot.x, slot.y + 0.14);
        ctx.stroke();
      }
    });

    const tower = state.towers.find((t) => t.slot === selected);
    if (tower) {
      const at = slots[tower.slot]!;
      ctx.strokeStyle = COLORS.muted;
      ctx.beginPath();
      ctx.arc(at.x, at.y, towerStats(tower.kind, tower.spec).range, 0, Math.PI * 2);
      ctx.stroke();
      if (tower.kind === 'warden') {
        ctx.strokeStyle = COLORS.warden;
        ctx.beginPath();
        ctx.arc(at.x, at.y, HERO.auraRange, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** A ring around the slot the guide points at. */
  private drawGuide(layout: Layout, slot: number, px: number): void {
    const { ctx } = this;
    const at = layout.slots[slot]!;
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(at.x, at.y, SLOT_RADIUS + 0.16, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawEnemies(state: State, alpha: number, px: number): void {
    const { ctx } = this;
    const flashing = new Set(this.effects.flatMap((fx) => (fx.type === 'flash' ? [fx.enemyId] : [])));
    ctx.lineWidth = 2 * px;
    for (const e of state.enemies) {
      const layout = layoutOf(state);
      const dist = e.prevDist + (e.dist - e.prevDist) * alpha;
      const at = pointAt(layout, dist);
      const ahead = pointAt(layout, dist + 0.1);
      const len = Math.hypot(ahead.x - at.x, ahead.y - at.y) || 1;
      const radius = ENEMY_RADIUS[e.kind];
      drawEnemy(ctx, e.kind, at, { x: (ahead.x - at.x) / len, y: (ahead.y - at.y) / len }, flashing.has(e.id));
      if (e.kind === 'shielded' && e.shield > 0) {
        ctx.strokeStyle = COLORS.text;
        ctx.beginPath();
        ctx.arc(at.x, at.y, radius + 0.08, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.marked) {
        ctx.strokeStyle = COLORS.gold;
        ctx.beginPath();
        ctx.arc(at.x, at.y, radius + 0.14, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (currentSlow(e, state.tick) > 0) {
        ctx.strokeStyle = COLORS.frost;
        traceEnemy(ctx, e.kind, at);
        ctx.stroke();
      }
      if (e.hp < 1) {
        const width = Math.max(radius * 2, 0.4);
        const height = Math.max(0.07, 3 * px);
        const top = at.y - radius - height - 0.12;
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(at.x - width / 2, top, width, height);
        ctx.fillStyle = COLORS.text;
        ctx.fillRect(at.x - width / 2, top, width * e.hp, height);
      }
    }
  }

  private drawEffects(px: number): void {
    const { ctx } = this;
    ctx.lineWidth = 2 * px;
    for (const fx of this.effects) {
      if (fx.type === 'shot') {
        this.drawShot(fx, px);
      } else if (fx.type === 'cast') {
        this.drawRing(fx.ability, fx.at, px);
        if (fx.still) continue;
        ctx.globalAlpha = 0.5 * (1 - fx.ageMs / CAST_MS);
        ctx.fillStyle = ABILITY_COLORS[fx.ability];
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (fx.type === 'tap') {
        // A small ring where the tap landed; it stays still, so reduced motion keeps it.
        ctx.strokeStyle = COLORS.text;
        ctx.beginPath();
        ctx.arc(fx.at.x, fx.at.y, 0.35, 0, Math.PI * 2);
        ctx.stroke();
      } else if (fx.type === 'death') {
        // The body fades while bits fly apart.
        const t = fx.ageMs / DEATH_MS;
        const r = ENEMY_RADIUS[fx.kind];
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = fx.kind === 'boss' ? COLORS.boss : COLORS.enemy;
        traceEnemy(ctx, fx.kind, fx.at);
        ctx.fill();
        ctx.fillStyle = fx.kind === 'boss' ? SHADES.bossDark : SHADES.enemyLight;
        const bit = r * 0.35 * (1 - t);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + r;
          const d = r + t * (0.25 + r);
          ctx.fillRect(fx.at.x + Math.cos(a) * d - bit / 2, fx.at.y + Math.sin(a) * d - bit / 2, bit, bit);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Each tower kind shoots its own way: bolts and shells fly, frost leaves shards, beams burn, lightning jumps. */
  private drawShot(fx: Extract<Effect, { type: 'shot' }>, px: number): void {
    const { ctx } = this;
    const color = COLORS[fx.kind];
    const [from, to] = fx.points as [Point, Point];
    const t = fx.still ? 1 : Math.min(1, fx.ageMs / SHOT_MS);
    const lerp = (k: number): Point => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
    const line = (points: readonly Point[], width: number, stroke: string): void => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width * px;
      ctx.beginPath();
      for (const p of points) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    switch (fx.kind) {
      case 'bolt':
      case 'warden':
        line(fx.still ? [from, to] : [lerp(Math.max(0, t - 0.45)), lerp(t)], 3, color);
        break;
      case 'cannon': {
        const shell = lerp(t);
        ctx.fillStyle = SHADES.cannonDark;
        ctx.beginPath();
        ctx.arc(shell.x, shell.y, 0.08, 0, Math.PI * 2);
        ctx.fill();
        if (t >= 0.6 || fx.still) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2 * px;
          ctx.beginPath();
          ctx.arc(to.x, to.y, fx.splash, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'frost':
        line([from, to], 2, color);
        ctx.fillStyle = COLORS.text;
        for (const k of [0.35, 0.6, 0.85]) {
          const p = lerp(k);
          ctx.fillRect(p.x - 0.04, p.y - 0.04, 0.08, 0.08);
        }
        if (fx.splash > 0) {
          ctx.beginPath();
          ctx.arc(to.x, to.y, fx.splash, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case 'beam':
        line(fx.points, 4, color);
        line(fx.points, 1.5, COLORS.text);
        break;
      case 'tesla': {
        // A jagged bolt along every jump of the chain.
        const zig: Point[] = [];
        fx.points.forEach((p, i) => {
          const next = fx.points[i + 1];
          zig.push(p);
          if (!next) return;
          for (let k = 1; k < 4; k++) {
            const off = (((i * 7 + k * 13) % 5) - 2) * 0.05;
            zig.push({ x: p.x + ((next.x - p.x) * k) / 4 - (next.y - p.y) * off, y: p.y + ((next.y - p.y) * k) / 4 + (next.x - p.x) * off });
          }
        });
        line(zig, 3, color);
        line(zig, 1, COLORS.text);
        break;
      }
    }
  }
}
