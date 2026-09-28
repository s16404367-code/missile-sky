/**
 * Shared type definitions for the game.
 */

export type Vec2 = { x: number; y: number };

export type GameModeId = 'normal' | 'fast' | 'endless';

export type Quality = 'low' | 'medium' | 'high';

export type MissileTypeId =
  | 'standard'
  | 'fast'
  | 'heavy'
  | 'curving'
  | 'zigzag'
  | 'boomerang'
  | 'splitter'
  | 'swarm'
  | 'fragment';

export interface SettingsData {
  sound: boolean;
  music: boolean;
  vibration: boolean;
  quality: Quality;
  showJoystick: boolean;
  reducedMotion: boolean;
}

export interface MissionProgress {
  progress: number;
  completed: boolean;
}

export interface SaveData {
  version: number;
  coins: number;
  xp: number;
  /** Best score per game mode id. */
  bestScore: Record<string, number>;
  /** Best survival time (seconds) per game mode id. */
  bestTime: Record<string, number>;
  selectedAircraft: string;
  unlockedAircraft: string[];
  /** Upgrade id -> level. */
  upgrades: Record<string, number>;
  /** Mission id -> progress. */
  missions: Record<string, MissionProgress>;
  /** IDs of one-time achievements already awarded. */
  achievements: string[];
  settings: SettingsData;
  stats: {
    runs: number;
    totalMissiles: number;
    totalStars: number;
    totalTime: number;
    bestChain: number;
  };
}

/** Per-run statistics collected while playing; shown on Game Over and fed to progression. */
export interface RunStats {
  mode: GameModeId;
  time: number;
  score: number;
  missilesDestroyed: number;
  maxChain: number;
  stars: number;
  shieldUsed: number;
  coinsEarned: number;
  xpEarned: number;
  newBest: boolean;
  missionsCompleted: string[];
}

/**
 * Final gameplay stats after aircraft definition + upgrades are applied.
 * This is what the simulation actually reads.
 */
export interface EffectiveStats {
  maxSpeed: number;
  accel: number;
  turn: number;
  shieldCharges: number;
  shieldDuration: number;
  boostDuration: number;
  boostCooldown: number;
  hp: number;
  magnetRadius: number;
}

/** Payloads for the typed event bus (see Events.ts). */
export interface GameEventMap {
  MISSILE_SPAWNED: { type: MissileTypeId; x: number; y: number };
  MISSILE_COLLIDED: { x: number; y: number; chain: number };
  MISSILE_DESTROYED: { x: number; y: number; byChain: boolean; points: number };
  STAR_COLLECTED: { x: number; y: number };
  POWERUP_COLLECTED: { kind: 'shield' | 'boost'; x: number; y: number };
  PLAYER_HIT: { fatal: boolean; hpLeft: number; x: number; y: number };
  SHIELD_USED: { chargesLeft: number };
  BOOST_USED: {};
  CHAIN_STARTED: { size: number };
  CHAIN_INCREASED: { size: number; points: number };
  MISSION_PROGRESS: { id: string; progress: number; target: number };
  MISSION_COMPLETED: { id: string; title: string };
  ACHIEVEMENT_UNLOCKED: { id: string; title: string; coins: number; xp: number };
  LEVEL_UP: { level: number };
  GAME_OVER: { stats: RunStats };
}

export enum GameState {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  GAME_OVER = 'GAME_OVER',
  HANGAR = 'HANGAR',
  UPGRADES = 'UPGRADES',
  MISSIONS = 'MISSIONS',
  SETTINGS = 'SETTINGS',
}
