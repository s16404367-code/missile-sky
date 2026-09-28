/**
 * PerformanceSystem — FPS monitoring + automatic quality degradation
 * (master plan §20, §33).
 *
 * It never changes the user's chosen quality setting; instead it exposes a
 * 0..1 `degrade` factor that systems use to trim particle counts etc. when
 * frames get slow, and to recover when things are smooth again.
 */

export class PerformanceSystem {
  /** Smoothed FPS estimate. */
  fps = 60;
  /** Auto-degradation factor 0 (full quality) .. 0.6 (heavily trimmed). */
  degrade = 0;

  private lowTime = 0;
  private highTime = 0;

  sample(dt: number): void {
    if (dt <= 0) return;
    const inst = 1 / dt;
    // Exponential moving average, robust to single hitches.
    this.fps += (inst - this.fps) * Math.min(1, dt * 3);

    if (this.fps < 42) {
      this.lowTime += dt;
      this.highTime = 0;
      if (this.lowTime > 2.2) {
        this.degrade = Math.min(0.6, this.degrade + 0.2);
        this.lowTime = 0;
      }
    } else if (this.fps > 56) {
      this.highTime += dt;
      this.lowTime = 0;
      if (this.highTime > 5) {
        this.degrade = Math.max(0, this.degrade - 0.1);
        this.highTime = 0;
      }
    } else {
      this.lowTime = 0;
      this.highTime = 0;
    }
  }

  /** Particle budget multiplier combining user quality and auto-degradation. */
  particleFactor(quality: 'low' | 'medium' | 'high'): number {
    const base = quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : 1;
    return Math.max(0.15, base * (1 - this.degrade));
  }

  reset(): void {
    this.fps = 60;
    this.degrade = 0;
    this.lowTime = 0;
    this.highTime = 0;
  }
}
