/**
 * GameLoop — requestAnimationFrame driver with delta time (master plan §42).
 * Delta is clamped so a backgrounded tab or a long hitch can never teleport
 * the simulation forward.
 */

export class GameLoop {
  private rafId = 0;
  private last = 0;
  private running = false;

  constructor(private readonly frame: (dt: number, time: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.frame(dt, now / 1000);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }
}
