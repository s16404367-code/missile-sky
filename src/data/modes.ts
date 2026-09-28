/**
 * Game mode definitions (master plan §27).
 * NORMAL — the standard survival curve.
 * FAST — quicker spawns, faster missiles, 1.5× score.
 * ENDLESS — gentler ramp and lower swarm cap; survive as long as you can.
 * New modes can be added by appending to MODES.
 */

import type { GameModeId } from '../game/types';
import type { ModeModifiers } from '../game/World';

export interface ModeDef extends ModeModifiers {
  id: GameModeId;
  name: string;
  desc: string;
}

export const MODES: ModeDef[] = [
  {
    id: 'normal',
    name: 'NORMAL',
    desc: 'The standard survival curve. Balanced spawns, full score.',
    spawnMul: 1,
    speedMul: 1,
    rampMul: 1,
    scoreMul: 1,
    maxMissilesMul: 1,
  },
  {
    id: 'fast',
    name: 'FAST',
    desc: 'Relentless spawns and faster missiles. Score ×1.5.',
    spawnMul: 0.72,
    speedMul: 1.12,
    rampMul: 1.35,
    scoreMul: 1.5,
    maxMissilesMul: 1.1,
  },
  {
    id: 'endless',
    name: 'ENDLESS',
    desc: 'A slower burn with a lighter swarm. How long can you last? Score ×1.25.',
    spawnMul: 1.3,
    speedMul: 0.95,
    rampMul: 0.6,
    scoreMul: 1.25,
    maxMissilesMul: 0.8,
  },
];

export function getMode(id: GameModeId): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}
