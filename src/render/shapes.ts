import type { EnemyKind, TowerKind } from '../config/balance';
import type { Point } from '../config/map';

export const ENEMY_RADIUS: Readonly<Record<EnemyKind, number>> = {
  grunt: 0.26, runner: 0.27, brute: 0.32, swarm: 0.13, shielded: 0.26, regenerator: 0.28, boss: 0.46,
};

type Ctx = CanvasRenderingContext2D;

function polygon(ctx: Ctx, at: Point, radius: number, sides: number, startAngle: number): void {
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (i / sides) * Math.PI * 2;
    ctx.lineTo(at.x + radius * Math.cos(a), at.y + radius * Math.sin(a));
  }
  ctx.closePath();
}

function path(ctx: Ctx, at: Point, points: readonly (readonly [number, number])[]): void {
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(at.x + x, at.y + y) : ctx.lineTo(at.x + x, at.y + y)));
  ctx.closePath();
}

function circle(ctx: Ctx, at: Point, radius: number): void {
  ctx.moveTo(at.x + radius, at.y);
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.closePath();
}

/** Starts a new path with the enemy's silhouette. */
export function traceEnemy(ctx: Ctx, kind: EnemyKind, at: Point): void {
  const r = ENEMY_RADIUS[kind];
  ctx.beginPath();
  switch (kind) {
    case 'grunt':
    case 'swarm':
      return circle(ctx, at, r);
    case 'runner':
      return polygon(ctx, at, r, 3, -Math.PI / 2);
    case 'brute':
      return polygon(ctx, at, r, 4, Math.PI / 4);
    case 'shielded':
      return polygon(ctx, at, r, 6, 0);
    case 'boss':
      return polygon(ctx, at, r, 8, Math.PI / 8);
    case 'regenerator': {
      const t = r * 0.38;
      return path(ctx, at, [
        [-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t], [t, r], [-t, r], [-t, t], [-r, t], [-r, -t], [-t, -t],
      ]);
    }
  }
}

/** Fills the tower's silhouette. Only the beam's ring has a hole. */
export function fillTower(ctx: Ctx, kind: TowerKind, at: Point): void {
  traceTower(ctx, kind, at);
  ctx.fill(kind === 'beam' ? 'evenodd' : 'nonzero');
}

function traceTower(ctx: Ctx, kind: TowerKind, at: Point): void {
  ctx.beginPath();
  switch (kind) {
    case 'bolt':
      return path(ctx, at, [[0, -0.28], [0.2, 0], [0, 0.28], [-0.2, 0]]);
    case 'cannon':
      return path(ctx, at, [[-0.22, -0.22], [0.22, -0.22], [0.22, 0.22], [-0.22, 0.22]]);
    case 'frost':
      // Six-pointed star.
      polygon(ctx, at, 0.29, 3, -Math.PI / 2);
      return path(ctx, at, [[0, 0.29], [-0.251, -0.145], [0.251, -0.145]]);
    case 'beam':
      circle(ctx, at, 0.26);
      return circle(ctx, at, 0.13);
    case 'tesla':
      return path(ctx, at, [[0.06, -0.3], [-0.2, 0.06], [-0.03, 0.06], [-0.06, 0.3], [0.2, -0.06], [0.03, -0.06]]);
    case 'warden':
      // A shield, point down.
      return path(ctx, at, [[-0.24, -0.25], [0.24, -0.25], [0.24, 0.06], [0, 0.3], [-0.24, 0.06]]);
  }
}
