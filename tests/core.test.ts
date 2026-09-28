import { describe, expect, it } from 'vitest';
import { Camera } from '../src/game/Camera';
import { CollisionSystem } from '../src/game/CollisionSystem';
import { initMissile, updateMissile, createMissilePool } from '../src/game/Missile';
import { Player } from '../src/game/Player';
import { PowerUpSystem } from '../src/game/PowerUpSystem';
import { StarSystem } from '../src/game/StarSystem';
import { difficultyAt, World, WORLD_H, WORLD_W } from '../src/game/World';
import { angleDiff, rotateToward, wrapDelta, wrapPos } from '../src/game/util/math';
import { getAircraft } from '../src/data/aircraft';
import { computeEffectiveStats, getUpgrade, upgradeCost } from '../src/data/upgrades';
import { defaultSave, sanitizeSave, SAVE_VERSION } from '../src/systems/SaveSystem';
import { levelFromXp, ProgressionSystem, xpForLevel } from '../src/systems/ProgressionSystem';
import { EventBus } from '../src/game/Events';
import type { GameEventMap } from '../src/game/types';
import type { SaveSystem } from '../src/systems/SaveSystem';

const closeTo = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('world wrapping and camera transforms', () => {
  it('wraps positions and takes the shortest route over a seam', () => {
    expect(wrapPos(-1, 100)).toBe(99);
    expect(wrapPos(101, 100)).toBe(1);
    expect(wrapDelta(98, 100)).toBe(-2);
    expect(wrapDelta(-98, 100)).toBe(2);
  });

  it('round-trips camera coordinates across a world seam', () => {
    const cam = new Camera();
    cam.resize(900, 600);
    cam.snapTo(WORLD_W - 4, WORLD_H - 8);
    const x = 3;
    const y = 5;
    const sx = cam.worldToScreenX(x);
    const sy = cam.worldToScreenY(y);
    expect(closeTo(sx, 457)).toBe(true);
    expect(closeTo(sy, 313)).toBe(true);
    expect(cam.screenToWorldX(sx)).toBe(x);
    expect(cam.screenToWorldY(sy)).toBe(y);
  });
});

describe('missile steering and overshoot-capable turn limits', () => {
  it('limits heading change to the available turn rate', () => {
    const h = rotateToward(0, Math.PI, 0.1);
    expect(Math.abs(angleDiff(0, h))).toBeCloseTo(0.1, 5);
  });

  it('steers velocity toward a predicted target instead of teleporting its direction', () => {
    const world = new World();
    const missile = createMissilePool(1)[0];
    initMissile(missile, 1, 'standard', 100, 100, 0, 1, 1);
    const before = missile.heading;
    updateMissile(missile, 0.1, { x: 100, y: 500, vx: 0, vy: 0 }, world, 1, 1);
    expect(missile.heading).not.toBe(before);
    expect(Math.abs(angleDiff(before, missile.heading))).toBeLessThanOrEqual(missile.turn * 0.1 + 1e-6);
    expect(missile.y).toBeGreaterThan(100);
    expect(missile.vy).toBeGreaterThan(0);
  });

  it('can overshoot a close target and keep turning back toward it', () => {
    const world = new World();
    const missile = createMissilePool(1)[0];
    initMissile(missile, 1, 'fast', 400, 500, 0, 1, 1);
    let passedTarget = false;
    let registeredOvershoot = false;
    for (let i = 0; i < 42; i++) {
      updateMissile(missile, 1 / 60, { x: 500, y: 500, vx: 0, vy: 0 }, world, 1, 1);
      if (missile.x > 500 && missile.x < 900) passedTarget = true;
      if (missile.overFlag) registeredOvershoot = true;
    }
    expect(passedTarget).toBe(true);
    expect(registeredOvershoot).toBe(true);
    expect(Math.abs(missile.heading)).toBeGreaterThan(0.15);
  });

  it('allows the missile to continue through the wrap seam', () => {
    const world = new World();
    const missile = createMissilePool(1)[0];
    initMissile(missile, 1, 'fast', WORLD_W - 5, 100, 0, 1, 1);
    updateMissile(missile, 0.1, { x: 200, y: 100, vx: 0, vy: 0 }, world, 1, 1);
    expect(missile.x).toBeGreaterThanOrEqual(0);
    expect(missile.x).toBeLessThan(WORLD_W);
  });
});

describe('collision grid and chain reactions', () => {
  it('collides missiles that meet across the world seam without self-colliding ghosts', () => {
    const world = new World();
    const pool = createMissilePool(3);
    initMissile(pool[0], 1, 'standard', 2, 300, 0, 1, 1);
    initMissile(pool[1], 2, 'standard', WORLD_W - 2, 300, Math.PI, 1, 1);
    initMissile(pool[2], 3, 'standard', 800, 800, 0, 1, 1);
    const player = new Player();
    player.x = 1600;
    player.y = 1600;
    player.alive = true;
    const collisions = new CollisionSystem();
    const result = collisions.update(world, player, pool, new StarSystem(), new PowerUpSystem(), false);
    expect(result.reactions.length).toBe(1);
    expect(result.reactions[0].destroyed.length).toBe(2);
    expect(pool[0].active).toBe(false);
    expect(pool[1].active).toBe(false);
    expect(pool[2].active).toBe(true);
  });

  it('propagates an explosion into nearby missiles', () => {
    const world = new World();
    const pool = createMissilePool(4);
    initMissile(pool[0], 1, 'heavy', 500, 500, 0, 1, 1);
    initMissile(pool[1], 2, 'standard', 512, 500, Math.PI, 1, 1);
    initMissile(pool[2], 3, 'standard', 550, 500, Math.PI, 1, 1);
    initMissile(pool[3], 4, 'standard', 900, 900, 0, 1, 1);
    const player = new Player();
    player.x = 1800;
    player.y = 1600;
    const result = new CollisionSystem().update(world, player, pool, new StarSystem(), new PowerUpSystem(), false);
    expect(result.reactions.length).toBeGreaterThanOrEqual(1);
    expect(result.reactions[0].destroyed.length).toBeGreaterThanOrEqual(3);
    expect(pool.slice(0, 3).every((m) => !m.active)).toBe(true);
    expect(pool[3].active).toBe(true);
  });
});

describe('difficulty and progression math', () => {
  it('ramps difficulty continuously and unlocks missile types in stages', () => {
    const a = difficultyAt(10);
    const b = difficultyAt(30);
    const c = difficultyAt(180);
    expect(a.spawnInterval).toBeGreaterThan(b.spawnInterval);
    expect(b.speedMul).toBeLessThan(c.speedMul);
    expect(b.unlockedTypes).toBeGreaterThan(a.unlockedTypes);
    expect(c.maxActive).toBeLessThanOrEqual(44);
  });

  it('computes upgrades as real aircraft stat changes', () => {
    const base = computeEffectiveStats(getAircraft('sparrow'), {});
    const upgraded = computeEffectiveStats(getAircraft('sparrow'), { engine: 2, shield: 1, armor: 1 });
    expect(upgraded.maxSpeed).toBeCloseTo(base.maxSpeed * 1.1);
    expect(upgraded.shieldDuration).toBeCloseTo(base.shieldDuration + 0.4);
    expect(upgraded.hp).toBe(base.hp + 1);
    expect(upgradeCost(getUpgrade('engine')!, 0)).toBe(120);
    expect(upgradeCost(getUpgrade('engine')!, 1)).toBeGreaterThan(120);
  });

  it('maps XP thresholds to pilot levels', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(xpForLevel(4))).toBe(4);
    expect(levelFromXp(xpForLevel(4) - 1)).toBe(3);
  });
});

describe('run settlement and achievements', () => {
  it('awards career achievements once and persists their IDs', () => {
    const memorySave = { data: defaultSave(), save: () => undefined } as unknown as SaveSystem;
    const progression = new ProgressionSystem(memorySave, new EventBus<GameEventMap>());
    const first = progression.submitRun({
      mode: 'normal', time: 65, score: 800, missilesDestroyed: 12,
      maxChain: 5, stars: 4, shieldUsed: 0,
    });
    expect(first.newBest).toBe(true);
    expect(memorySave.data.achievements).toContain('first-sortie');
    expect(memorySave.data.achievements).toContain('sky-resident');
    expect(memorySave.data.achievements).toContain('demolition-ace');
    expect(memorySave.data.achievements).toContain('chain-master');
    expect(memorySave.data.achievements).toContain('no-bubble');
    const firstFlightAwards = first.coinsEarned;
    const second = progression.submitRun({
      mode: 'normal', time: 20, score: 120, missilesDestroyed: 0,
      maxChain: 0, stars: 0, shieldUsed: 1,
    });
    expect(memorySave.data.achievements.filter((id) => id === 'first-sortie')).toHaveLength(1);
    expect(second.coinsEarned).toBeLessThan(firstFlightAwards);
  });
});

describe('save sanitization', () => {
  it('fills missing or invalid fields from defaults without losing valid data', () => {
    const save = sanitizeSave({ version: 1, coins: '45', settings: { sound: false }, upgrades: { engine: 2, shield: 'nope' } });
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.coins).toBe(45);
    expect(save.settings.sound).toBe(false);
    expect(save.settings.music).toBe(true);
    expect(save.upgrades.engine).toBe(2);
    expect(save.upgrades.shield).toBe(0);
    expect(save.unlockedAircraft).toContain('sparrow');
    expect(save.stats.runs).toBe(0);
  });

  it('returns a default save for corrupted payloads', () => {
    expect(sanitizeSave(null)).toEqual(defaultSave());
    expect(sanitizeSave('not a save').coins).toBe(0);
  });
});
