/**
 * Missile — entity + steering AI + per-type behaviour + rendering
 * (master plan §14, §15, §18).
 *
 * Steering is true velocity-based interception:
 *   1. Predict the aircraft's future position (lead pursuit).
 *   2. Compute the desired heading toward that intercept point.
 *   3. Rotate the CURRENT heading toward desired, limited by turn rate.
 * Because turning is limited, fast missiles genuinely overshoot, fly past,
 * loop around and reacquire — the core of the gameplay.
 */

import type { World } from './World';
import type { MissileTypeId } from './types';
import { MISSILE_TYPES } from '../data/missiles';
import { clamp, rotateToward } from './util/math';

export interface Missile {
  active: boolean;
  id: number;
  type: MissileTypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  /** Base type speed/turn; survival-time multipliers are applied per frame. */
  speed: number;
  turn: number;
  radius: number;
  blast: number;
  life: number;
  maxLife: number;
  /** Launch acceleration timer (also the spawn telegraph window). */
  launchT: number;
  /** Type-specific state. */
  zigT: number;
  curveSide: number;
  overFlag: boolean;
  overT: number;
  smokeT: number;
  /** Attract-mode missiles never hit the player; they fizzle near it. */
  noHit: boolean;
  isFragment: boolean;
}

export function createMissilePool(size: number): Missile[] {
  const pool: Missile[] = [];
  for (let i = 0; i < size; i++) {
    pool.push({
      active: false, id: 0, type: 'standard',
      x: 0, y: 0, vx: 0, vy: 0, heading: 0,
      speed: 250, turn: 2, radius: 7, blast: 46,
      life: 0, maxLife: 1, launchT: 0,
      zigT: 0, curveSide: 1, overFlag: false, overT: 0, smokeT: 0,
      noHit: false, isFragment: false,
    });
  }
  return pool;
}

export function initMissile(
  m: Missile,
  id: number,
  type: MissileTypeId,
  x: number,
  y: number,
  heading: number,
  speedMul: number,
  turnMul: number,
  opts?: { noHit?: boolean; isFragment?: boolean; life?: number },
): void {
  const def = MISSILE_TYPES[type];
  m.active = true;
  m.id = id;
  m.type = type;
  m.x = x;
  m.y = y;
  m.heading = heading;
  // Store base values; the manager applies the live survival-time multipliers
  // every frame so existing missiles grow more dangerous as well as new ones.
  m.speed = def.speed;
  m.turn = def.turn;
  m.radius = def.radius;
  m.blast = def.blast;
  m.maxLife = opts?.life ?? def.life;
  m.life = m.maxLife;
  m.launchT = 0.45;
  m.zigT = Math.random() * Math.PI * 2;
  m.curveSide = Math.random() < 0.5 ? -1 : 1;
  m.overFlag = false;
  m.overT = 0;
  m.smokeT = 0;
  m.noHit = opts?.noHit ?? false;
  m.isFragment = opts?.isFragment ?? false;
  m.vx = Math.cos(heading) * m.speed * 0.5;
  m.vy = Math.sin(heading) * m.speed * 0.5;
}

export interface MissileTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Advance one missile. Pure simulation — no rendering, no allocation.
 */
export function updateMissile(
  m: Missile,
  dt: number,
  target: MissileTarget,
  world: World,
  speedMul: number,
  turnMul: number,
): void {
  m.life -= dt;
  m.launchT = Math.max(0, m.launchT - dt);

  const dx = world.deltaX(m.x, target.x);
  const dy = world.deltaY(m.y, target.y);
  const d = Math.hypot(dx, dy) || 0.0001;

  // ---- lead pursuit: aim at where the aircraft WILL be ---------------------
  const leadT = clamp(d / Math.max(60, m.speed), 0, 1.35) * (m.isFragment ? 0.55 : 0.9);
  const aimX = target.x + target.vx * leadT;
  const aimY = target.y + target.vy * leadT;
  let desired = Math.atan2(world.deltaY(m.y, aimY), world.deltaX(m.x, aimX));

  let turn = m.turn * turnMul;
  let speed = m.speed * speedMul;

  // ---- per-type behaviour ---------------------------------------------------
  switch (m.type) {
    case 'zigzag':
      m.zigT += dt;
      desired += Math.sin(m.zigT * 7) * 0.62;
      break;
    case 'curving': {
      // Bend the approach: offset desired heading more strongly at range.
      const bend = clamp(d / 520, 0.12, 1) * 0.8;
      desired += m.curveSide * bend;
      // Occasionally flip the arc so it is not perfectly predictable.
      if (m.zigT > 0) {
        m.zigT -= dt;
      } else if (d > 700 && Math.random() < dt * 0.25) {
        m.curveSide *= -1;
        m.zigT = 2.5;
      }
      break;
    }
    case 'boomerang':
      // Deliberate overshoot: after passing the target it loops back faster.
      if (m.overFlag) {
        turn *= 1.95;
        speed *= 1.18;
        m.overT += dt;
        if (d < 150 && m.overT > 0.9) m.overFlag = false;
      }
      break;
    case 'swarm':
      // Slightly nervous homing: small heading jitter keeps packs loose.
      desired += Math.sin(m.zigT * 9) * 0.16;
      m.zigT += dt;
      break;
    default:
      break;
  }

  // ---- limited turn => real overshoot ---------------------------------------
  m.heading = rotateToward(m.heading, desired, turn * dt);

  // Launch ramp: accelerate out of the spawn flash.
  const launchK = m.launchT > 0 ? 0.55 + 0.45 * (1 - m.launchT / 0.45) : 1;
  const sp = speed * launchK;
  m.vx = Math.cos(m.heading) * sp;
  m.vy = Math.sin(m.heading) * sp;

  m.x = world.wrapX(m.x + m.vx * dt);
  m.y = world.wrapY(m.y + m.vy * dt);

  // ---- overshoot detection (any type can overshoot; boomerang exploits it) --
  // "Close and receding" means we just flew past the aircraft.
  // `dx,dy` point from missile to target; a negative velocity dot product
  // means the missile is moving away from the target after passing it.
  const receding = m.vx * dx + m.vy * dy < 0;
  if (!m.overFlag && d < 170 && receding) {
    m.overFlag = true;
    m.overT = 0;
  } else if (m.overFlag && m.type !== 'boomerang' && (d > 800 || (d < 150 && !receding && m.overT > 0.8))) {
    m.overFlag = false;
  }
  if (m.overFlag && m.type !== 'boomerang') m.overT += dt;

  // Attract-mode missiles fizzle right before "hitting" the demo aircraft.
  if (m.noHit && d < 120 && m.life > 0.28) m.life = 0.28;
}

/* ------------------------------------------------------------------ drawing */

function flame(ctx: CanvasRenderingContext2D, tailX: number, len: number, w: number, color: string, t: number): void {
  const flick = 0.72 + 0.28 * Math.sin(t * 53);
  const l = len * flick;
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(tailX, 0, tailX - l, 0);
  g.addColorStop(0, 'rgba(255,245,215,0.95)');
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(255,90,30,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(tailX, -w);
  ctx.lineTo(tailX - l, 0);
  ctx.lineTo(tailX, w);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Draw a missile in local space (nose toward +x). Caller translates to the
 * screen position and rotates by `heading`.
 */
export function drawMissileBody(ctx: CanvasRenderingContext2D, m: Missile, time: number): void {
  const def = MISSILE_TYPES[m.type];
  const c = def.colors;
  const launching = m.launchT > 0;

  switch (m.type) {
    case 'fast': {
      flame(ctx, -9, 13, 1.8, 'rgba(255,200,80,0.8)', time + m.id);
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.moveTo(13, 0); ctx.lineTo(4, 1.8); ctx.lineTo(-9, 1.6); ctx.lineTo(-9, -1.6); ctx.lineTo(4, -1.8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(6, 1.4); ctx.lineTo(6, -1.4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, 1.5); ctx.lineTo(-10.5, 4.6); ctx.lineTo(-9, 1.4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, -1.5); ctx.lineTo(-10.5, -4.6); ctx.lineTo(-9, -1.4); ctx.closePath(); ctx.fill();
      break;
    }
    case 'heavy': {
      flame(ctx, -12, 12, 3.2, 'rgba(255,140,66,0.85)', time + m.id);
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.moveTo(13, 0); ctx.quadraticCurveTo(11, 5, 4, 5.4); ctx.lineTo(-12, 4.8);
      ctx.lineTo(-12, -4.8); ctx.lineTo(4, -5.4); ctx.quadraticCurveTo(11, -5, 13, 0);
      ctx.closePath(); ctx.fill();
      // hazard stripes
      ctx.fillStyle = c.accent;
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(-8 + i * 6, -5, 2.4, 10);
      }
      ctx.beginPath(); ctx.moveTo(-8, 4.8); ctx.lineTo(-14, 8.6); ctx.lineTo(-12, 4.4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8, -4.8); ctx.lineTo(-14, -8.6); ctx.lineTo(-12, -4.4); ctx.closePath(); ctx.fill();
      break;
    }
    case 'curving': {
      flame(ctx, -9, 10, 2, 'rgba(126,242,228,0.8)', time + m.id);
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.quadraticCurveTo(6, 3, -8, 2.2); ctx.lineTo(-8, -2.2); ctx.quadraticCurveTo(6, -3, 12, 0);
      ctx.closePath(); ctx.fill();
      // swept curved fins
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-2, 2); ctx.quadraticCurveTo(-8, 5, -12, 4.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -2); ctx.quadraticCurveTo(-8, -5, -12, -4.2); ctx.stroke();
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.arc(9, 0, 1.7, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'zigzag': {
      flame(ctx, -9, 10, 2, 'rgba(199,244,100,0.8)', time + m.id);
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(3, 2.6); ctx.lineTo(-9, 2.2); ctx.lineTo(-9, -2.2); ctx.lineTo(3, -2.6);
      ctx.closePath(); ctx.fill();
      // lightning mark
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(6, -1.6); ctx.lineTo(1, 0.4); ctx.lineTo(4, 0.4); ctx.lineTo(-1, 2); ctx.stroke();
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.moveTo(-6, 2.2); ctx.lineTo(-11, 5.4); ctx.lineTo(-9.4, 1.8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, -2.2); ctx.lineTo(-11, -5.4); ctx.lineTo(-9.4, -1.8); ctx.closePath(); ctx.fill();
      break;
    }
    case 'boomerang': {
      flame(ctx, -7, 9, 1.8, 'rgba(255,143,171,0.85)', time + m.id);
      // crescent wings
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.quadraticCurveTo(-2, 7, -11, 8.4);
      ctx.quadraticCurveTo(-5, 3.4, -6, 0);
      ctx.quadraticCurveTo(-5, -3.4, -11, -8.4);
      ctx.quadraticCurveTo(-2, -7, 8, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.body;
      ctx.beginPath(); ctx.ellipse(1, 0, 6, 2.1, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'splitter': {
      flame(ctx, -9, 10, 2.1, 'rgba(199,125,255,0.8)', time + m.id);
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(4, 3); ctx.lineTo(-9, 2.6); ctx.lineTo(-9, -2.6); ctx.lineTo(4, -3);
      ctx.closePath(); ctx.fill();
      // split seam notches
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(-8, 0);
      ctx.moveTo(2, 0); ctx.lineTo(0, 2.4);
      ctx.moveTo(2, 0); ctx.lineTo(0, -2.4);
      ctx.stroke();
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.moveTo(-5, 2.6); ctx.lineTo(-10, 5.8); ctx.lineTo(-8.6, 2.2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-5, -2.6); ctx.lineTo(-10, -5.8); ctx.lineTo(-8.6, -2.2); ctx.closePath(); ctx.fill();
      break;
    }
    case 'swarm':
    case 'fragment': {
      flame(ctx, -5.5, m.isFragment ? 7 : 8, 1.4, 'rgba(255,179,120,0.8)', time + m.id);
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(1, 2); ctx.lineTo(-6, 1.6); ctx.lineTo(-6, -1.6); ctx.lineTo(1, -2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.moveTo(-4, 1.6); ctx.lineTo(-7.6, 4); ctx.lineTo(-6, 1.3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, -1.6); ctx.lineTo(-7.6, -4); ctx.lineTo(-6, -1.3); ctx.closePath(); ctx.fill();
      break;
    }
    default: {
      // standard
      flame(ctx, -9, 10, 2.1, 'rgba(255,179,71,0.85)', time + m.id);
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.quadraticCurveTo(9, 3, 3, 3.1); ctx.lineTo(-9, 2.6);
      ctx.lineTo(-9, -2.6); ctx.lineTo(3, -3.1); ctx.quadraticCurveTo(9, -3, 12, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.quadraticCurveTo(9.6, 2, 7, 2.4); ctx.lineTo(7, -2.4); ctx.quadraticCurveTo(9.6, -2, 12, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-5, 2.8); ctx.lineTo(-10.6, 6.2); ctx.lineTo(-9, 2.4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-5, -2.8); ctx.lineTo(-10.6, -6.2); ctx.lineTo(-9, -2.4); ctx.closePath(); ctx.fill();
      break;
    }
  }

  // Launch flash telegraph — a bright marker so spawns are fair and readable.
  if (launching) {
    const k = m.launchT / 0.45;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = k;
    const g = ctx.createRadialGradient(-8, 0, 0, -8, 0, 16 + 10 * k);
    g.addColorStop(0, 'rgba(255,240,200,0.9)');
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(-8, 0, 16 + 10 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
