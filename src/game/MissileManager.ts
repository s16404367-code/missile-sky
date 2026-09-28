/**
 * MissileManager — pooling, spawning, difficulty-driven waves, smoke trails
 * and splitter fragmentation (master plan §13, §19, §20).
 *
 * Spawning is semi-random and FAIR: missiles always enter outside the visible
 * screen at a guaranteed minimum distance from the aircraft, from varied
 * bearings (with a mercy bias toward spawning behind the player early on).
 */

import type { World } from './World';
import type { DifficultyParams } from './World';
import type { Missile, MissileTarget } from './Missile';
import { createMissilePool, initMissile, updateMissile } from './Missile';
import type { MissileTypeId } from './types';
import { MISSILE_TYPES, SPAWNABLE_TYPES } from '../data/missiles';
import type { ParticleSystem } from './ParticleSystem';
import { pickWeighted, randRange } from './util/math';

const POOL_SIZE = 72;

export class MissileManager {
  readonly missiles: Missile[] = createMissilePool(POOL_SIZE);
  /** Optional event hook installed by Game; keeping manager UI-agnostic. */
  onSpawn: ((missile: Missile) => void) | null = null;
  private nextId = 1;
  private spawnTimer = 1.4;
  /** Bearing of the most recent spawn (kept for star risk-placement). */
  lastSpawnAngle = 0;

  activeCount(): number {
    let n = 0;
    for (const m of this.missiles) if (m.active) n++;
    return n;
  }

  clear(): void {
    for (const m of this.missiles) m.active = false;
    this.spawnTimer = 1.4;
  }

  private obtain(): Missile | null {
    for (const m of this.missiles) if (!m.active) return m;
    return null;
  }

  spawn(
    type: MissileTypeId,
    x: number,
    y: number,
    heading: number,
    params: DifficultyParams,
    opts?: { noHit?: boolean; isFragment?: boolean; life?: number },
  ): Missile | null {
    const m = this.obtain();
    if (!m) return null;
    initMissile(m, this.nextId++, type, x, y, heading, params.speedMul, params.turnMul, opts);
    this.onSpawn?.(m);
    return m;
  }

  /**
   * Deactivate a missile. Splitters fragment into three shards when destroyed
   * by any means (collision, chain, shield block).
   */
  destroyMissile(m: Missile, params: DifficultyParams): void {
    m.active = false;
    if (m.type === 'splitter' && !m.isFragment) {
      const base = m.heading + Math.PI; // shards scatter backwards-ish
      for (let i = 0; i < 3; i++) {
        const a = base + (i - 1) * 0.85 + randRange(Math.random, -0.2, 0.2);
        const frag = this.obtain();
        if (!frag) break;
        initMissile(frag, this.nextId++, 'fragment', m.x, m.y, a, params.speedMul, params.turnMul, {
          isFragment: true,
          life: MISSILE_TYPES.fragment.life,
          noHit: m.noHit,
        });
        this.onSpawn?.(frag);
      }
    }
  }

  /**
   * Spawn the next wave around the player.
   * `viewRadius` = half diagonal of the screen; spawns land beyond it.
   */
  spawnWave(
    world: World,
    player: MissileTarget,
    params: DifficultyParams,
    viewRadius: number,
    mercyBias: number,
  ): void {
    const rnd = world.rnd;

    // Choose a type among those unlocked by survival time.
    const types: MissileTypeId[] = [];
    const weights: number[] = [];
    for (const t of SPAWNABLE_TYPES) {
      if (world.runTime >= MISSILE_TYPES[t].unlockTime) {
        types.push(t);
        weights.push(MISSILE_TYPES[t].weight);
      }
    }
    if (types.length === 0) return;
    const type = pickWeighted(rnd, types, weights);

    // Bearing: mostly uniform, with a mercy bias away from the flight path.
    let angle: number;
    const pSpeed = Math.hypot(player.vx, player.vy);
    if (pSpeed > 60 && rnd() < mercyBias) {
      // Spawn behind the player's current heading.
      angle = Math.atan2(player.vy, player.vx) + Math.PI + randRange(rnd, -0.9, 0.9);
    } else {
      angle = rnd() * Math.PI * 2;
    }
    this.lastSpawnAngle = angle;

    const minR = Math.max(430, viewRadius + 170);
    const maxR = viewRadius + randRange(rnd, 260, 560);
    const r = randRange(rnd, minR, Math.max(minR + 60, maxR));
    const x = world.wrapX(player.x + Math.cos(angle) * r);
    const y = world.wrapY(player.y + Math.sin(angle) * r);
    // Initial heading: roughly toward the aircraft, with jitter so entries
    // are not perfectly predictable.
    const toPlayer = Math.atan2(world.deltaY(y, player.y), world.deltaX(x, player.x));

    if (type === 'swarm') {
      const n = Math.min(4, Math.max(0, params.maxActive - this.activeCount()));
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 26;
        const sa = angle + (i - (n - 1) / 2) * 0.06;
        const sx = world.wrapX(player.x + Math.cos(sa) * r + Math.cos(sa + Math.PI / 2) * off);
        const sy = world.wrapY(player.y + Math.sin(sa) * r + Math.sin(sa + Math.PI / 2) * off);
        this.spawn('swarm', sx, sy, toPlayer + randRange(rnd, -0.3, 0.3), params);
      }
    } else {
      this.spawn(type, x, y, toPlayer + randRange(rnd, -0.42, 0.42), params);
      // Occasional double-launch as difficulty rises (simultaneous attacks).
      if (world.runTime > 40 && rnd() < Math.min(0.34, world.runTime / 420) && this.activeCount() < params.maxActive - 1) {
        const a2 = angle + randRange(rnd, 1.4, 2.6) * (rnd() < 0.5 ? 1 : -1);
        const r2 = randRange(rnd, minR, maxR);
        const x2 = world.wrapX(player.x + Math.cos(a2) * r2);
        const y2 = world.wrapY(player.y + Math.sin(a2) * r2);
        const tp2 = Math.atan2(world.deltaY(y2, player.y), world.deltaX(x2, player.x));
        this.spawn(type, x2, y2, tp2 + randRange(rnd, -0.35, 0.35), params);
      }
    }
  }

  /**
   * Advance every active missile: steering, wrapping, smoke trails, expiry.
   */
  update(
    dt: number,
    world: World,
    target: MissileTarget,
    params: DifficultyParams,
    particles: ParticleSystem,
    smokeInterval: number,
    attract: boolean,
  ): void {
    if (!attract) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        if (this.activeCount() < params.maxActive) {
          const viewRadius = 520; // refined by Game before calling via spawnViewRadius
          const mercy = Math.max(0.12, 0.5 - world.runTime / 300);
          this.spawnWave(world, target, params, this.spawnViewRadius || viewRadius, mercy);
        }
        // Jitter the interval ±25% so waves never feel metronomic.
        this.spawnTimer = params.spawnInterval * randRange(world.rnd, 0.75, 1.25);
      }
    }

    for (const m of this.missiles) {
      if (!m.active) continue;
      updateMissile(m, dt, target, world, params.speedMul, params.turnMul);

      // Smoke trail, density scaled by quality/perf budget.
      m.smokeT -= dt;
      if (m.smokeT <= 0) {
        m.smokeT = smokeInterval;
        particles.missileSmoke(
          m.x - Math.cos(m.heading) * 9,
          m.y - Math.sin(m.heading) * 9,
          m.vx, m.vy,
          MISSILE_TYPES[m.type].colors.smoke,
        );
      }

      // Expired: fizzle out with a small puff.
      if (m.life <= 0) {
        m.active = false;
        const c = MISSILE_TYPES[m.type].colors.smoke.split(',').map(Number);
        particles.puff(m.x, m.y, c[0], c[1], c[2], 4);
      }
    }
  }

  /** Set by Game each frame: half-diagonal of the current viewport. */
  spawnViewRadius = 520;
}
