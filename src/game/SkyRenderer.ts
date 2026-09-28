/**
 * SkyRenderer — sky gradient, sun, proximity warnings, edge glow, vignette,
 * hit flash (master plan §36, §37).
 *
 * Proximity warnings are directional chevrons around the aircraft PLUS a red
 * edge glow PLUS an audio cue — never color alone.
 */

import type { Camera } from './Camera';
import type { World } from './World';
import type { Player } from './Player';
import type { Missile } from './Missile';

export interface Warning {
  angle: number;
  severity: number; // 0..1
}

const WARN_RADIUS = 360;
const MAX_WARNINGS = 6;

export class SkyRenderer {
  private grad: CanvasGradient | null = null;
  private gradH = 0;
  readonly warnings: Warning[] = [];
  maxSeverity = 0;

  renderSky(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const { viewW: w, viewH: h } = cam;
    if (!this.grad || this.gradH !== h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2f79c9');
      g.addColorStop(0.45, '#5aa0dd');
      g.addColorStop(1, '#9fd0ef');
      this.grad = g;
      this.gradH = h;
    }
    ctx.fillStyle = this.grad;
    ctx.fillRect(0, 0, w, h);

    // Sun with a whisper of parallax — subtle depth cue, never gameplay noise.
    const sx = w * 0.78 - ((cam.travelX * 0.02) % 60);
    const sy = h * 0.14 - ((cam.travelY * 0.02) % 40);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.28);
    sg.addColorStop(0, 'rgba(255,250,225,0.55)');
    sg.addColorStop(0.25, 'rgba(255,240,190,0.16)');
    sg.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,252,240,0.85)';
    ctx.fill();
    ctx.restore();
  }

  /**
   * Scan missiles for close, closing threats. Fills this.warnings (screen
   * angles relative to the player) and this.maxSeverity.
   */
  computeWarnings(world: World, player: Player, missiles: Missile[], time: number): void {
    this.warnings.length = 0;
    this.maxSeverity = 0;
    if (!player.alive) return;
    for (const m of missiles) {
      if (!m.active || m.noHit) continue;
      const dx = world.deltaX(m.x, player.x);
      const dy = world.deltaY(m.y, player.y);
      const d = Math.hypot(dx, dy);
      if (d > WARN_RADIUS || d < 1) continue;
      // Closing speed: component of missile velocity toward the player.
      const closing = (m.vx * dx + m.vy * dy) / d;
      if (closing <= 20) continue;
      const severity = (1 - d / WARN_RADIUS) * Math.min(1, closing / 240);
      if (severity <= 0.06) continue;
      // Angle FROM player TO missile.
      const angle = Math.atan2(-dy, -dx);
      if (this.warnings.length < MAX_WARNINGS) {
        this.warnings.push({ angle, severity });
      } else {
        // Replace the weakest warning.
        let minI = 0;
        for (let i = 1; i < this.warnings.length; i++) {
          if (this.warnings[i].severity < this.warnings[minI].severity) minI = i;
        }
        if (severity > this.warnings[minI].severity) this.warnings[minI] = { angle, severity };
      }
      if (severity > this.maxSeverity) this.maxSeverity = severity;
    }
    // Sort strongest-first for stable rendering.
    this.warnings.sort((a, b) => b.severity - a.severity);
    void time;
  }

  /** Directional chevrons around the aircraft. */
  renderWarnings(ctx: CanvasRenderingContext2D, cam: Camera, player: Player, time: number): void {
    if (this.warnings.length === 0 || !player.alive) return;
    const px = cam.worldToScreenX(player.x);
    const py = cam.worldToScreenY(player.y);
    const pulse = 0.75 + 0.25 * Math.sin(time * 14);
    ctx.save();
    for (const w of this.warnings) {
      const R = 52 + 26 * (1 - w.severity);
      const x = px + Math.cos(w.angle) * R;
      const y = py + Math.sin(w.angle) * R;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(w.angle);
      ctx.globalAlpha = Math.min(1, w.severity * 1.3) * pulse;
      ctx.fillStyle = '#ff3b3b';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-5, 5.5);
      ctx.lineTo(-2.5, 0);
      ctx.lineTo(-5, -5.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Red screen-edge glow scaled by the strongest nearby threat. */
  renderEdgeGlow(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const s = this.maxSeverity;
    if (s < 0.12) return;
    const { viewW: w, viewH: h } = cam;
    const pulse = 0.7 + 0.3 * Math.sin(time * 11);
    const a = Math.min(0.55, s * 0.6) * pulse;
    ctx.save();
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(255,40,40,0)');
    g.addColorStop(1, `rgba(255,40,40,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  renderVignette(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const { viewW: w, viewH: h } = cam;
    ctx.save();
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.5, w / 2, h / 2, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(6,14,32,0)');
    g.addColorStop(1, 'rgba(6,14,32,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  renderHitFlash(ctx: CanvasRenderingContext2D, cam: Camera, alpha: number): void {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, alpha);
    ctx.fillStyle = '#fff2f2';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
