/**
 * SaveSystem — versioned, migration-ready localStorage persistence
 * (master plan §30, §50).
 *
 * Guarantees:
 *  - A corrupted/invalid/partial save NEVER crashes the app: everything is
 *    sanitized against defaults on load.
 *  - If localStorage is unavailable (private mode, quotas, node tests) the
 *    system silently falls back to memory.
 *  - Future save versions migrate forward via the MIGRATIONS table.
 */

import type { SaveData, SettingsData } from '../game/types';

export const SAVE_KEY = 'missile-sky-save';
export const SAVE_VERSION = 2;

export function defaultSettings(): SettingsData {
  // Respect the OS reduced-motion preference as the initial default.
  let reducedMotion = false;
  try {
    reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* ignore */
  }
  return {
    sound: true,
    music: true,
    vibration: true,
    quality: 'high',
    showJoystick: true,
    reducedMotion,
  };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    xp: 0,
    bestScore: {},
    bestTime: {},
    selectedAircraft: 'sparrow',
    unlockedAircraft: ['sparrow'],
    upgrades: {},
    missions: {},
    achievements: [],
    settings: defaultSettings(),
    stats: { runs: 0, totalMissiles: 0, totalStars: 0, totalTime: 0, bestChain: 0 },
  };
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Ordered migrations: MIGRATIONS[v] upgrades a save FROM version v TO v+1.
 * Add new entries here whenever SAVE_VERSION is bumped.
 */
export const MIGRATIONS: Record<number, Migration> = {
  // Version 1 -> 2: add one-time achievement tracking without changing any
  // existing currency, aircraft, upgrades, records, missions, or settings.
  1: (d) => {
    if (!Array.isArray(d.achievements)) d.achievements = [];
    d.version = 2;
    return d;
  },
};

export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let data = raw;
  let version = typeof data.version === 'number' ? Math.floor(data.version) : 0;
  let guard = 0;
  while (version < SAVE_VERSION && guard++ < 64) {
    const step = MIGRATIONS[version];
    if (step) {
      data = step(data) ?? data;
    }
    version++;
    data.version = version;
  }
  return data;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function strRecord(v: unknown, max = 1e9): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(v)) {
    for (const [k, val] of Object.entries(v)) {
      out[k] = num(val, 0, 0, max);
    }
  }
  return out;
}

/**
 * Deep-sanitize untrusted data against defaults.
 * Missing fields get defaults; wrong types get defaults; numbers get clamped.
 * Never throws.
 */
export function sanitizeSave(input: unknown): SaveData {
  const d = defaultSave();
  if (!isObj(input)) return d;
  const raw = migrate(input);

  d.version = SAVE_VERSION;
  d.coins = num(raw.coins, d.coins, 0, 1e9);
  d.xp = num(raw.xp, d.xp, 0, 1e12);
  d.bestScore = strRecord(raw.bestScore);
  d.bestTime = strRecord(raw.bestTime, 1e6);

  if (typeof raw.selectedAircraft === 'string' && raw.selectedAircraft) {
    d.selectedAircraft = raw.selectedAircraft;
  }
  if (Array.isArray(raw.unlockedAircraft)) {
    const arr = raw.unlockedAircraft.filter((s): s is string => typeof s === 'string' && !!s);
    d.unlockedAircraft = arr.length > 0 ? Array.from(new Set(arr)) : d.unlockedAircraft;
  }
  // The starter must always be owned & valid selection fallback.
  if (!d.unlockedAircraft.includes('sparrow')) d.unlockedAircraft.push('sparrow');
  if (!d.unlockedAircraft.includes(d.selectedAircraft)) d.selectedAircraft = 'sparrow';

  if (isObj(raw.upgrades)) {
    for (const [k, v] of Object.entries(raw.upgrades)) {
      d.upgrades[k] = Math.max(0, Math.floor(num(v, 0, 0, 99)));
    }
  }
  if (isObj(raw.missions)) {
    for (const [k, v] of Object.entries(raw.missions)) {
      if (isObj(v)) {
        d.missions[k] = {
          progress: num(v.progress, 0, 0, 1e9),
          completed: bool(v.completed, false),
        };
      }
    }
  }
  if (Array.isArray(raw.achievements)) {
    d.achievements = Array.from(new Set(raw.achievements.filter((v): v is string => typeof v === 'string' && !!v)));
  }
  if (isObj(raw.settings)) {
    const s = raw.settings;
    const def = d.settings;
    d.settings = {
      sound: bool(s.sound, def.sound),
      music: bool(s.music, def.music),
      vibration: bool(s.vibration, def.vibration),
      quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : def.quality,
      showJoystick: bool(s.showJoystick, def.showJoystick),
      reducedMotion: bool(s.reducedMotion, def.reducedMotion),
    };
  }
  if (isObj(raw.stats)) {
    const st = raw.stats;
    d.stats = {
      runs: Math.floor(num(st.runs, 0, 0, 1e9)),
      totalMissiles: Math.floor(num(st.totalMissiles, 0, 0, 1e12)),
      totalStars: Math.floor(num(st.totalStars, 0, 0, 1e12)),
      totalTime: num(st.totalTime, 0, 0, 1e9),
      bestChain: Math.floor(num(st.bestChain, 0, 0, 1e6)),
    };
  }
  return d;
}

export class SaveSystem {
  data: SaveData;
  /** False when localStorage is unavailable (memory-only fallback). */
  storageAvailable = true;

  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.data = this.read();
  }

  private read(): SaveData {
    try {
      if (typeof localStorage === 'undefined') throw new Error('no localStorage');
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      return sanitizeSave(JSON.parse(raw));
    } catch {
      this.storageAvailable = false;
      try {
        // Maybe storage exists but the payload was corrupt JSON — still salvage defaults.
        return defaultSave();
      } catch {
        return defaultSave();
      }
    }
  }

  /** Mark data dirty; writes are debounced to avoid hammering localStorage. */
  save(): void {
    this.dirty = true;
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 250);
  }

  /** Immediate synchronous write (used before page hide / reset). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      this.storageAvailable = false; // quota or access error — keep playing in memory
    }
  }

  reset(): void {
    this.data = defaultSave();
    this.dirty = true;
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    this.flush();
  }
}
