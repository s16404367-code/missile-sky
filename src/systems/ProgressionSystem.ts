/**
 * ProgressionSystem — coins, XP, levels, aircraft unlocks, upgrades and
 * mission evaluation (master plan §28, §29).
 *
 * Pure-ish logic on top of SaveSystem; emits events for UI/audio feedback.
 */

import type { SaveSystem } from './SaveSystem';
import type { EventBus } from '../game/Events';
import type { EffectiveStats, GameEventMap, GameModeId, RunStats } from '../game/types';
import { computeEffectiveStats, getUpgrade, upgradeCost } from '../data/upgrades';
import { getAircraft, type AircraftDef } from '../data/aircraft';
import { MISSIONS } from '../data/missions';
import { ACHIEVEMENTS } from '../data/achievements';

/** Cumulative XP required to REACH a level. Level 1 starts at 0 XP. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(120 * Math.pow(level - 1, 1.5));
}

export function levelFromXp(xp: number): number {
  const x = Math.max(0, Math.floor(xp));
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= x) lvl++;
  return lvl;
}

export interface RunInput {
  mode: GameModeId;
  time: number;
  score: number;
  missilesDestroyed: number;
  maxChain: number;
  stars: number;
  shieldUsed: number;
}

export class ProgressionSystem {
  constructor(
    private save: SaveSystem,
    private events: EventBus<GameEventMap>,
  ) {}

  get data() {
    return this.save.data;
  }

  get level(): number {
    return levelFromXp(this.save.data.xp);
  }

  /** XP progress within the current level, for UI bars. */
  xpProgress(): { current: number; needed: number; pct: number } {
    const lvl = this.level;
    const base = xpForLevel(lvl);
    const next = xpForLevel(lvl + 1);
    const cur = this.save.data.xp - base;
    const need = Math.max(1, next - base);
    return { current: cur, needed: need, pct: Math.min(1, cur / need) };
  }

  aircraft(): AircraftDef {
    return getAircraft(this.save.data.selectedAircraft);
  }

  /** The stats the simulation actually uses (aircraft base + upgrades). */
  effectiveStats(): EffectiveStats {
    return computeEffectiveStats(this.aircraft(), this.save.data.upgrades);
  }

  addCoins(n: number): void {
    this.save.data.coins = Math.max(0, Math.floor(this.save.data.coins + n));
    this.save.save();
  }

  addXp(n: number): void {
    const before = this.level;
    this.save.data.xp = Math.max(0, Math.floor(this.save.data.xp + n));
    if (this.level > before) {
      this.events.emit('LEVEL_UP', { level: this.level });
    }
    this.save.save();
  }

  /* ---------------- aircraft ---------------- */

  canUnlock(def: AircraftDef): { ok: boolean; reason: string } {
    const d = this.save.data;
    if (d.unlockedAircraft.includes(def.id)) return { ok: false, reason: 'Already owned' };
    if (this.level < def.levelReq) return { ok: false, reason: `Requires level ${def.levelReq}` };
    if (d.coins < def.cost) return { ok: false, reason: `Need ${def.cost - d.coins} more coins` };
    return { ok: true, reason: '' };
  }

  unlockAircraft(id: string): boolean {
    const def = getAircraft(id);
    const check = this.canUnlock(def);
    if (!check.ok) return false;
    const d = this.save.data;
    d.coins -= def.cost;
    if (!d.unlockedAircraft.includes(id)) d.unlockedAircraft.push(id);
    d.selectedAircraft = id;
    this.save.save();
    return true;
  }

  selectAircraft(id: string): boolean {
    const d = this.save.data;
    if (!d.unlockedAircraft.includes(id)) return false;
    d.selectedAircraft = id;
    this.save.save();
    return true;
  }

  owns(id: string): boolean {
    return this.save.data.unlockedAircraft.includes(id);
  }

  /* ---------------- upgrades ---------------- */

  upgradeLevel(id: string): number {
    return this.save.data.upgrades[id] ?? 0;
  }

  costFor(id: string): number {
    const def = getUpgrade(id);
    if (!def) return Infinity;
    return upgradeCost(def, this.upgradeLevel(id));
  }

  buyUpgrade(id: string): boolean {
    const def = getUpgrade(id);
    if (!def) return false;
    const lvl = this.upgradeLevel(id);
    const cost = upgradeCost(def, lvl);
    if (lvl >= def.maxLevel) return false;
    if (this.save.data.coins < cost) return false;
    this.save.data.coins -= cost;
    this.save.data.upgrades[id] = lvl + 1;
    this.save.save();
    return true;
  }

  /* ---------------- run settlement ---------------- */

  /**
   * Called once when a run ends. Awards coins/XP, updates bests and lifetime
   * stats, evaluates missions, persists everything, and returns the full
   * RunStats for the Game Over screen.
   */
  submitRun(input: RunInput): RunStats {
    const d = this.save.data;
    const score = Math.max(0, Math.floor(input.score));
    const time = Math.max(0, input.time);

    const prevBest = d.bestScore[input.mode] ?? 0;
    const newBest = score > prevBest;
    if (newBest) d.bestScore[input.mode] = score;
    d.bestTime[input.mode] = Math.max(d.bestTime[input.mode] ?? 0, Math.floor(time));

    // Gameplay rewards.
    let coinsEarned = input.stars + Math.floor(input.missilesDestroyed / 4) + Math.floor(time / 30) * 2;
    let xpEarned = Math.floor(score / 10) + Math.floor(time);

    // Lifetime stats.
    d.stats.runs += 1;
    d.stats.totalMissiles += input.missilesDestroyed;
    d.stats.totalStars += input.stars;
    d.stats.totalTime += time;
    d.stats.bestChain = Math.max(d.stats.bestChain, input.maxChain);

    // Missions.
    const missionsCompleted: string[] = [];
    for (const m of MISSIONS) {
      const p = d.missions[m.id] ?? { progress: 0, completed: false };
      if (p.completed) continue;
      switch (m.kind) {
        case 'survive':
          p.progress = Math.max(p.progress, time);
          break;
        case 'destroy':
          p.progress = Math.max(p.progress, input.missilesDestroyed);
          break;
        case 'stars':
          p.progress = Math.max(p.progress, input.stars);
          break;
        case 'chain':
          p.progress = Math.max(p.progress, input.maxChain);
          break;
        case 'noShield':
          if (input.shieldUsed === 0) p.progress = Math.max(p.progress, time);
          break;
      }
      this.events.emit('MISSION_PROGRESS', { id: m.id, progress: Math.min(m.target, p.progress), target: m.target });
      if (p.progress >= m.target) {
        p.completed = true;
        coinsEarned += m.rewardCoins;
        xpEarned += m.rewardXp;
        missionsCompleted.push(m.id);
        this.events.emit('MISSION_COMPLETED', { id: m.id, title: m.title });
      }
      d.missions[m.id] = p;
    }

    // One-time career achievements. Include this run's base/missions XP when
    // evaluating level-based milestones, then add the achievement reward.
    const achievementView = { ...d, xp: d.xp + xpEarned };
    for (const a of ACHIEVEMENTS) {
      if (d.achievements.includes(a.id) || !a.test(input, achievementView)) continue;
      d.achievements.push(a.id);
      coinsEarned += a.coins;
      xpEarned += a.xp;
      this.events.emit('ACHIEVEMENT_UNLOCKED', {
        id: a.id, title: a.title, coins: a.coins, xp: a.xp,
      });
    }

    d.coins = Math.max(0, d.coins + coinsEarned);
    const before = this.level;
    d.xp = Math.max(0, d.xp + xpEarned);

    this.save.save();
    if (this.level > before) {
      this.events.emit('LEVEL_UP', { level: this.level });
    }

    return {
      ...input,
      score,
      time,
      coinsEarned,
      xpEarned,
      newBest,
      missionsCompleted,
    };
  }

  bestScore(mode: GameModeId): number {
    return this.save.data.bestScore[mode] ?? 0;
  }

  bestTime(mode: GameModeId): number {
    return this.save.data.bestTime[mode] ?? 0;
  }

  resetProgress(): void {
    this.save.reset();
  }
}
