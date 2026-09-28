/**
 * Persistent upgrade definitions (master plan §25).
 * Costs, caps, and the pure stat-computation function live here so they can be
 * unit tested without any DOM.
 */

import type { AircraftDef } from './aircraft';
import type { EffectiveStats } from '../game/types';

export type UpgradeId =
  | 'engine'
  | 'agility'
  | 'acceleration'
  | 'shield'
  | 'boostDuration'
  | 'boostCooldown'
  | 'armor';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  /** Human-readable effect per level. */
  effectText: string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'engine',
    name: 'ENGINE',
    desc: 'Higher top speed.',
    maxLevel: 5,
    baseCost: 120,
    costGrowth: 1.85,
    effectText: '+5% top speed / level',
  },
  {
    id: 'agility',
    name: 'AGILITY',
    desc: 'Sharper turns.',
    maxLevel: 5,
    baseCost: 140,
    costGrowth: 1.85,
    effectText: '+7% turn rate / level',
  },
  {
    id: 'acceleration',
    name: 'ACCELERATION',
    desc: 'Reach top speed faster.',
    maxLevel: 5,
    baseCost: 120,
    costGrowth: 1.85,
    effectText: '+7% acceleration / level',
  },
  {
    id: 'shield',
    name: 'SHIELD',
    desc: 'Shield bubble lasts longer.',
    maxLevel: 4,
    baseCost: 200,
    costGrowth: 1.9,
    effectText: '+0.4s shield duration / level',
  },
  {
    id: 'boostDuration',
    name: 'BOOST DURATION',
    desc: 'Longer boost bursts.',
    maxLevel: 4,
    baseCost: 150,
    costGrowth: 1.85,
    effectText: '+0.15s boost / level',
  },
  {
    id: 'boostCooldown',
    name: 'BOOST COOLDOWN',
    desc: 'Recharge boost faster.',
    maxLevel: 4,
    baseCost: 150,
    costGrowth: 1.85,
    effectText: '-0.35s cooldown / level',
  },
  {
    id: 'armor',
    name: 'ARMOR',
    desc: 'Extra hull point. Survive a direct hit.',
    maxLevel: 2,
    baseCost: 420,
    costGrowth: 2.2,
    effectText: '+1 hull point / level',
  },
];

export function getUpgrade(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

/** Cost to go from `currentLevel` to `currentLevel + 1`. Returns Infinity at max. */
export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  if (currentLevel >= def.maxLevel) return Infinity;
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** Total coins spent to reach `level` from 0 (used by tests / stats). */
export function totalCostToLevel(def: UpgradeDef, level: number): number {
  let sum = 0;
  for (let l = 0; l < Math.min(level, def.maxLevel); l++) sum += upgradeCost(def, l);
  return sum;
}

/**
 * Apply upgrade levels to an aircraft's base stats.
 * This is the ONLY place gameplay stats are derived — the simulation reads
 * its output, so every upgrade genuinely changes gameplay (master plan §25).
 */
export function computeEffectiveStats(
  aircraft: AircraftDef,
  levels: Record<string, number>,
): EffectiveStats {
  const lvl = (id: UpgradeId): number => {
    const def = getUpgrade(id);
    const raw = levels[id] ?? 0;
    if (!def) return 0;
    return Math.max(0, Math.min(def.maxLevel, Math.floor(raw)));
  };

  const b = aircraft.base;
  return {
    maxSpeed: b.maxSpeed * (1 + 0.05 * lvl('engine')),
    accel: b.accel * (1 + 0.07 * lvl('acceleration')),
    turn: b.turn * (1 + 0.07 * lvl('agility')),
    shieldCharges: b.shieldCharges,
    shieldDuration: b.shieldDuration + 0.4 * lvl('shield'),
    boostDuration: b.boostDuration + 0.15 * lvl('boostDuration'),
    boostCooldown: Math.max(1.2, b.boostCooldown - 0.35 * lvl('boostCooldown')),
    hp: b.hp + lvl('armor'),
    magnetRadius: b.magnetRadius,
  };
}
