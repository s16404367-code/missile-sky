/**
 * FloatingTextSystem — world-anchored score popups
 * ("MISSILE COLLISION +100", "CHAIN ×3 +300", "SHIELD +1", ...).
 * Pooled; rises and fades.
 */

import type { Camera } from './Camera';

export interface FloatText {
  active: boolean;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  vy: number;
}

const MAX_TEXTS = 22;

export class FloatingTextSystem {
  readonly texts: FloatText[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < MAX_TEXTS; i++) {
      this.texts.push({ active: false, x: 0, y: 0, text: '', color: '#fff', size: 16, life: 0, maxLife: 1, vy: -34 });
    }
  }

  spawn(x: number, y: number, text: string, color = '#ffffff', size = 16): void {
    let t = this.texts[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_TEXTS;
    if (t.active) {
      // Steal the oldest active text when the pool is saturated.
      let oldest = t;
      for (const c of this.texts) {
        if (c.active && c.life / c.maxLife < oldest.life / oldest.maxLife) oldest = c;
      }
      t = oldest;
    }
    t.active = true;
    t.x = x;
    t.y = y;
    t.text = text;
    t.color = color;
    t.size = size;
    t.maxLife = 1.15;
    t.life = 1.15;
    t.vy = -34;
  }

  update(dt: number): void {
    for (const t of this.texts) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= Math.exp(-1.6 * dt);
    }
  }

  render(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      if (!t.active) continue;
      if (!cam.isVisible(t.x, t.y, 60)) continue;
      const sx = cam.worldToScreenX(t.x);
      const sy = cam.worldToScreenY(t.y);
      const k = t.life / t.maxLife;
      const pop = k > 0.85 ? 1 + (k - 0.85) * 2.2 : 1; // small pop-in
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.font = `700 ${Math.round(t.size * pop)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8,14,30,0.8)';
      ctx.strokeText(t.text, sx, sy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx, sy);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const t of this.texts) t.active = false;
  }
}
