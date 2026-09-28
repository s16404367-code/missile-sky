/**
 * Small, pure math helpers shared across the game.
 * Everything here is allocation-free and side-effect free so it can be unit tested.
 */

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Framerate-independent exponential smoothing.
 * `lambda` is the response rate (higher = snappier). Same result at 30 and 60 FPS.
 */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

/** Wrap a value into [0, size). */
export function wrapPos(v: number, size: number): number {
  return ((v % size) + size) % size;
}

/**
 * Shortest signed difference between two wrapped coordinates.
 * Result lies in [-size/2, size/2). This is the core of the toroidal world:
 * all distances/directions must be computed through this, never with raw subtraction.
 */
export function wrapDelta(d: number, size: number): number {
  const half = size * 0.5;
  return wrapPos(d + half, size) - half;
}

/** Normalize an angle to [-PI, PI). */
export function normalizeAngle(a: number): number {
  return wrapPos(a + Math.PI, TAU) - Math.PI;
}

/** Shortest angular difference from `a` to `b` (i.e. how much to add to a to face b). */
export function angleDiff(a: number, b: number): number {
  return wrapDelta(b - a, TAU);
}

/**
 * Rotate `current` toward `target` by at most `maxStep` radians.
 * This limited turning is what makes missiles overshoot realistically.
 */
export function rotateToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(d) * maxStep);
}

/** Move `v` toward `target` by at most `step` (linear version of rotateToward). */
export function approach(v: number, target: number, step: number): number {
  const d = target - v;
  if (Math.abs(d) <= step) return target;
  return v + Math.sign(d) * step;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** Deterministic, fast PRNG (mulberry32). Returns a function producing [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rnd: () => number, min: number, max: number): number {
  return min + rnd() * (max - min);
}

export function randInt(rnd: () => number, min: number, maxInclusive: number): number {
  return Math.floor(randRange(rnd, min, maxInclusive + 1));
}

export function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

/** Weighted random pick. `weights` must align with `items`. */
export function pickWeighted<T>(rnd: () => number, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** True with probability p. */
export function chance(rnd: () => number, p: number): boolean {
  return rnd() < p;
}

/** Format seconds as M:SS. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
