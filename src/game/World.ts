/**
 * World — a large toroidal (wrapping) coordinate space.
 *
 * The world is much larger than the screen and wraps on both axes, so the
 * player never hits a visible boundary (master plan §8, §12).
 *
 * ALL world-space directions and distances must go through the wrap-aware
 * helpers here; raw subtraction breaks near the seams.
 */

import { clamp, mulberry32, randRange, wrapDelta, wrapPos } from './util/math';

export const WORLD_W = 5200;
export const WORLD_H = 3600;

export class World {
  readonly w = WORLD_W;
  readonly h = WORLD_H;

  /** Seconds elapsed in the current run (drives difficulty). */
  runTime = 0;
  /** Global animation clock (never resets; used for shaders-like wobble). */
  clock = 0;

  /** Seeded RNG for reproducible-environment, varied gameplay. */
  rnd: () => number = mulberry32((Math.random() * 0xffffffff) >>> 0);

  wrapX(x: number): number {
    return wrapPos(x, WORLD_W);
  }

  wrapY(y: number): number {
    return wrapPos(y, WORLD_H);
  }

  /** Shortest signed x-distance from a to b. */
  deltaX(a: number, b: number): number {
    return wrapDelta(b - a, WORLD_W);
  }

  /** Shortest signed y-distance from a to b. */
  deltaY(a: number, b: number): number {
    return wrapDelta(b - a, WORLD_H);
  }

  /** Shortest wrapped distance between two points. */
  distance(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot(this.deltaX(ax, bx), this.deltaY(ay, by));
  }

  /** A random point in world space. */
  randomPoint(): { x: number; y: number } {
    return { x: this.rnd() * WORLD_W, y: this.rnd() * WORLD_H };
  }

  /**
   * A random point at `minR..maxR` (wrapped) distance from a focus point.
   * Used for missile/star/power-up placement relative to the player.
   */
  randomPointAround(
    fx: number,
    fy: number,
    minR: number,
    maxR: number,
    angleBias?: { angle: number; spread: number; weight: number },
  ): { x: number; y: number } {
    let angle: number;
    if (angleBias && this.rnd() < angleBias.weight) {
      angle = angleBias.angle + randRange(this.rnd, -angleBias.spread, angleBias.spread);
    } else {
      angle = this.rnd() * Math.PI * 2;
    }
    const r = randRange(this.rnd, minR, maxR);
    return {
      x: this.wrapX(fx + Math.cos(angle) * r),
      y: this.wrapY(fy + Math.sin(angle) * r),
    };
  }

  reseed(seed: number): void {
    this.rnd = mulberry32(seed >>> 0);
  }
}

/**
 * Difficulty curve — pure function of survival time and mode modifiers.
 * Exported separately so it can be unit tested (master plan §19).
 */
export interface DifficultyParams {
  /** Seconds between spawn attempts. */
  spawnInterval: number;
  /** Multiplier on missile base speed. */
  speedMul: number;
  /** Multiplier on missile base turn rate. */
  turnMul: number;
  /** Maximum simultaneously active missiles. */
  maxActive: number;
  /** Missile types available at this time. */
  unlockedTypes: number;
}

export interface ModeModifiers {
  spawnMul: number;
  speedMul: number;
  rampMul: number;
  scoreMul: number;
  maxMissilesMul: number;
}

export const NORMAL_MODE: ModeModifiers = {
  spawnMul: 1,
  speedMul: 1,
  rampMul: 1,
  scoreMul: 1,
  maxMissilesMul: 1,
};

/**
 * Continuous difficulty ramp — no sudden jumps.
 * @param t survival time in seconds (already scaled by mode rampMul)
 */
export function difficultyAt(t: number, mode: ModeModifiers = NORMAL_MODE): DifficultyParams {
  const tt = Math.max(0, t);
  const spawnInterval = clamp((2.5 - tt * 0.0135) * mode.spawnMul, 0.42, 2.5);
  const speedMul = (1 + Math.min(tt / 260, 0.62)) * mode.speedMul;
  const turnMul = 1 + Math.min(tt / 320, 0.48);
  const maxActive = Math.min(
    Math.round((5 + tt / 11) * mode.maxMissilesMul),
    Math.round(44 * mode.maxMissilesMul),
  );
  // Types unlock progressively: all 8 types are on the field by ~130s.
  const unlockTimes = [0, 15, 30, 45, 65, 85, 105, 130];
  let unlockedTypes = 0;
  for (const u of unlockTimes) if (tt >= u) unlockedTypes++;
  return { spawnInterval, speedMul, turnMul, maxActive, unlockedTypes };
}
