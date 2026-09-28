/**
 * VirtualJoystick — 360° analog stick for touch & mouse (master plan §9).
 *
 * The whole LEFT HALF of the screen is a touch zone:
 *  - With "show joystick" ON, a fixed base sits bottom-left and the stick also
 *    works anywhere in the zone.
 *  - With it OFF, the base appears dynamically wherever the player touches.
 *
 * Writes its normalized vector straight into InputSystem.
 */

import type { InputSystem } from '../systems/InputSystem';
import { clamp } from '../game/util/math';

const DEAD_ZONE = 0.12;

export class VirtualJoystick {
  readonly zone: HTMLDivElement;
  readonly base: HTMLDivElement;
  readonly knob: HTMLDivElement;

  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private radius = 56;
  private dynamic = false;

  constructor(container: HTMLElement, private input: InputSystem) {
    this.zone = document.createElement('div');
    this.zone.id = 'touch-zone';

    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.base.innerHTML = '<div class="joy-ring"></div>';

    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';

    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);
    container.appendChild(this.zone);

    this.zone.addEventListener('pointerdown', (e) => this.onDown(e));
    this.zone.addEventListener('pointermove', (e) => this.onMove(e));
    this.zone.addEventListener('pointerup', (e) => this.onUp(e));
    this.zone.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  /** Fixed-base visibility per settings; dynamic mode still works when hidden. */
  setShowFixed(show: boolean): void {
    this.zone.classList.toggle('fixed-visible', show);
  }

  setEnabled(enabled: boolean): void {
    this.zone.classList.toggle('enabled', enabled);
    if (!enabled) this.release();
  }

  private onDown(e: PointerEvent): void {
    if (this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);

    const fixedVisible = this.zone.classList.contains('fixed-visible');
    if (fixedVisible) {
      // Anchor to the fixed base position.
      const r = this.base.getBoundingClientRect();
      this.originX = r.left + r.width / 2;
      this.originY = r.top + r.height / 2;
      this.radius = r.width / 2;
      this.dynamic = false;
    } else {
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.radius = 56;
      this.dynamic = true;
      const zoneRect = this.zone.getBoundingClientRect();
      this.base.style.left = `${e.clientX - zoneRect.left - 70}px`;
      this.base.style.top = `${e.clientY - zoneRect.top - 70}px`;
      this.base.classList.add('dynamic');
    }
    this.base.classList.add('active');
    this.applyVector(e.clientX, e.clientY);
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.applyVector(e.clientX, e.clientY);
    e.preventDefault();
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.release();
    e.preventDefault();
  }

  private release(): void {
    this.pointerId = null;
    this.input.joystickX = 0;
    this.input.joystickY = 0;
    this.base.classList.remove('active', 'dynamic');
    if (this.dynamic) {
      this.base.style.left = '';
      this.base.style.top = '';
      this.dynamic = false;
    }
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  private applyVector(cx: number, cy: number): void {
    let dx = cx - this.originX;
    let dy = cy - this.originY;
    const len = Math.hypot(dx, dy);
    const max = this.radius;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const mag = clamp(len / max, 0, 1);
    if (mag < DEAD_ZONE) {
      this.input.joystickX = 0;
      this.input.joystickY = 0;
      return;
    }
    // Rescale so leaving the dead zone starts from ~0 smoothly.
    const scaled = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
    const nx = len > 0 ? dx / len : 0;
    const ny = len > 0 ? dy / len : 0;
    this.input.joystickX = nx * scaled;
    this.input.joystickY = ny * scaled;
  }
}
