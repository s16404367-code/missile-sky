/**
 * InputSystem — unified keyboard + pointer input (master plan §9, §32).
 *
 * Desktop: WASD / arrows to fly, Space = boost, Q = shield, P or Esc = pause.
 * Mobile: virtual joystick (left zone) + on-screen BOOST / SHIELD buttons.
 * Mouse users can also drag the left zone as a joystick.
 *
 * The system produces one ControlState per frame with analog move vector and
 * consumed "edge" presses (true exactly once per press).
 */

export interface ControlState {
  /** Analog movement vector, magnitude 0..1. */
  mx: number;
  my: number;
  /** True on the frame boost was pressed. */
  boostEdge: boolean;
  /** True on the frame shield was pressed. */
  shieldEdge: boolean;
  /** True on the frame pause was pressed. */
  pauseEdge: boolean;
}

export class InputSystem {
  /** External sources (VirtualJoystick / touch buttons) write here. */
  joystickX = 0;
  joystickY = 0;
  private touchBoostEdge = false;
  private shieldEdge = false;

  private keys = new Set<string>();
  private boostEdge = false;
  private pauseEdge = false;

  private attached = false;
  private detachFns: (() => void)[] = [];

  /** Fired when the page hides — Game uses this to auto-pause. */
  onBlur: (() => void) | null = null;

  attach(target: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;

    const onKeyDown = (e: KeyboardEvent) => {
      // Never trap browser-critical combos.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const c = e.code;
      if (
        [
          'KeyW', 'KeyA', 'KeyS', 'KeyD',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
          'Space', 'KeyQ', 'KeyP', 'Escape', 'Enter',
        ].includes(c)
      ) {
        e.preventDefault();
      }
      if (e.repeat) return;
      this.keys.add(c);
      if (c === 'Space') this.boostEdge = true;
      if (c === 'KeyQ') this.shieldEdge = true;
      if (c === 'KeyP' || c === 'Escape') this.pauseEdge = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    const onBlur = () => {
      this.keys.clear();
      this.onBlur?.();
    };
    const onVisibility = () => {
      if (document.hidden) {
        this.keys.clear();
        this.onBlur?.();
      }
    };
    // Suppress the context menu on long-press during gameplay (mobile).
    const onContextMenu = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.('#game-canvas, #touch-zone, .touch-btn')) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    target.addEventListener('contextmenu', onContextMenu);
    // If a key is held while the window loses focus, make sure it clears.
    window.addEventListener('focus', () => this.keys.clear());

    this.detachFns.push(() => window.removeEventListener('keydown', onKeyDown));
    this.detachFns.push(() => window.removeEventListener('keyup', onKeyUp));
    this.detachFns.push(() => window.removeEventListener('blur', onBlur));
    this.detachFns.push(() => document.removeEventListener('visibilitychange', onVisibility));
    this.detachFns.push(() => target.removeEventListener('contextmenu', onContextMenu));
  }

  detach(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.attached = false;
  }

  /** Called by the on-screen BOOST button. */
  pressBoost(): void {
    this.touchBoostEdge = true;
  }

  /** Called by the on-screen SHIELD button. */
  pressShield(): void {
    this.shieldEdge = true;
  }

  /** Poll once per frame. Edge flags are consumed by this call. */
  poll(): ControlState {
    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    // Normalize diagonal keyboard input.
    const kl = Math.hypot(kx, ky);
    if (kl > 1) {
      kx /= kl;
      ky /= kl;
    }
    // Joystick wins when it has a stronger signal (allows simultaneous use).
    const jl = Math.hypot(this.joystickX, this.joystickY);
    let mx = kx;
    let my = ky;
    if (jl > kl) {
      mx = this.joystickX;
      my = this.joystickY;
    }
    const state: ControlState = {
      mx,
      my,
      boostEdge: this.boostEdge || this.touchBoostEdge,
      shieldEdge: this.shieldEdge,
      pauseEdge: this.pauseEdge,
    };
    this.boostEdge = false;
    this.touchBoostEdge = false;
    this.shieldEdge = false;
    this.pauseEdge = false;
    return state;
  }
}
