/**
 * Mission definitions (master plan §28).
 * Progress is tracked per run (or best-ever for chain) via the event bus and
 * persisted by ProgressionSystem.
 */

export type MissionKind = 'survive' | 'destroy' | 'stars' | 'chain' | 'noShield';

export interface MissionDef {
  id: string;
  title: string;
  desc: string;
  kind: MissionKind;
  target: number;
  rewardCoins: number;
  rewardXp: number;
  /** For 'survive'/'noShield': evaluated against a single run's survival time. */
  unit?: string;
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'survive30',
    title: 'Warming Up',
    desc: 'Survive 30 seconds in one run.',
    kind: 'survive',
    target: 30,
    rewardCoins: 60,
    rewardXp: 40,
    unit: 's',
  },
  {
    id: 'survive60',
    title: 'Sky Resident',
    desc: 'Survive 60 seconds in one run.',
    kind: 'survive',
    target: 60,
    rewardCoins: 120,
    rewardXp: 90,
    unit: 's',
  },
  {
    id: 'survive120',
    title: 'Untouchable',
    desc: 'Survive 120 seconds in one run.',
    kind: 'survive',
    target: 120,
    rewardCoins: 300,
    rewardXp: 220,
    unit: 's',
  },
  {
    id: 'destroy10',
    title: 'Demolition Derby',
    desc: 'Destroy 10 missiles via collisions in one run.',
    kind: 'destroy',
    target: 10,
    rewardCoins: 100,
    rewardXp: 70,
  },
  {
    id: 'destroy30',
    title: 'Chaos Engineer',
    desc: 'Destroy 30 missiles via collisions in one run.',
    kind: 'destroy',
    target: 30,
    rewardCoins: 260,
    rewardXp: 180,
  },
  {
    id: 'stars20',
    title: 'Star Collector',
    desc: 'Collect 20 stars in one run.',
    kind: 'stars',
    target: 20,
    rewardCoins: 140,
    rewardXp: 100,
  },
  {
    id: 'chain5',
    title: 'Chain Reaction',
    desc: 'Trigger a CHAIN ×5 explosion.',
    kind: 'chain',
    target: 5,
    rewardCoins: 220,
    rewardXp: 150,
  },
  {
    id: 'noshield60',
    title: 'No Bubble Needed',
    desc: 'Survive 60 seconds without using a shield.',
    kind: 'noShield',
    target: 60,
    rewardCoins: 250,
    rewardXp: 170,
    unit: 's',
  },
];

export function getMission(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
