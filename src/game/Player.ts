/**
 * Player — the aircraft (master plan §9, §10, §21).
 *
 * Analog 360° movement with acceleration, drag, momentum and limited turn
 * rate. Boost bursts and timed shield bubbles are managed here; hull damage
 * (armor) is resolved by the Game via applyHit().
 *
 * Rendering uses ORIGINAL vector art from data/aircraft.ts, mirrored across
 * the fuselage for symmetry (cached Path2D — zero per-frame allocation).
 */

import type { Camera } from './Camera';
import type { EventBus } from './Events';
import type { World } from './World';
import type { AircraftDef } from '../data/aircraft';
import type { EffectiveStats, GameEventMap } from './types';
import type { ParticleSystem } from './ParticleSystem';
import { clamp, rotateToward } from './util/math';

export interface PlayerInput {
  mx: number;
  my: number;
  boostEdge: boolean;
  shieldEdge: boolean;
}

export const PLAYER_RADIUS = 11;
export const SHIELD_RADIUS = 29;

const pathCache = new Map<string, { outline: Path2D; stripes: Path2D[] }>();

function buildPaths(def: AircraftDef): { outline: Path2D; stripes: Path2D[] } {
  let cached = pathCache.get(def.id);
  if (cached) return cached;
  const outline = new Path2D();
  def.outline.forEach(([x, y], i) => (i === 0 ? outline.moveTo(x, y) : outline.lineTo(x, y)));
  outline.closePath();
  const stripes = def.stripes.map((pts) => {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
    p.closePath();
    return p;
  });
  cached = { outline, stripes };
  pathCache.set(def.id, cached);
  return cached;
}

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  heading = -Math.PI / 2;
  alive = true;

  /** 0..1 analog input magnitude (drives the engine flame). */
  throttle = 0;

  hp = 1;
  maxHp = 1;
  shieldCharges = 1;
  shieldMax = 1;
  shieldT = 0;
  boostT = 0;
  boostCdT = 0;
  invulnT = 0;

  stats: EffectiveStats = {
    maxSpeed: 340, accel: 900, turn: 6.6, shieldCharges: 1, shieldDuration: 2.4,
    boostDuration: 1.1, boostCooldown: 4, hp: 1, magnetRadius: 46,
  };

  private trailT = 0;

  reset(x: number, y: number, stats: EffectiveStats): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.heading = -Math.PI / 2;
    this.alive = true;
    this.throttle = 0;
    this.stats = stats;
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.shieldMax = stats.shieldCharges;
    this.shieldCharges = stats.shieldCharges;
    this.shieldT = 0;
    this.boostT = 0;
    this.boostCdT = 0;
    this.invulnT = 1.2; // brief spawn protection
    this.trailT = 0;
  }

  get boosting(): boolean {
    return this.boostT > 0;
  }

  get shieldActive(): boolean {
    return this.shieldT > 0;
  }

  speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  update(
    dt: number,
    input: PlayerInput,
    world: World,
    events: EventBus<GameEventMap>,
    particles: ParticleSystem,
    def: AircraftDef,
    particleFactor: number,
  ): void {
    if (!this.alive) return;
    const s = this.stats;

    // ---- analog movement -------------------------------------------------
    const il = Math.hypot(input.mx, input.my);
    this.throttle = clamp(il, 0, 1);
    if (il > 0.09) {
      const nx = input.mx / il;
      const ny = input.my / il;
      // Slight super-linear response: small tilts = gentle, full tilt = max.
      const strength = Math.pow(clamp(il, 0, 1), 0.85);
      const accel = s.accel * strength * (this.boosting ? 2.1 : 1);
      this.vx += nx * accel * dt;
      this.vy += ny * accel * dt;
    } else {
      // Momentum-preserving drag when the stick is released.
      const drag = Math.exp(-2.4 * dt);
      this.vx *= drag;
      this.vy *= drag;
    }

    // Speed cap (soft): scale back toward max instead of hard clamping.
    const maxSpd = s.maxSpeed * (this.boosting ? 1.72 : 1);
    const spd = this.speed();
    if (spd > maxSpd) {
      const k = maxSpd / spd;
      const blend = 1 - Math.exp(-9 * dt); // ease into the cap
      const kk = 1 - (1 - k) * blend;
      this.vx *= kk;
      this.vy *= kk;
    }

    // ---- orientation: rotate toward travel direction ----------------------
    if (spd > 26) {
      const target = Math.atan2(this.vy, this.vx);
      this.heading = rotateToward(this.heading, target, s.turn * dt);
    }

    // ---- integrate + wrap -------------------------------------------------
    this.x = world.wrapX(this.x + this.vx * dt);
    this.y = world.wrapY(this.y + this.vy * dt);

    // ---- abilities --------------------------------------------------------
    this.boostT = Math.max(0, this.boostT - dt);
    this.boostCdT = Math.max(0, this.boostCdT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);

    if (input.boostEdge && this.boostCdT <= 0 && this.boostT <= 0) {
      this.boostT = s.boostDuration;
      this.boostCdT = s.boostCooldown + s.boostDuration;
      events.emit('BOOST_USED', {});
      if (particleFactor > 0.2) {
        for (let i = 0; i < 10; i++) {
          particles.playerTrail(
            this.x - Math.cos(this.heading) * 14,
            this.y - Math.sin(this.heading) * 14,
            -this.vx * 0.3, -this.vy * 0.3, true, 0, 0, 0,
          );
        }
      }
    }
    if (input.shieldEdge && this.shieldT <= 0 && this.shieldCharges > 0) {
      this.shieldT = s.shieldDuration;
      this.shieldCharges--;
      events.emit('SHIELD_USED', { chargesLeft: this.shieldCharges });
      particles.shieldPop(this.x, this.y, false);
    }

    // ---- engine trail ------------------------------------------------------
    this.trailT -= dt;
    if (this.trailT <= 0 && spd > 55) {
      this.trailT = this.boosting ? 0.016 : 0.034 / Math.max(0.35, particleFactor);
      const back = 15;
      particles.playerTrail(
        this.x - Math.cos(this.heading) * back,
        this.y - Math.sin(this.heading) * back,
        -this.vx * 0.25,
        -this.vy * 0.25,
        this.boosting,
        150, 190, 240,
      );
    }
  }

  /**
   * Resolve an incoming missile hit.
   * Returns: 'invuln' (ignored), 'shield' (blocked), 'survive' (armor hp left)
   * or 'fatal'.
   */
  applyHit(): 'invuln' | 'shield' | 'survive' | 'fatal' {
    if (this.invulnT > 0) return 'invuln';
    if (this.shieldT > 0) return 'shield';
    this.hp--;
    if (this.hp > 0) {
      this.invulnT = 1.5;
      return 'survive';
    }
    this.alive = false;
    return 'fatal';
  }

  /** Restore a shield charge (power-up). */
  restoreShield(): boolean {
    if (this.shieldCharges >= this.shieldMax) return false;
    this.shieldCharges++;
    return true;
  }

  /** Reset boost cooldown (power-up). */
  restoreBoost(): void {
    this.boostCdT = 0;
  }

  render(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    def: AircraftDef,
    time: number,
  ): void {
    if (!this.alive) return;
    // Invulnerability blink (also communicates "protected" without color only).
    if (this.invulnT > 0 && this.shieldT <= 0 && Math.floor(time * 12) % 2 === 0) return;

    const sx = cam.worldToScreenX(this.x);
    const sy = cam.worldToScreenY(this.y);
    const paths = buildPaths(def);
    const c = def.colors;

    ctx.save();
    ctx.translate(sx, sy);

    // ---- shield bubble (screen-aligned) -----------------------------------
    if (this.shieldT > 0) {
      const pulse = 1 + Math.sin(time * 10) * 0.05;
      const R = SHIELD_RADIUS * pulse;
      const fade = this.shieldT < 0.6 ? 0.35 + 0.65 * Math.abs(Math.sin(this.shieldT * 18)) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R);
      g.addColorStop(0, 'rgba(90,190,255,0.05)');
      g.addColorStop(0.82, 'rgba(120,210,255,0.16)');
      g.addColorStop(1, 'rgba(160,230,255,0.4)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(170,230,255,0.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
      // hex ticks — shape cue, not just color
      ctx.strokeStyle = 'rgba(200,240,255,0.4)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + time * 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.88, a, a + 0.28);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.rotate(this.heading);

    // ---- engine flame ------------------------------------------------------
    const spd = this.speed();
    const flameBase = 5 + this.throttle * 8 + (this.boosting ? 15 : 0) + Math.min(6, spd * 0.02);
    const flick = 0.75 + 0.25 * Math.sin(time * 47 + def.id.length);
    const fl = flameBase * flick;
    ctx.globalCompositeOperation = 'lighter';
    const fg = ctx.createLinearGradient(-15, 0, -15 - fl, 0);
    fg.addColorStop(0, this.boosting ? 'rgba(255,240,190,0.95)' : 'rgba(190,220,255,0.8)');
    fg.addColorStop(0.4, this.boosting ? 'rgba(255,160,60,0.7)' : 'rgba(140,180,255,0.4)');
    fg.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-14, -2.6);
    ctx.lineTo(-15 - fl, 0);
    ctx.lineTo(-14, 2.6);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // ---- airframe (mirrored halves) ---------------------------------------
    ctx.fillStyle = c.body;
    ctx.strokeStyle = 'rgba(10,18,38,0.55)';
    ctx.lineWidth = 1;
    ctx.fill(paths.outline);
    ctx.stroke(paths.outline);
    ctx.save();
    ctx.scale(1, -1);
    ctx.fill(paths.outline);
    ctx.stroke(paths.outline);
    ctx.restore();

    ctx.fillStyle = c.accent;
    for (const st of paths.stripes) {
      ctx.fill(st);
      ctx.save();
      ctx.scale(1, -1);
      ctx.fill(st);
      ctx.restore();
    }

    if (def.deco) def.deco(ctx, time, c);

    // ---- canopy -------------------------------------------------------------
    const [gx, gy, grx, gry] = def.canopy;
    ctx.fillStyle = c.glass;
    ctx.beginPath();
    ctx.ellipse(gx, gy, grx, gry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(gx + grx * 0.3, gy - gry * 0.25, grx * 0.4, gry * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
