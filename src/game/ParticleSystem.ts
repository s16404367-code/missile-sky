/**
 * ParticleSystem — one pooled system for every effect in the game
 * (master plan §17, §36): explosions, smoke trails, boost flames, debris,
 * star sparkles, shield pops.
 *
 * All particles live in a single preallocated array; nothing is allocated
 * per-frame beyond cached fill-style strings.
 */

import type { Camera } from './Camera';

export const P_SPARK = 0;
export const P_SMOKE = 1;
export const P_FIRE = 2;
export const P_DEBRIS = 3;
export const P_RING = 4;
export const P_TWINKLE = 5;

export interface Particle {
  active: boolean;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  /** End size (growth/shrink). */
  size2: number;
  drag: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  rot: number;
  rotV: number;
  /** Follows ambient wind (smoke drift). */
  wind: number;
}

const MAX_PARTICLES = 1300;

/** Soft radial sprite cache keyed by color — avoids per-particle gradients. */
const spriteCache = new Map<string, HTMLCanvasElement>();

function softSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const key = `${r},${g},${b}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const S = 48;
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  spriteCache.set(key, c);
  return c;
}

const styleCache = new Map<string, string>();
function rgba(r: number, g: number, b: number, a: number): string {
  const ab = Math.round(Math.min(1, Math.max(0, a)) * 20) / 20; // bucket alpha
  const key = `${r},${g},${b},${ab}`;
  let s = styleCache.get(key);
  if (!s) {
    s = `rgba(${r},${g},${b},${ab})`;
    if (styleCache.size > 600) styleCache.clear();
    styleCache.set(key, s);
  }
  return s;
}

export class ParticleSystem {
  readonly particles: Particle[] = [];
  private cursor = 0;
  /** Runtime budget multiplier (quality × auto-degrade). */
  budget = 1;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false, kind: P_SMOKE, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 2, size2: 2, drag: 1,
        r: 255, g: 255, b: 255, alpha: 1, rot: 0, rotV: 0, wind: 0,
      });
    }
  }

  /** Grab a particle slot, recycling round-robin when the pool is full. */
  private obtain(): Particle {
    const cap = Math.max(120, Math.floor(MAX_PARTICLES * this.budget));
    for (let tries = 0; tries < cap; tries++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % cap;
      if (!p.active) return p;
    }
    // All busy: force-recycle the slot we landed on.
    const p = this.particles[this.cursor % cap];
    this.cursor = (this.cursor + 1) % cap;
    return p;
  }

  private spawn(
    kind: number, x: number, y: number, vx: number, vy: number,
    life: number, size: number, size2: number, r: number, g: number, b: number,
    alpha: number, drag: number, wind = 0,
  ): Particle {
    const p = this.obtain();
    p.active = true;
    p.kind = kind;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life;
    p.size = size; p.size2 = size2;
    p.r = r; p.g = g; p.b = b;
    p.alpha = alpha; p.drag = drag; p.wind = wind;
    p.rot = Math.random() * Math.PI * 2;
    p.rotV = (Math.random() * 2 - 1) * 6;
    return p;
  }

  /** Full missile-explosion package: flash ring, fireball, sparks, smoke, debris. */
  burstExplosion(x: number, y: number, power: number): void {
    const b = this.budget;
    const nSparks = Math.max(4, Math.floor(14 * power * b));
    const nSmoke = Math.max(3, Math.floor(9 * power * b));
    const nFire = Math.max(3, Math.floor(8 * power * b));
    const nDebris = Math.max(2, Math.floor(5 * power * b));

    // Shockwave ring + flash.
    this.spawn(P_RING, x, y, 0, 0, 0.34, 8, 78 * power + 40, 255, 235, 190, 0.9, 0);
    this.spawn(P_FIRE, x, y, 0, 0, 0.16, 46 * power + 18, 60 * power, 255, 240, 200, 0.95, 0.5);

    for (let i = 0; i < nSparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (90 + Math.random() * 260) * (0.6 + power * 0.5);
      this.spawn(P_SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.3 + Math.random() * 0.4, 2.2, 0.4, 255, 200 + Math.floor(Math.random() * 55), 90, 1, 2.4);
    }
    for (let i = 0; i < nFire; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 150) * power;
      this.spawn(P_FIRE, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.22 + Math.random() * 0.3, (8 + Math.random() * 10) * power, 2, 255, 130 + Math.floor(Math.random() * 90), 40, 0.9, 2.2);
    }
    for (let i = 0; i < nSmoke; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (18 + Math.random() * 90) * power;
      const g = 190 + Math.floor(Math.random() * 45);
      this.spawn(P_SMOKE, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.7 + Math.random() * 0.9, 5 + Math.random() * 6, (16 + Math.random() * 16) * power, g, g, g, 0.5, 1.5, 0.5);
    }
    for (let i = 0; i < nDebris; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 200) * power;
      this.spawn(P_DEBRIS, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.6 + Math.random() * 0.7, 1.6 + Math.random() * 2.2, 1, 90 + Math.floor(Math.random() * 60), 95, 105, 1, 1.1);
    }
  }

  /** Missile smoke trail puff (colors as "r,g,b" string from type def). */
  missileSmoke(x: number, y: number, vx: number, vy: number, smokeRgb: string): void {
    const parts = smokeRgb.split(',');
    const r = +parts[0] || 210, g = +parts[1] || 215, b = +parts[2] || 225;
    const jx = (Math.random() * 2 - 1) * 8;
    const jy = (Math.random() * 2 - 1) * 8;
    this.spawn(P_SMOKE, x + jx, y + jy, vx * 0.12 + jx, vy * 0.12 + jy,
      0.55 + Math.random() * 0.5, 2.4 + Math.random() * 1.8, 7 + Math.random() * 5, r, g, b, 0.42, 1.6, 0.7);
  }

  /** Player engine trail puff. */
  playerTrail(x: number, y: number, vx: number, vy: number, boost: boolean, r: number, g: number, b: number): void {
    if (boost) {
      this.spawn(P_FIRE, x, y, vx * 0.25 + (Math.random() * 2 - 1) * 30, vy * 0.25 + (Math.random() * 2 - 1) * 30,
        0.16 + Math.random() * 0.14, 5 + Math.random() * 4, 1, 255, 210, 120, 0.85, 2.5);
    } else {
      this.spawn(P_SMOKE, x, y, vx * 0.1, vy * 0.1,
        0.35 + Math.random() * 0.3, 2.2, 5.5 + Math.random() * 3, r, g, b, 0.3, 1.8, 0.6);
    }
  }

  /** Star collect sparkle. */
  starBurst(x: number, y: number): void {
    const n = Math.max(4, Math.floor(10 * this.budget));
    this.spawn(P_RING, x, y, 0, 0, 0.28, 5, 34, 255, 214, 102, 0.9, 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 160;
      this.spawn(P_TWINKLE, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.3 + Math.random() * 0.35, 2.4, 0.3, 255, 220, 110, 1, 2.6);
    }
  }

  /** Shield deploy / block effect. */
  shieldPop(x: number, y: number, big = false): void {
    this.spawn(P_RING, x, y, 0, 0, big ? 0.5 : 0.35, 10, big ? 70 : 46, 120, 220, 255, 0.95, 0);
    const n = Math.max(4, Math.floor((big ? 16 : 9) * this.budget));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 180;
      this.spawn(P_SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.25 + Math.random() * 0.3, 2, 0.3, 150, 225, 255, 1, 2.6);
    }
  }

  /** Small puff for expired/fizzled missiles and power-up pickup. */
  puff(x: number, y: number, r: number, g: number, b: number, n = 6): void {
    for (let i = 0; i < Math.max(2, Math.floor(n * this.budget)); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 60;
      this.spawn(P_SMOKE, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.4 + Math.random() * 0.4, 3, 9, r, g, b, 0.4, 1.6, 0.6);
    }
  }

  /** Large player-death explosion. */
  playerExplosion(x: number, y: number, r: number, g: number, b: number): void {
    this.burstExplosion(x, y, 2.1);
    this.spawn(P_RING, x, y, 0, 0, 0.7, 12, 150, 255, 255, 255, 1, 0);
    const n = Math.max(8, Math.floor(22 * this.budget));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 280;
      this.spawn(P_DEBRIS, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.9 + Math.random() * 0.9, 2 + Math.random() * 3, 1.2, r, g, b, 1, 0.8);
    }
  }

  update(dt: number, windX = 0, windY = 0): void {
    const ps = this.particles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      const dfac = Math.exp(-p.drag * dt);
      p.vx *= dfac;
      p.vy *= dfac;
      if (p.wind > 0) {
        p.vx += windX * p.wind * dt;
        p.vy += windY * p.wind * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.rotV * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const ps = this.particles;
    const vw = cam.viewW;
    const vh = cam.viewH;

    // Pass 1: normal blending (smoke, debris).
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.active || p.kind === P_SPARK || p.kind === P_FIRE || p.kind === P_RING || p.kind === P_TWINKLE) continue;
      const sx = cam.worldToScreenX(p.x);
      const sy = cam.worldToScreenY(p.y);
      if (sx < -60 || sx > vw + 60 || sy < -60 || sy > vh + 60) continue;
      const t = 1 - p.life / p.maxLife;
      const size = p.size + (p.size2 - p.size) * t;
      const a = p.alpha * (p.life / p.maxLife);
      if (p.kind === P_SMOKE) {
        const spr = softSprite(p.r, p.g, p.b);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(spr, sx - size, sy - size, size * 2, size * 2);
      } else {
        // debris: small rotating rect
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillStyle = rgba(p.r, p.g, p.b, 1);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.rot);
        ctx.fillRect(-size, -size * 0.6, size * 2, size * 1.2);
        ctx.restore();
      }
    }

    // Pass 2: additive glow (fire, sparks, rings, twinkles).
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.active) continue;
      const sx = cam.worldToScreenX(p.x);
      const sy = cam.worldToScreenY(p.y);
      if (sx < -80 || sx > vw + 80 || sy < -80 || sy > vh + 80) continue;
      const t = 1 - p.life / p.maxLife;
      const a = p.alpha * (p.life / p.maxLife);
      if (p.kind === P_FIRE) {
        const size = p.size + (p.size2 - p.size) * t;
        const spr = softSprite(p.r, p.g, p.b);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(spr, sx - size, sy - size, size * 2, size * 2);
      } else if (p.kind === P_SPARK || p.kind === P_TWINKLE) {
        const len = Math.hypot(p.vx, p.vy) * 0.03 + 2;
        ctx.globalAlpha = Math.min(1, a);
        ctx.strokeStyle = rgba(p.r, p.g, p.b, 1);
        ctx.lineWidth = p.size * (p.life / p.maxLife) + 0.4;
        ctx.beginPath();
        const nx = p.vx / (Math.hypot(p.vx, p.vy) || 1);
        const ny = p.vy / (Math.hypot(p.vx, p.vy) || 1);
        ctx.moveTo(sx - nx * len, sy - ny * len);
        ctx.lineTo(sx + nx * len * 0.4, sy + ny * len * 0.4);
        ctx.stroke();
      } else if (p.kind === P_RING) {
        const size = p.size + (p.size2 - p.size) * t;
        ctx.globalAlpha = Math.min(1, a * 0.9);
        ctx.strokeStyle = rgba(p.r, p.g, p.b, 1);
        ctx.lineWidth = Math.max(1, 4 * (p.life / p.maxLife));
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const p of this.particles) p.active = false;
    this.cursor = 0;
  }

  activeCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.active) n++;
    return n;
  }
}
