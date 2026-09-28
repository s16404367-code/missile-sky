/**
 * Camera — smooth follower converting world coordinates to screen coordinates.
 *
 * The world wraps, so world→screen always uses the shortest wrapped delta.
 * Also owns screen shake (master plan §8, §36).
 */

import { WORLD_H, WORLD_W } from './World';
import { clamp, damp, wrapDelta, wrapPos } from './util/math';

export class Camera {
  /** Camera center in world space. */
  x = 0;
  y = 0;

  /** Viewport size in CSS pixels. */
  viewW = 800;
  viewH = 600;
  /** Unwrapped camera travel for seamless background parallax across world seams. */
  travelX = 0;
  travelY = 0;

  /** Screen shake state. */
  shakeMag = 0;
  shakeX = 0;
  shakeY = 0;

  private followLambda = 5.2;

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** Instantly center on a world point (used on run start / menu init). */
  snapTo(x: number, y: number): void {
    this.x = wrapPos(x, WORLD_W);
    this.y = wrapPos(y, WORLD_H);
    this.travelX = this.x;
    this.travelY = this.y;
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  /**
   * Smoothly follow a target point, with optional velocity lead so fast flight
   * shows more of the sky ahead.
   */
  follow(tx: number, ty: number, dt: number, leadX = 0, leadY = 0, reducedMotion = false): void {
    const goalX = tx + (reducedMotion ? 0 : leadX);
    const goalY = ty + (reducedMotion ? 0 : leadY);
    // Damp in wrapped space: move by the shortest delta toward the goal.
    const dx = wrapDelta(this.x - goalX, WORLD_W);
    const dy = wrapDelta(this.y - goalY, WORLD_H);
    const k = 1 - Math.exp(-this.followLambda * dt);
    const moveX = -dx * k;
    const moveY = -dy * k;
    this.x = wrapPos(this.x + moveX, WORLD_W);
    this.y = wrapPos(this.y + moveY, WORLD_H);
    this.travelX += moveX;
    this.travelY += moveY;
  }

  /** Add shake energy (capped so it never becomes nauseating). */
  shake(amount: number): void {
    this.shakeMag = clamp(Math.max(this.shakeMag * 0.6, amount), 0, 24);
  }

  /** Advance shake decay + offsets. Call once per frame (after follow). */
  update(dt: number, reducedMotion = false): void {
    if (reducedMotion) {
      this.shakeMag = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      return;
    }
    this.shakeMag = damp(this.shakeMag, 0, 6.5, dt);
    if (this.shakeMag < 0.05) {
      this.shakeMag = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      return;
    }
    const m = this.shakeMag;
    this.shakeX = (Math.random() * 2 - 1) * m;
    this.shakeY = (Math.random() * 2 - 1) * m;
  }

  /** World X → screen X (with shake applied). */
  worldToScreenX(wx: number): number {
    return this.viewW * 0.5 + wrapDelta(wx - this.x, WORLD_W) + this.shakeX;
  }

  /** World Y → screen Y (with shake applied). */
  worldToScreenY(wy: number): number {
    return this.viewH * 0.5 + wrapDelta(wy - this.y, WORLD_H) + this.shakeY;
  }

  /** Screen X → world X (ignores shake; used for tests and UI mapping). */
  screenToWorldX(sx: number): number {
    return wrapPos(this.x + (sx - this.viewW * 0.5), WORLD_W);
  }

  screenToWorldY(sy: number): number {
    return wrapPos(this.y + (sy - this.viewH * 0.5), WORLD_H);
  }

  /** Is a world point within the viewport (+margin)? */
  isVisible(wx: number, wy: number, margin = 80): boolean {
    const dx = wrapDelta(wx - this.x, WORLD_W);
    const dy = wrapDelta(wy - this.y, WORLD_H);
    return (
      Math.abs(dx) <= this.viewW * 0.5 + margin && Math.abs(dy) <= this.viewH * 0.5 + margin
    );
  }
}
