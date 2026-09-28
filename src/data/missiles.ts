/**
 * Missile type definitions (master plan §18).
 * Every type has genuinely different physics/behaviour, not just a color swap.
 * Behaviour implementations live in src/game/Missile.ts.
 */

import type { MissileTypeId } from '../game/types';

export interface MissileTypeDef {
  id: MissileTypeId;
  name: string;
  /** Base cruise speed in world units/s (before difficulty multiplier). */
  speed: number;
  /** Base turn rate in rad/s (before difficulty multiplier). */
  turn: number;
  /** Collision radius. */
  radius: number;
  /** Explosion damage radius for chain reactions. */
  blast: number;
  /** Survival time (s) at which this type starts appearing. */
  unlockTime: number;
  /** Relative spawn weight once unlocked. */
  weight: number;
  /** Lifetime in seconds before the missile fizzles out. */
  life: number;
  /** Short description shown nowhere yet, kept for future codex UI. */
  desc: string;
  colors: { body: string; accent: string; flame: string; smoke: string };
}

export const MISSILE_TYPES: Record<MissileTypeId, MissileTypeDef> = {
  standard: {
    id: 'standard',
    name: 'STANDARD',
    speed: 252,
    turn: 2.1,
    radius: 7,
    blast: 46,
    unlockTime: 0,
    weight: 10,
    life: 42,
    desc: 'Reliable homing missile. Predictable arcs, honest overshoot.',
    colors: { body: '#e8eef6', accent: '#ef476f', flame: '#ffb347', smoke: '210,215,225' },
  },
  fast: {
    id: 'fast',
    name: 'FAST',
    speed: 366,
    turn: 1.32,
    radius: 6,
    blast: 40,
    unlockTime: 15,
    weight: 7,
    life: 38,
    desc: 'Blistering speed, wide turns. Overshoots hugely — make it pay.',
    colors: { body: '#fff3c4', accent: '#f9a03f', flame: '#ffe066', smoke: '235,220,190' },
  },
  curving: {
    id: 'curving',
    name: 'CURVING',
    speed: 268,
    turn: 2.0,
    radius: 7,
    blast: 46,
    unlockTime: 30,
    weight: 6,
    life: 44,
    desc: 'Approaches on a long bending arc instead of a straight intercept.',
    colors: { body: '#d8f3f0', accent: '#2ec4b6', flame: '#7ef2e4', smoke: '200,228,225' },
  },
  zigzag: {
    id: 'zigzag',
    name: 'ZIGZAG',
    speed: 284,
    turn: 2.35,
    radius: 7,
    blast: 46,
    unlockTime: 45,
    weight: 6,
    life: 42,
    desc: 'Weaves left and right while closing. Hard to bait, easy to misjudge.',
    colors: { body: '#eaf7d4', accent: '#8ac926', flame: '#c7f464', smoke: '215,230,190' },
  },
  heavy: {
    id: 'heavy',
    name: 'HEAVY',
    speed: 212,
    turn: 2.6,
    radius: 11,
    blast: 76,
    unlockTime: 65,
    weight: 4,
    life: 52,
    desc: 'Slow, stubborn, enormous blast radius. A chain-reaction grenade.',
    colors: { body: '#c9ced6', accent: '#5c677d', flame: '#ff8c42', smoke: '170,175,185' },
  },
  splitter: {
    id: 'splitter',
    name: 'SPLITTER',
    speed: 256,
    turn: 2.0,
    radius: 8,
    blast: 44,
    unlockTime: 85,
    weight: 5,
    life: 44,
    desc: 'Bursts into three fast fragments when destroyed.',
    colors: { body: '#e9defa', accent: '#9b5de5', flame: '#c77dff', smoke: '215,200,240' },
  },
  boomerang: {
    id: 'boomerang',
    name: 'BOOMERANG',
    speed: 300,
    turn: 1.55,
    radius: 7,
    blast: 46,
    unlockTime: 105,
    weight: 4,
    life: 48,
    desc: 'Overshoots on purpose, then loops back furious and faster.',
    colors: { body: '#ffd6ea', accent: '#f15bb5', flame: '#ff8fab', smoke: '240,205,225' },
  },
  swarm: {
    id: 'swarm',
    name: 'SWARM',
    speed: 278,
    turn: 2.45,
    radius: 5.5,
    blast: 34,
    unlockTime: 130,
    weight: 4,
    life: 40,
    desc: 'Launched in packs of four. Individually weak, collectively mean.',
    colors: { body: '#ffe5d9', accent: '#ff7f50', flame: '#ffb347', smoke: '235,215,200' },
  },
  /** Internal type: fragments spawned by a destroyed splitter. Never spawned directly. */
  fragment: {
    id: 'fragment',
    name: 'FRAGMENT',
    speed: 336,
    turn: 2.2,
    radius: 5,
    blast: 30,
    unlockTime: Infinity,
    weight: 0,
    life: 9,
    desc: 'A splitter shard. Fast, short-lived, still lethal.',
    colors: { body: '#e9defa', accent: '#b185db', flame: '#c77dff', smoke: '215,200,240' },
  },
};

/** Spawnable types in unlock order (fragment excluded). */
export const SPAWNABLE_TYPES: MissileTypeId[] = [
  'standard',
  'fast',
  'curving',
  'zigzag',
  'heavy',
  'splitter',
  'boomerang',
  'swarm',
];
