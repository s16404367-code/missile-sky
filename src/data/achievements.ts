/**
 * One-time career achievements, earned at run settlement. Rewards are added
 * once and the unlock IDs persist in the versioned local save.
 */

import type { RunInput } from '../systems/ProgressionSystem';
import type { SaveData } from '../game/types';

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  coins: number;
  xp: number;
  test: (run: RunInput, save: SaveData) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-sortie',
    title: 'First Sortie',
    desc: 'Complete your first flight.',
    coins: 35,
    xp: 25,
    test: (_run, save) => save.stats.runs >= 1,
  },
  {
    id: 'sky-resident',
    title: 'Sky Resident',
    desc: 'Survive for at least 60 seconds.',
    coins: 80,
    xp: 70,
    test: (run) => run.time >= 60,
  },
  {
    id: 'demolition-ace',
    title: 'Demolition Ace',
    desc: 'Destroy ten missiles in one flight.',
    coins: 90,
    xp: 75,
    test: (run) => run.missilesDestroyed >= 10,
  },
  {
    id: 'star-chaser',
    title: 'Star Chaser',
    desc: 'Collect twenty stars in one flight.',
    coins: 100,
    xp: 85,
    test: (run) => run.stars >= 20,
  },
  {
    id: 'chain-master',
    title: 'Chain Master',
    desc: 'Create a chain reaction of five or more missiles.',
    coins: 120,
    xp: 100,
    test: (run) => run.maxChain >= 5,
  },
  {
    id: 'no-bubble',
    title: 'No Bubble Needed',
    desc: 'Survive 60 seconds without using a shield.',
    coins: 130,
    xp: 110,
    test: (run) => run.time >= 60 && run.shieldUsed === 0,
  },
  {
    id: 'veteran-pilot',
    title: 'Veteran Pilot',
    desc: 'Reach pilot level five.',
    coins: 180,
    xp: 140,
    test: (_run, save) => {
      // Level 5 threshold using the same progression curve (4 × 120 × 4^0.5).
      return save.xp >= 960;
    },
  },
];
