import { ABILITIES, type AbilityKind, type EnemyKind, type TowerKind } from '../config/balance';
import { GRID_H, GRID_W, PATH, PATH_WIDTH, SLOTS, SLOT_RADIUS, type Point } from '../config/map';
import { currentSlow } from '../sim/enemies';
import { pointAt } from '../sim/path';
import { towerStats } from '../sim/stats';
import type { SimEvent, State } from '../sim/types';
import { COLORS } from './palette';
import { ENEMY_RADIUS, fillTower, traceEnemy } from './shapes';
import { fitView, type View } from './view';

const SHOT_MS = 80;
const DEATH_MS = 150;
const CAST_MS = 250;

const LIFE_MS = { shot: SHOT_MS, flash: SHOT_MS, death: DEATH_MS, cast: CAST_MS } as const;

const ABILITY_COLORS = {
  meteor: COLORS.cannon, stasis: COLORS.frost, bounty: COLORS.gold, smite: COLORS.text,
} as const;

export interface Preview { ability: AbilityKind; at: Point }

type Effect = { ageMs: number } & (
  | { type: 'shot'; kind: TowerKind; points: Point[]; splash: number }
  | { type: 'flash'; enemyId: number }
  | { type: 'cast'; ability: AbilityKind; at: Point; still: boolean }
  | { type: 'death'; kind: EnemyKind; at: Point }
);

/** Draws the state. It never changes the state. */
export class Renderer {
  private view: View = fitView(GRID_W, GRID_H);
  private effects: Effect[] = [];
  private readonly ctx: CanvasRenderingContext2D;
  /** Hit flashes, death fades and cast pulses are left out for players who ask for less motion. */
  private readonly lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    this.ctx = ctx;
  }

  onEvents(events: readonly SimEvent[]): void {
    const still = this.lessMotion.matches;
    for (const e of events) {
      if (e.type === 'shot') {
        this.effects.push({ type: 'shot', kind: e.kind, points: e.points, splash: e.splash, ageMs: 0 });
      } else if (e.type === 'hit' && e.kind !== 'beam' && !still) {
        // Beams hit constantly, so flashing would turn their target solid white.
        this.effects.push({ type: 'flash', enemyId: e.enemyId, ageMs: 0 });
      } else if (e.type === 'cast') {
        this.effects.push({ type: 'cast', ability: e.ability, at: { x: e.x, y: e.y }, still, ageMs: 0 });
      } else if (e.type === 'death' && !still) {
        this.effects.push({ type: 'death', kind: e.kind, at: { x: e.x, y: e.y }, ageMs: 0 });
      }
    }
  }

  draw(
    state: State, alpha: number, frameMs: number, selectedSlot: number | undefined, preview?: Preview, guideSlot?: number,
  ): void {
    this.resize();
    const { ctx, view } = this;
    for (const fx of this.effects) fx.ageMs += frameMs;
    this.effects = this.effects.filter((fx) => fx.ageMs < LIFE_MS[fx.type]);

    const ratio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // From here on, one unit is one grid cell and `px` is one CSS pixel.
    ctx.setTransform(view.scale * ratio, 0, 0, view.scale * ratio, view.left * ratio, view.top * ratio);
    // Clip left and right only, where enemies enter and leave.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, -GRID_H * 10, GRID_W, GRID_H * 21);
    ctx.clip();
    const px = 1 / view.scale;

    this.drawPath();
    this.drawZones(state, px);
    this.drawSlots(state, selectedSlot, px);
    if (guideSlot !== undefined) this.drawGuide(guideSlot, px);
    this.drawEnemies(state, alpha, px);
    this.drawEffects(px);
    if (preview) this.drawRing(preview.ability, preview.at, px);
    ctx.restore();
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

  private drawPath(): void {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.path;
    ctx.lineWidth = PATH_WIDTH;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    for (const p of PATH) ctx.lineTo(p.x, p.y);
    ctx.stroke();
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
    SLOTS.forEach((slot, i) => {
      const tower = state.towers.find((t) => t.slot === i);
      ctx.fillStyle = COLORS.panel;
      ctx.strokeStyle = i === selected ? COLORS.text : tower ? COLORS[tower.kind] : COLORS.path;
      ctx.beginPath();
      ctx.arc(slot.x, slot.y, SLOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (tower) {
        ctx.fillStyle = COLORS[tower.kind];
        fillTower(ctx, tower.kind, slot);
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
      const at = SLOTS[tower.slot]!;
      ctx.strokeStyle = COLORS.muted;
      ctx.beginPath();
      ctx.arc(at.x, at.y, towerStats(tower.kind, tower.spec).range, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** A ring around the slot the guide points at. */
  private drawGuide(slot: number, px: number): void {
    const { ctx } = this;
    const at = SLOTS[slot]!;
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
      const at = pointAt(e.prevDist + (e.dist - e.prevDist) * alpha);
      const radius = ENEMY_RADIUS[e.kind];
      ctx.fillStyle = flashing.has(e.id) ? COLORS.text : e.kind === 'boss' ? COLORS.boss : COLORS.enemy;
      traceEnemy(ctx, e.kind, at);
      ctx.fill();
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
        ctx.strokeStyle = COLORS[fx.kind];
        ctx.beginPath();
        for (const p of fx.points) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        const center = fx.points[1];
        if (fx.splash > 0 && center) {
          ctx.beginPath();
          ctx.arc(center.x, center.y, fx.splash, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (fx.type === 'cast') {
        this.drawRing(fx.ability, fx.at, px);
        if (fx.still) continue;
        ctx.globalAlpha = 0.5 * (1 - fx.ageMs / CAST_MS);
        ctx.fillStyle = ABILITY_COLORS[fx.ability];
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (fx.type === 'death') {
        ctx.globalAlpha = 1 - fx.ageMs / DEATH_MS;
        ctx.fillStyle = fx.kind === 'boss' ? COLORS.boss : COLORS.enemy;
        traceEnemy(ctx, fx.kind, fx.at);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}
