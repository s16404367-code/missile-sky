/**
 * Game — the orchestrator (master plan §42, §44).
 *
 * Owns the loop pipeline:
 *   INPUT → PLAYER → WORLD/CAMERA → MISSILES → COLLISIONS → EVENTS
 *   → PARTICLES → AUDIO → RENDER → UI
 *
 * Explicit states: MENU (living attract mode), PLAYING, PAUSED, GAME_OVER,
 * HANGAR, UPGRADES, MISSIONS, SETTINGS. Menu-ish states keep the world alive
 * behind the UI (master plan §40).
 */

import { Camera } from './Camera';
import { CloudSystem } from './CloudSystem';
import { CollisionSystem, type Reaction } from './CollisionSystem';
import { EventBus } from './Events';
import { FloatingTextSystem } from './FloatingText';
import { GameLoop } from './GameLoop';
import { MissileManager } from './MissileManager';
import { ParticleSystem } from './ParticleSystem';
import { Player, PLAYER_RADIUS } from './Player';
import { drawMissileBody, type Missile } from './Missile';
import { PowerUpSystem } from './PowerUpSystem';
import { SkyRenderer } from './SkyRenderer';
import { StarSystem } from './StarSystem';
import { difficultyAt, World, type DifficultyParams } from './World';
import { MISSILE_TYPES } from '../data/missiles';
import { getMode, type ModeDef } from '../data/modes';
import type { AudioSystem } from '../systems/AudioSystem';
import type { InputSystem } from '../systems/InputSystem';
import type { ProgressionSystem } from '../systems/ProgressionSystem';
import type { SaveSystem } from '../systems/SaveSystem';
import { PerformanceSystem } from '../systems/PerformanceSystem';
import { GameState } from './types';
import type { GameEventMap, GameModeId, RunStats } from './types';
import { clamp, damp } from './util/math';

/** Minimal HUD interface so Game never imports UI directly. */
export interface HudInfo {
  time: number;
  score: number;
  best: number;
  coins: number;
  missiles: number;
  combo: number;
  comboPct: number;
  hp: number;
  maxHp: number;
  shieldCharges: number;
  shieldMax: number;
  boostPct: number;
  mode: string;
}

export interface HudLike {
  update(info: HudInfo): void;
  setVisible(v: boolean): void;
}

export interface GameUIHooks {
  onStateChange?: (state: GameState, prev: GameState) => void;
  onGameOver?: (stats: RunStats) => void;
  onToast?: (text: string) => void;
}

export interface GameDeps {
  canvas: HTMLCanvasElement;
  save: SaveSystem;
  audio: AudioSystem;
  input: InputSystem;
  progression: ProgressionSystem;
  events: EventBus<GameEventMap>;
}

const COMBO_WINDOW = 3.2;

export class Game {
  readonly ctx: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;

  state: GameState = GameState.MENU;
  prevState: GameState = GameState.MENU;
  mode: ModeDef = getMode('normal');

  // subsystems
  readonly world = new World();
  readonly camera = new Camera();
  readonly clouds = new CloudSystem();
  readonly particles = new ParticleSystem();
  readonly stars = new StarSystem();
  readonly powerups = new PowerUpSystem();
  readonly floats = new FloatingTextSystem();
  readonly player = new Player();
  readonly missileMgr = new MissileManager();
  readonly collisions = new CollisionSystem();
  readonly sky = new SkyRenderer();
  readonly perf = new PerformanceSystem();

  events: EventBus<GameEventMap>;
  hud: HudLike | null = null;
  hooks: GameUIHooks = {};

  // run state
  private loop: GameLoop;
  private dpr = 1;
  private timeScale = 1;
  private dying = false;
  private deathT = 0;
  private hitFlash = 0;
  private runScore = 0;
  private runStars = 0;
  private runDestroyed = 0;
  private runMaxChain = 0;
  private runShieldUsed = 0;
  private combo = 0;
  private comboT = 0;
  private lastBeepT = -1;
  private lastActiveMissiles = 0;
  private smokeInterval = 0.034;

  // attract mode
  private attractT = 0;
  private attractSpawnT = 2;
  private anchorX = 0;
  private anchorY = 0;

  private deps: GameDeps;

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.missileMgr.onSpawn = (m) => {
      this.events.emit('MISSILE_SPAWNED', { type: m.type, x: m.x, y: m.y });
    };
    const ctx = deps.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D unsupported');
    this.ctx = ctx;
    this.canvas = deps.canvas;
    this.events = deps.events;

    deps.input.onBlur = () => {
      if (this.state === GameState.PLAYING) this.pause();
    };

    this.subscribeEvents();

    this.anchorX = this.world.rnd() * this.world.w;
    this.anchorY = this.world.rnd() * this.world.h;
    this.resize();
    this.resetAttract();

    this.loop = new GameLoop((dt, time) => this.frame(dt, time));
  }

  /* ------------------------------------------------------------ lifecycle */

  start(): void {
    this.loop.start();
  }

  private get settings() {
    return this.deps.save.data.settings;
  }

  private setState(s: GameState): void {
    if (this.state === s) return;
    const prev = this.state;
    this.prevState = prev;
    this.state = s;
    this.hooks.onStateChange?.(s, prev);
  }

  /** Called by UI after any settings change. */
  applySettings(): void {
    const q = this.settings.quality;
    this.particles.budget = this.perf.particleFactor(q);
    this.smokeInterval = q === 'low' ? 0.085 : q === 'medium' ? 0.05 : 0.032;
    // Reapply the DPR cap and rebuild procedural cloud density immediately.
    this.resize();
    this.deps.audio.setSound(this.settings.sound);
    this.deps.audio.setMusic(this.settings.music);
  }

  resize(): void {
    const q = this.settings.quality;
    this.dpr = Math.min(window.devicePixelRatio || 1, q === 'low' ? 1.25 : 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.camera.resize(w, h);
    this.missileMgr.spawnViewRadius = Math.hypot(w, h) * 0.5;
    this.clouds.init(w, h, q);
    this.particles.budget = this.perf.particleFactor(q);
  }

  /* ------------------------------------------------------------ run control */

  startRun(modeId: GameModeId): void {
    this.mode = getMode(modeId);
    this.world.runTime = 0;
    this.world.reseed((Math.random() * 0xffffffff) >>> 0);
    this.particles.clear();
    this.floats.clear();
    this.stars.clear();
    this.powerups.clear();
    this.missileMgr.clear();

    this.runScore = 0;
    this.runStars = 0;
    this.runDestroyed = 0;
    this.runMaxChain = 0;
    this.runShieldUsed = 0;
    this.combo = 0;
    this.comboT = 0;
    this.timeScale = 1;
    this.dying = false;
    this.deathT = 0;
    this.hitFlash = 0;

    this.player.reset(this.camera.x, this.camera.y, this.deps.progression.effectiveStats());
    this.camera.snapTo(this.player.x, this.player.y);
    this.clouds.resetMotion(this.camera);
    this.setState(GameState.PLAYING);
    this.hud?.setVisible(true);
    this.deps.audio.play('launch');
  }

  pause(): void {
    if (this.state !== GameState.PLAYING) return;
    this.setState(GameState.PAUSED);
    this.deps.audio.play('back');
  }

  resume(): void {
    if (this.state !== GameState.PAUSED) return;
    this.setState(GameState.PLAYING);
    this.deps.audio.play('click');
  }

  restart(): void {
    this.startRun(this.mode.id);
  }

  quitToMenu(): void {
    this.deps.save.flush();
    this.resetAttract();
    this.setState(GameState.MENU);
    this.hud?.setVisible(false);
    this.deps.audio.play('back');
  }

  gotoMenuScreen(s: GameState): void {
    if (s === GameState.MENU) {
      this.quitToMenu();
      return;
    }
    this.setState(s);
    this.deps.audio.play('click');
  }

  private resetAttract(): void {
    this.attractT = this.world.clock;
    this.attractSpawnT = 1.5;
    this.particles.clear();
    this.floats.clear();
    this.stars.clear();
    this.powerups.clear();
    this.missileMgr.clear();
    this.anchorX = this.world.rnd() * this.world.w;
    this.anchorY = this.world.rnd() * this.world.h;
    const stats = this.deps.progression.effectiveStats();
    this.player.reset(this.anchorX, this.anchorY, stats);
    this.player.invulnT = 0;
    this.camera.snapTo(this.player.x, this.player.y);
    this.clouds.resetMotion(this.camera);
  }

  private finishRun(): void {
    const stats = this.deps.progression.submitRun({
      mode: this.mode.id,
      time: this.world.runTime,
      score: this.runScore,
      missilesDestroyed: this.runDestroyed,
      maxChain: this.runMaxChain,
      stars: this.runStars,
      shieldUsed: this.runShieldUsed,
    });
    this.deps.save.flush();
    this.setState(GameState.GAME_OVER);
    this.hud?.setVisible(false);
    this.events.emit('GAME_OVER', { stats });
    this.hooks.onGameOver?.(stats);
  }

  /* ------------------------------------------------------------ events */

  private subscribeEvents(): void {
    const ev = this.events;
    ev.on('BOOST_USED', () => this.deps.audio.play('boost'));
    ev.on('SHIELD_USED', () => {
      if (this.state === GameState.PLAYING) this.runShieldUsed++;
      this.deps.audio.play('shield');
      this.vibrate(18);
    });
    ev.on('STAR_COLLECTED', () => this.deps.audio.play('star'));
    ev.on('POWERUP_COLLECTED', (p) => {
      this.deps.audio.play('powerup');
      this.floats.spawn(p.x, p.y - 18, p.kind === 'shield' ? 'SHIELD +1' : 'BOOST READY',
        p.kind === 'shield' ? '#8fd6ff' : '#ffcf70', 15);
    });
    ev.on('MISSION_COMPLETED', (m) => {
      this.deps.audio.play('mission');
      this.hooks.onToast?.(`MISSION COMPLETE — ${m.title}`);
    });
    ev.on('ACHIEVEMENT_UNLOCKED', (a) => {
      this.deps.audio.play('mission');
      this.hooks.onToast?.(`ACHIEVEMENT — ${a.title}  ·  +${a.coins} COINS`);
    });
    ev.on('LEVEL_UP', (l) => {
      this.deps.audio.play('mission');
      this.hooks.onToast?.(`LEVEL UP! You reached level ${l.level}`);
    });
  }

  private vibrate(pattern: number | number[]): void {
    try {
      if (this.settings.vibration && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      /* not supported — ignore */
    }
  }

  /* ------------------------------------------------------------ main frame */

  private frame(dt: number, time: number): void {
    this.perf.sample(dt);
    const input = this.deps.input.poll();

    switch (this.state) {
      case GameState.PLAYING: {
        if (input.pauseEdge) {
          this.pause();
          break;
        }
        this.simUpdate(dt, input);
        break;
      }
      case GameState.PAUSED: {
        if (input.pauseEdge) this.resume();
        break; // frozen scene, still rendered below
      }
      case GameState.MENU:
      case GameState.HANGAR:
      case GameState.UPGRADES:
      case GameState.MISSIONS:
      case GameState.SETTINGS:
        this.attractUpdate(dt);
        break;
      case GameState.GAME_OVER: {
        // Keep the aftermath drifting gently behind the panel.
        const d = Math.min(dt, 1 / 30);
        this.particles.update(d, 0, 0);
        this.floats.update(d);
        this.camera.update(d, this.settings.reducedMotion);
        break;
      }
    }

    this.render(time);
  }

  /* ------------------------------------------------------------ simulation */

  private simUpdate(dtRaw: number, input: { mx: number; my: number; boostEdge: boolean; shieldEdge: boolean; pauseEdge: boolean }): void {
    // Death sequence: slow motion, then settle.
    let dt = dtRaw;
    if (this.dying) {
      this.timeScale = damp(this.timeScale, 0.3, 4.5, dtRaw);
      this.deathT += dtRaw;
      dt = dtRaw * this.timeScale;
      if (this.deathT > 1.9) {
        this.finishRun();
        return;
      }
    } else {
      this.timeScale = 1;
    }

    // Fixed-ish substeps keep 30 FPS and 60 FPS playing identically.
    const steps = clamp(Math.ceil(dt / (1 / 60)), 1, 4);
    const h = dt / steps;
    const params = difficultyAt(this.world.runTime * this.mode.rampMul, this.mode);

    for (let i = 0; i < steps; i++) {
      this.step(h, i === 0 ? input : { mx: input.mx, my: input.my, boostEdge: false, shieldEdge: false, pauseEdge: false }, params);
    }

    // Per-frame (visual) updates.
    this.world.clock += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dtRaw * 2.2);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (!this.dying) {
      this.runScore += dt * 10 * this.mode.scoreMul;
    }

    this.camera.follow(
      this.player.x, this.player.y, dtRaw,
      this.player.vx * 0.16, this.player.vy * 0.16,
      this.settings.reducedMotion,
    );
    this.camera.update(dtRaw, this.settings.reducedMotion);
    this.clouds.update(dtRaw, this.camera);

    // Missile launch whoosh when new ones appear.
    const active = this.missileMgr.activeCount();
    if (active > this.lastActiveMissiles) this.deps.audio.play('launch');
    this.lastActiveMissiles = active;

    // Proximity audio cue (throttled, pitch/intensity rises with danger).
    const sev = this.sky.maxSeverity;
    if (sev > 0.22 && !this.dying) {
      const gap = 0.36 - 0.26 * sev;
      if (time_since(this.lastBeepT, this.world.clock) > gap) {
        this.lastBeepT = this.world.clock;
        this.deps.audio.play('proximity', sev);
      }
    }

    this.updateHud();
  }

  private step(h: number, input: { mx: number; my: number; boostEdge: boolean; shieldEdge: boolean }, params: DifficultyParams): void {
    const w = this.world;
    const p = this.player;
    const dying = this.dying;

    w.runTime += h;

    if (!dying) {
      p.update(h, input, w, this.events, this.particles, this.deps.progression.aircraft(), this.particles.budget);
    }

    this.missileMgr.update(h, w, p, params, this.particles, this.smokeInterval, false);

    const res = this.collisions.update(w, p, this.missileMgr.missiles, this.stars, this.powerups, !dying);

    for (const r of res.reactions) this.handleReaction(r, params);
    for (const m of res.shieldBlocks) this.handleShieldBlock(m, params);
    for (const m of res.playerHits) this.resolvePlayerHit(m, params);
    for (const s of res.stars) {
      this.runStars++;
      this.runScore += 25 * this.mode.scoreMul;
      this.particles.starBurst(s.x, s.y);
      this.floats.spawn(s.x, s.y - 14, '+1★', '#ffd666', 14);
      this.events.emit('STAR_COLLECTED', { x: s.x, y: s.y });
    }
    for (const pu of res.powerups) {
      if (pu.kind === 'shield') {
        if (!p.restoreShield()) this.runScore += 50 * this.mode.scoreMul;
      } else {
        p.restoreBoost();
      }
      this.events.emit('POWERUP_COLLECTED', { kind: pu.kind, x: pu.x, y: pu.y });
    }

    // Star population uses the last missile bearing as a "risk" direction.
    const threatAngle = this.missileMgr.lastSpawnAngle;
    this.stars.update(h, w, p.x, p.y, p.vx, p.vy, threatAngle);
    this.powerups.update(h, w, p.x, p.y, w.runTime);
    this.particles.update(h, -p.vx * 0.02, -p.vy * 0.02);
    this.floats.update(h);

    // Proximity warnings for rendering/audio this frame.
    this.sky.computeWarnings(w, p, this.missileMgr.missiles, w.clock);
  }

  /* ------------------------------------------------------------ reactions */

  private handleReaction(r: Reaction, params: DifficultyParams, attract = false): void {
    const n = r.destroyed.length;
    if (n === 0) return;

    // Splitter fragments (safe to call — destroyMissile is idempotent).
    for (const m of r.destroyed) this.missileMgr.destroyMissile(m, params);

    // Visuals & audio.
    const bursts = Math.min(n, 8);
    for (let i = 0; i < bursts; i++) {
      const m = r.destroyed[i];
      const power = m.type === 'heavy' ? 1.7 : m.isFragment ? 0.6 : 1;
      this.particles.burstExplosion(m.x, m.y, power);
    }
    if (n > bursts) this.particles.burstExplosion(r.x, r.y, 1.6);

    const dToPlayer = this.world.distance(r.x, r.y, this.player.x, this.player.y);
    const shakeK = clamp(700 / (240 + dToPlayer), 0.15, 1.4);
    this.camera.shake(Math.min(20, (4 + n * 2.2) * shakeK));
    this.deps.audio.play(n >= 3 ? 'chain' : 'collision', Math.min(2, n * 0.7));
    if (n >= 3 && shakeK > 0.5) this.vibrate(24);

    this.events.emit('MISSILE_COLLIDED', { x: r.x, y: r.y, chain: n });

    if (attract) return; // attract mode: visuals only

    // Scoring: 50·n·(n−1) → 2 missiles = +100, ×3 = +300, ×4 = +600, ×5 = +1000.
    this.combo++;
    this.comboT = COMBO_WINDOW;
    const comboMul = 1 + Math.min(2, (this.combo - 1) * 0.25);
    const points = Math.round(50 * n * (n - 1) * comboMul * this.mode.scoreMul);
    this.runScore += points;
    this.runDestroyed += n;
    for (let i = 0; i < n; i++) {
      const m = r.destroyed[i];
      this.events.emit('MISSILE_DESTROYED', {
        x: m.x, y: m.y, byChain: i >= 2, points: Math.floor(points / n),
      });
    }
    if (n > this.runMaxChain) this.runMaxChain = n;

    if (n >= 3) {
      this.floats.spawn(r.x, r.y - 10, `CHAIN ×${n}  +${points}`, '#ffb703', 15 + Math.min(9, n));
      this.events.emit('CHAIN_INCREASED', { size: n, points });
    } else {
      this.floats.spawn(r.x, r.y - 10, `MISSILE COLLISION  +${points}`, '#ffffff', 15);
      this.events.emit('CHAIN_STARTED', { size: n });
    }
    if (this.combo >= 2) {
      this.floats.spawn(r.x, r.y - 34, `COMBO ×${this.combo}`, '#8fd6ff', 12);
    }
  }

  private handleShieldBlock(_m: Missile, _params: DifficultyParams): void {
    // CollisionSystem already registered this as an explosion reaction, so
    // scoring, missile cleanup and chain rewards are handled exactly once there.
    this.particles.shieldPop(this.player.x, this.player.y, true);
    this.camera.shake(6);
    this.vibrate(20);
  }

  private resolvePlayerHit(m: Missile, params: DifficultyParams): void {
    if (this.dying) return; // a single fatal impact owns the death sequence
    const outcome = this.player.applyHit();
    this.particles.burstExplosion(m.x, m.y, 1.2);
    this.missileMgr.destroyMissile(m, params);

    if (outcome === 'invuln' || outcome === 'shield') return; // shouldn't normally occur

    if (outcome === 'survive') {
      this.hitFlash = 0.75;
      this.camera.shake(18);
      this.deps.audio.play('hit');
      this.vibrate([28, 40, 28]);
      this.events.emit('PLAYER_HIT', { fatal: false, hpLeft: this.player.hp, x: this.player.x, y: this.player.y });
      this.floats.spawn(this.player.x, this.player.y - 30, 'ARMOR HELD!', '#ffd666', 15);
      return;
    }

    // fatal
    this.dying = true;
    this.deathT = 0;
    this.hitFlash = 1;
    this.camera.shake(24);
    const c = this.deps.progression.aircraft().colors;
    const rgb = hexToRgb(c.accent);
    this.particles.playerExplosion(this.player.x, this.player.y, rgb[0], rgb[1], rgb[2]);
    this.deps.audio.play('destroyed');
    this.vibrate([60, 40, 120]);
    this.events.emit('PLAYER_HIT', { fatal: true, hpLeft: 0, x: this.player.x, y: this.player.y });
  }

  /* ------------------------------------------------------------ attract mode */

  private attractUpdate(dt: number): void {
    const d = Math.min(dt, 1 / 30);
    this.world.clock += d;
    this.attractT += d;

    // Autopilot: a lazy lissajous around a world anchor.
    const tx = this.anchorX + Math.sin(this.attractT * 0.31) * 420;
    const ty = this.anchorY + Math.cos(this.attractT * 0.23) * 320;
    const dx = this.world.deltaX(this.player.x, tx);
    const dy = this.world.deltaY(this.player.y, ty);
    const dd = Math.hypot(dx, dy) || 1;
    const strength = clamp(dd / 220, 0, 1);
    this.player.update(
      d,
      { mx: (dx / dd) * strength, my: (dy / dd) * strength, boostEdge: false, shieldEdge: false },
      this.world, this.events, this.particles, this.deps.progression.aircraft(), this.particles.budget,
    );

    // Ambient missiles that near-miss the demo aircraft (noHit) — occasional
    // missile-vs-missile reactions keep the menu sky dramatic.
    this.attractSpawnT -= d;
    const params = difficultyAt(24, this.mode);
    if (this.attractSpawnT <= 0 && this.missileMgr.activeCount() < 6) {
      const spot = this.world.randomPointAround(this.player.x, this.player.y, 620, 900);
      const heading = Math.atan2(
        this.world.deltaY(spot.y, this.player.y),
        this.world.deltaX(spot.x, this.player.x),
      );
      const types: (keyof typeof MISSILE_TYPES)[] = ['standard', 'fast', 'curving', 'zigzag'];
      const type = types[Math.floor(this.world.rnd() * types.length)];
      this.missileMgr.spawn(type, spot.x, spot.y, heading, params, { noHit: true });
      this.attractSpawnT = 2.6 + this.world.rnd() * 3.4;
    }
    this.missileMgr.update(d, this.world, this.player, params, this.particles, this.smokeInterval * 1.6, true);

    // Missile-vs-missile still runs so the menu gets occasional fireworks.
    const res = this.collisions.update(this.world, this.player, this.missileMgr.missiles, this.stars, this.powerups, false);
    for (const r of res.reactions) this.handleReaction(r, params, true);

    this.particles.update(d, 0, 0);
    this.floats.update(d);
    this.camera.follow(this.player.x, this.player.y, d, this.player.vx * 0.12, this.player.vy * 0.12, this.settings.reducedMotion);
    this.camera.update(d, this.settings.reducedMotion);
    this.clouds.update(d, this.camera);
  }

  /* ------------------------------------------------------------ render */

  private render(time: number): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const st = this.state;

    this.sky.renderSky(ctx, cam);
    this.clouds.renderBelow(ctx, cam);
    this.particles.render(ctx, cam);

    if (st !== GameState.MENU && st !== GameState.HANGAR && st !== GameState.UPGRADES &&
        st !== GameState.MISSIONS && st !== GameState.SETTINGS) {
      this.stars.render(ctx, cam, this.settings.quality === 'high');
      this.powerups.render(ctx, cam);
    }

    this.renderMissiles(ctx, time);
    this.player.render(ctx, cam, this.deps.progression.aircraft(), time);

    this.clouds.renderAbove(ctx, cam);

    if (st === GameState.PLAYING || st === GameState.PAUSED) {
      this.sky.renderWarnings(ctx, cam, this.player, time);
    }
    this.floats.render(ctx, cam);
    this.sky.renderEdgeGlow(ctx, cam, time);
    this.sky.renderVignette(ctx, cam);
    this.sky.renderHitFlash(ctx, cam, this.hitFlash);
  }

  private renderMissiles(ctx: CanvasRenderingContext2D, time: number): void {
    const cam = this.camera;
    for (const m of this.missileMgr.missiles) {
      if (!m.active) continue;
      if (!cam.isVisible(m.x, m.y, 34)) continue;
      const sx = cam.worldToScreenX(m.x);
      const sy = cam.worldToScreenY(m.y);
      ctx.save();
      if (m.life < 0.6) ctx.globalAlpha = clamp(m.life / 0.6, 0, 1);
      ctx.translate(sx, sy);
      ctx.rotate(m.heading);
      drawMissileBody(ctx, m, time);
      ctx.restore();

      // Spawn telegraph ring during launch.
      if (m.launchT > 0) {
        const k = m.launchT / 0.45;
        ctx.save();
        ctx.globalAlpha = k * 0.8;
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 12 + 34 * (1 - k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------ HUD */

  private updateHud(): void {
    if (!this.hud) return;
    const p = this.player;
    const s = p.stats;
    const cdTotal = s.boostCooldown + s.boostDuration;
    this.hud.update({
      time: this.world.runTime,
      score: Math.floor(this.runScore),
      best: this.deps.progression.bestScore(this.mode.id),
      coins: this.runStars,
      missiles: this.missileMgr.activeCount(),
      combo: this.combo,
      comboPct: clamp(this.comboT / COMBO_WINDOW, 0, 1),
      hp: p.hp,
      maxHp: p.maxHp,
      shieldCharges: p.shieldCharges,
      shieldMax: p.shieldMax,
      boostPct: p.boostT > 0 ? 1 : clamp(1 - p.boostCdT / cdTotal, 0, 1),
      mode: this.mode.name,
    });
  }

  /** Start/resume WebAudio from a user gesture (browser autoplay policy). */
  initAudio(): void {
    this.deps.audio.init();
  }

  /** UI-only sound cue. */
  playUiSound(name: 'click' | 'back'): void {
    this.deps.audio.play(name);
  }

  /** Current run score, read by UI if needed. */
  getScore(): number {
    return Math.floor(this.runScore);
  }

  isPlaying(): boolean {
    return this.state === GameState.PLAYING;
  }

  playerRadius(): number {
    return PLAYER_RADIUS;
  }
}

/* ---------------------------------------------------------------- helpers */

function time_since(last: number, now: number): number {
  if (last < 0) return Infinity;
  return now - last;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
