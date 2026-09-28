/**
 * StarSystem — collectible stars in the world (master plan §22).
 *
 * Stars spawn at strategic positions: often ahead of the player's flight path,
 * sometimes off toward recent missile activity so collecting them is a risk.
 * Collecting awards score + coins (handled via events in Game).
 */

import type { Camera } from './Camera';
import type { World } from './World';
import { randRange } from './util/math';

export interface Star {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  phase: number;
  radius: number;
}

const MAX_STARS = 14;

export class StarSystem {
  readonly stars: Star[] = [];
  private spawnTimer = 0;
  private targetCount = 5;

  constructor() {
    for (let i = 0; i < MAX_STARS; i++) {
      this.stars.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, phase: 0, radius: 13 });
    }
  }

  activeCount(): number {
    let n = 0;
    for (const s of this.stars) if (s.active) n++;
    return n;
  }

  private obtain(): Star | null {
    for (const s of this.stars) if (!s.active) return s;
    return null;
  }

  /**
   * Spawn a star near the player with strategic bias:
   *  - 45%: ahead along current velocity (rewards momentum)
   *  - 25%: toward `threatAngle` if provided (risk/reward)
   *  - 30%: fully random bearing
   */
  spawnNear(
    world: World,
    px: number,
    py: number,
    pvx: number,
    pvy: number,
    threatAngle?: number,
  ): void {
    const s = this.obtain();
    if (!s) return;
    const rnd = world.rnd;
    let angle: number;
    const roll = rnd();
    const speed = Math.hypot(pvx, pvy);
    if (roll < 0.45 && speed > 40) {
      angle = Math.atan2(pvy, pvx) + randRange(rnd, -0.7, 0.7);
    } else if (roll < 0.7 && threatAngle !== undefined) {
      angle = threatAngle + randRange(rnd, -0.5, 0.5);
    } else {
      angle = rnd() * Math.PI * 2;
    }
    const r = randRange(rnd, 320, 900);
    s.active = true;
    s.x = world.wrapX(px + Math.cos(angle) * r);
    s.y = world.wrapY(py + Math.sin(angle) * r);
    s.vx = randRange(rnd, -12, 12);
    s.vy = randRange(rnd, -12, 12);
    s.maxLife = randRange(rnd, 22, 30);
    s.life = s.maxLife;
    s.phase = rnd() * Math.PI * 2;
  }

  update(dt: number, world: World, px: number, py: number, pvx: number, pvy: number, threatAngle?: number): void {
    this.spawnTimer -= dt;
    // Keep the sky populated but never crowded right next to the aircraft.
    if (this.spawnTimer <= 0 && this.activeCount() < this.targetCount) {
      this.spawnNear(world, px, py, pvx, pvy, threatAngle);
      this.spawnTimer = randRange(world.rnd, 1.6, 3.4);
    }
    for (const s of this.stars) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        continue;
      }
      s.x = world.wrapX(s.x + s.vx * dt);
      s.y = world.wrapY(s.y + s.vy * dt);
      s.phase += dt * 2.4;
    }
  }

  render(ctx: CanvasRenderingContext2D, cam: Camera, qualityHigh: boolean): void {
    for (const s of this.stars) {
      if (!s.active) continue;
      if (!cam.isVisible(s.x, s.y, 40)) continue;
      const sx = cam.worldToScreenX(s.x);
      const sy = cam.worldToScreenY(s.y);
      const fade = s.life < 3 ? (Math.floor(s.life * 6) % 2 === 0 ? 0.35 : 1) : 1; // blink before expiry
      const pulse = 1 + Math.sin(s.phase) * 0.12;
      const R = s.radius * pulse;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(sx, sy);
      ctx.rotate(s.phase * 0.35);

      // glow
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.1);
      glow.addColorStop(0, 'rgba(255,214,102,0.55)');
      glow.addColorStop(1, 'rgba(255,214,102,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, R * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // five-point star
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? R : R * 0.46;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = '#ffd666';
      ctx.fill();
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (qualityHigh) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.arc(-R * 0.18, -R * 0.22, R * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const s of this.stars) s.active = false;
    this.spawnTimer = 0.5;
  }
}
