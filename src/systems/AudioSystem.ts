/**
 * AudioSystem — 100% procedural WebAudio (master plan §35).
 * No audio files, no copyrighted assets. Everything is synthesized:
 * blips, whooshes, booms, beeps, plus a very quiet generative ambient music bed.
 *
 * Fails gracefully: if AudioContext is unavailable, every call is a no-op.
 */

export type SfxName =
  | 'click'
  | 'back'
  | 'launch'
  | 'proximity'
  | 'collision'
  | 'chain'
  | 'star'
  | 'shield'
  | 'boost'
  | 'powerup'
  | 'hit'
  | 'destroyed'
  | 'mission';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  soundOn = true;
  musicOn = true;

  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;

  /** Minimum gap between repeated instances of the same sound (seconds). */
  private lastPlayed: Partial<Record<SfxName, number>> = {};
  private throttle: Partial<Record<SfxName, number>> = {
    proximity: 0.16,
    launch: 0.07,
    collision: 0.045,
    chain: 0.045,
    star: 0.05,
  };

  /** Must be called from a user gesture (browser autoplay policies). */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      type WinAudio = typeof window & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? (window as WinAudio).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.soundOn ? 1 : 0;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 1 : 0;
      this.musicBus.connect(this.master);

      // Pre-render 1s of white noise for explosions/whooshes.
      const len = Math.floor(this.ctx.sampleRate);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      if (this.musicOn) this.startMusic();
    } catch {
      this.ctx = null; // audio unavailable — game continues silently
    }
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  play(name: SfxName, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.soundOn) return;
    const t = this.now();
    const min = this.throttle[name] ?? 0;
    const last = this.lastPlayed[name];
    if (last !== undefined && t - last < min) return;
    this.lastPlayed[name] = t;

    try {
      switch (name) {
        case 'click':
          this.blip(660, 0.05, 'square', 0.25);
          break;
        case 'back':
          this.blip(440, 0.07, 'square', 0.22);
          this.blip(330, 0.09, 'square', 0.18, 0.05);
          break;
        case 'launch':
          this.whoosh(0.28, 900, 180, 0.16 * intensity);
          break;
        case 'proximity':
          this.blip(880 + 500 * intensity, 0.05, 'sine', 0.14 + 0.1 * intensity);
          break;
        case 'collision':
          this.explosion(0.5 * intensity, 1);
          break;
        case 'chain':
          this.explosion(0.6 * intensity, 1 + 0.08 * intensity);
          this.blip(520 + 90 * intensity, 0.1, 'triangle', 0.16);
          break;
        case 'star':
          this.blip(1318, 0.06, 'sine', 0.22); // E6
          this.blip(1760, 0.09, 'sine', 0.2, 0.055); // A6
          break;
        case 'shield':
          this.sweep(300, 900, 0.22, 'triangle', 0.2);
          break;
        case 'boost':
          this.whoosh(0.34, 220, 1100, 0.2);
          break;
        case 'powerup':
          this.blip(784, 0.07, 'triangle', 0.2); // G5
          this.blip(1046, 0.1, 'triangle', 0.2, 0.07); // C6
          break;
        case 'hit':
          this.explosion(0.8, 0.8);
          this.sweep(400, 90, 0.3, 'sawtooth', 0.22);
          break;
        case 'destroyed':
          this.explosion(1.3, 0.7);
          this.sweep(300, 40, 0.9, 'sawtooth', 0.3);
          this.whoosh(0.9, 600, 60, 0.3);
          break;
        case 'mission':
          this.blip(659, 0.09, 'triangle', 0.2); // E5
          this.blip(830, 0.09, 'triangle', 0.2, 0.1); // G#5
          this.blip(987, 0.16, 'triangle', 0.22, 0.2); // B5
          break;
      }
    } catch {
      /* a failed sound must never break the game loop */
    }
  }

  /** Short enveloped oscillator blip. */
  private blip(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfxBus!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Frequency sweep. */
  private sweep(f0: number, f1: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfxBus!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered noise whoosh. */
  private whoosh(dur: number, f0: number, f1: number, gain: number): void {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.sfxBus!);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Layered boom: lowpass noise + descending sine thump. */
  private explosion(size: number, pitch: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = 0.32 + 0.5 * size;
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2600 * pitch, t);
      filter.frequency.exponentialRampToValueAtTime(90, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5 * Math.min(1, size), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter).connect(g).connect(this.sfxBus!);
      src.start(t);
      src.stop(t + dur + 0.05);
    }
    const osc = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + dur * 0.9);
    g2.gain.setValueAtTime(0.55 * Math.min(1.2, size), t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g2).connect(this.sfxBus!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /* ---------------- Generative ambient music ---------------- */

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicOn ? 1 : 0, this.ctx.currentTime, 0.3);
    }
    // A slow, quiet chord pad + sparse pentatonic sparkle. Very low volume so
    // it never fights the SFX.
    this.musicTimer = setInterval(() => this.musicTick(), 2400);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
  }

  private musicTick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn || !this.musicBus) return;
    try {
      const t = ctx.currentTime + 0.06;
      // Am - F - C - G progression, one chord every other tick.
      const chords = [
        [220, 261.6, 329.6],
        [174.6, 220, 261.6],
        [196, 261.6, 329.6],
        [196, 246.9, 293.7],
      ];
      const chord = chords[Math.floor(this.musicStep / 2) % chords.length];
      const dur = 4.6;
      for (const f of chord) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'triangle';
        osc.frequency.value = f;
        filter.type = 'lowpass';
        filter.frequency.value = 900;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028, t + 1.4);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        osc.connect(filter).connect(g).connect(this.musicBus);
        osc.start(t);
        osc.stop(t + dur + 0.1);
      }
      // Sparse sparkle note.
      if (this.musicStep % 3 === 1) {
        const scale = [523.3, 587.3, 659.3, 784, 880, 1046.5];
        const f = scale[Math.floor(Math.random() * scale.length)];
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + 0.8);
        g.gain.exponentialRampToValueAtTime(0.02, t + 0.85);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        osc.connect(g).connect(this.musicBus);
        osc.start(t + 0.8);
        osc.stop(t + 2.3);
      }
      this.musicStep++;
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    this.stopMusic();
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
