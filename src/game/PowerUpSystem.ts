/**
 * PowerUpSystem — SHIELD and BOOST pickup orbs (master plan §23).
 * Architecture intentionally open: add new `PowerUpKind` values + icons.
 */

import type { Camera } from './Camera';
import type { World } from './World';
import { randRange } from './util/math';

export type PowerUpKind = 'shield' | 'boost';

export interface PowerUp {
  active: boolean;
  kind: PowerUpKind;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  phase: number;
  radius: number;
}

const MAX_POWERUPS = 5;

export class PowerUpSystem {
  readonly powerups: PowerUp[] = [];
  private spawnTimer = 14;

  constructor() {
    for (let i = 0; i < MAX_POWERUPS; i++) {
      this.powerups.push({ active: false, kind: 'shield', x: 0, y: 0, life: 0, maxLife: 1, phase: 0, radius: 16 });
    }
  }

  private obtain(): PowerUp | null {
    for (const p of this.powerups) if (!p.active) return p;
    return null;
  }

  spawn(world: World, px: number, py: number, kind?: PowerUpKind): void {
    const p = this.obtain();
    if (!p) return;
    const spot = world.randomPointAround(px, py, 380, 850);
    p.active = true;
    p.kind = kind ?? (world.rnd() < 0.5 ? 'shield' : 'boost');
    p.x = spot.x;
    p.y = spot.y;
    p.maxLife = randRange(world.rnd, 16, 22);
    p.life = p.maxLife;
    p.phase = world.rnd() * Math.PI * 2;
  }

  update(dt: number, world: World, px: number, py: number, runTime: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && runTime > 12) {
      this.spawn(world, px, py);
      this.spawnTimer = randRange(world.rnd, 20, 32);
    }
    for (const p of this.powerups) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
      p.phase += dt * 2;
    }
  }

  render(ctx: CanvasRenderingContext2D, cam: Camera): void {
    for (const p of this.powerups) {
      if (!p.active) continue;
      if (!cam.isVisible(p.x, p.y, 40)) continue;
      const sx = cam.worldToScreenX(p.x);
      const sy = cam.worldToScreenY(p.y) + Math.sin(p.phase) * 3;
      const fade = p.life < 3 ? (Math.floor(p.life * 6) % 2 === 0 ? 0.3 : 1) : 1;
      const R = p.radius;
      const isShield = p.kind === 'shield';
      const main = isShield ? '96,200,255' : '255,190,90';

      ctx.save();
      ctx.globalAlpha = fade;
      // glow halo
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 2);
      glow.addColorStop(0, `rgba(${main},0.4)`);
      glow.addColorStop(1, `rgba(${main},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, R * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // bubble
      ctx.beginPath();
      ctx.arc(sx, sy, R, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${main},0.18)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${main},0.9)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // icon (shape + color, never color alone)
      ctx.fillStyle = `rgb(${main})`;
      ctx.strokeStyle = `rgb(${main})`;
      ctx.lineWidth = 2;
      if (isShield) {
        // hexagon shield glyph
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 - Math.PI / 2;
          const x = sx + Math.cos(a) * R * 0.52;
          const y = sy + Math.sin(a) * R * 0.6;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      } else {
        // double chevron boost glyph
        ctx.beginPath();
        ctx.moveTo(sx - R * 0.45, sy - R * 0.35);
        ctx.lineTo(sx + R * 0.1, sy);
        ctx.lineTo(sx - R * 0.45, sy + R * 0.35);
        ctx.moveTo(sx + R * 0.05, sy - R * 0.35);
        ctx.lineTo(sx + R * 0.6, sy);
        ctx.lineTo(sx + R * 0.05, sy + R * 0.35);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const p of this.powerups) p.active = false;
    this.spawnTimer = 14;
  }
}
