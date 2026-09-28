/**
 * Aircraft definitions with original canvas-drawn vector art (master plan §24).
 *
 * All aircraft are drawn nose-first toward +x, centered on (0,0), roughly
 * 36–44 units long. `drawTopHalf` traces the UPPER outline; the renderer
 * mirrors it for perfect symmetry.
 */

import type { EffectiveStats } from '../game/types';

export interface AircraftColors {
  body: string;
  accent: string;
  glass: string;
  trail: string;
  glow: string;
}

export interface AircraftDef {
  id: string;
  name: string;
  desc: string;
  passive: string;
  /** Coin price; 0 = starter. */
  cost: number;
  /** Required player level. */
  levelReq: number;
  /** Base stats (before upgrades). */
  base: Omit<EffectiveStats, 'magnetRadius'> & { magnetRadius: number };
  colors: AircraftColors;
  /** Upper-half outline, nose → tail. Mirrored automatically. */
  outline: [number, number][];
  /** Accent stripe polygons (upper half; mirrored automatically). */
  stripes: [number, number][][];
  /** Cockpit canopy: [x, y, rx, ry]. */
  canopy: [number, number, number, number];
  /** Optional extra decoration callback (tails, pods, glow lines) in local space. */
  deco?: (ctx: CanvasRenderingContext2D, t: number, colors: AircraftColors) => void;
}

/** Effective stats with no upgrades — used by tests and UI previews. */
export function baseStats(def: AircraftDef): EffectiveStats {
  return { ...def.base };
}

export const AIRCRAFT: AircraftDef[] = [
  {
    id: 'sparrow',
    name: 'SPARROW',
    desc: 'The trusty starter trainer. Balanced in every way.',
    passive: 'No passive — pure, honest flight.',
    cost: 0,
    levelReq: 1,
    base: {
      maxSpeed: 340,
      accel: 900,
      turn: 6.6,
      shieldCharges: 1,
      shieldDuration: 2.4,
      boostDuration: 1.1,
      boostCooldown: 4.0,
      hp: 1,
      magnetRadius: 46,
    },
    colors: { body: '#f2f6fb', accent: '#3a86ff', glass: '#1d3557', trail: '#9cc7ff', glow: '#3a86ff' },
    outline: [
      [17, 0], [7, 2.4], [2, 3.3], [-3, 4.0], [-9.5, 12.5], [-12.2, 12.4],
      [-7.6, 3.7], [-13, 3.0], [-15.4, 1.2], [-16, 0],
    ],
    stripes: [
      [
        [-3.6, 4.3], [-9.2, 11.2], [-10.8, 11.0], [-5.8, 4.0],
      ],
    ],
    canopy: [6.2, 0, 3.4, 1.9],
  },
  {
    id: 'dart',
    name: 'DART',
    desc: 'A speed demon with canards. Straight lines are its love language.',
    passive: 'Boost bursts last 25% longer.',
    cost: 400,
    levelReq: 2,
    base: {
      maxSpeed: 402,
      accel: 1000,
      turn: 6.0,
      shieldCharges: 1,
      shieldDuration: 2.4,
      boostDuration: 1.4,
      boostCooldown: 3.6,
      hp: 1,
      magnetRadius: 46,
    },
    colors: { body: '#fff6e8', accent: '#f9a03f', glass: '#3d2c1e', trail: '#ffd6a5', glow: '#f9a03f' },
    outline: [
      [22, 0], [9, 1.7], [4, 2.1], [0, 2.4], [-6.8, 8.8], [-9.6, 8.7],
      [-5.4, 2.6], [-12, 2.2], [-15.8, 3.4], [-17.4, 1.6], [-17.6, 0],
    ],
    stripes: [
      [
        [1.5, 2.3], [-6.2, 7.6], [-7.8, 7.5], [-0.6, 2.2],
      ],
      [
        [12.5, 1.4], [10.2, 1.7], [9.6, 4.6], [11.2, 4.4],
      ],
    ],
    canopy: [9.4, 0, 3.0, 1.5],
    deco: (ctx, _t, c) => {
      // canard fins
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.moveTo(9.2, 1.5);
      ctx.lineTo(5.6, 4.9);
      ctx.lineTo(4.4, 4.7);
      ctx.lineTo(7.2, 1.4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(9.2, -1.5);
      ctx.lineTo(5.6, -4.9);
      ctx.lineTo(4.4, -4.7);
      ctx.lineTo(7.2, -1.4);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: 'falcon',
    name: 'FALCON',
    desc: 'Twin-tailed agility specialist. Turns on a dime.',
    passive: '+18% turn rate baked in.',
    cost: 900,
    levelReq: 3,
    base: {
      maxSpeed: 358,
      accel: 1140,
      turn: 7.8,
      shieldCharges: 1,
      shieldDuration: 2.4,
      boostDuration: 1.0,
      boostCooldown: 3.4,
      hp: 1,
      magnetRadius: 46,
    },
    colors: { body: '#e9fbf6', accent: '#06b6a4', glass: '#123f39', trail: '#99f2e0', glow: '#06b6a4' },
    outline: [
      [19, 0], [8, 2.2], [3, 2.9], [-3, 3.6], [-9.8, 13.0], [-12.6, 12.8],
      [-7.8, 4.4], [-11, 4.0], [-13, 5.6], [-15.6, 2.4], [-16.4, 0],
    ],
    stripes: [
      [
        [-3.8, 3.9], [-9.4, 11.6], [-11, 11.4], [-6, 3.7],
      ],
    ],
    canopy: [7.4, 0, 3.2, 1.7],
    deco: (ctx, _t, c) => {
      // twin tails
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.moveTo(-10.2, 2.6);
      ctx.lineTo(-12.6, 7.4);
      ctx.lineTo(-14.8, 7.0);
      ctx.lineTo(-12.6, 2.3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-10.2, -2.6);
      ctx.lineTo(-12.6, -7.4);
      ctx.lineTo(-14.8, -7.0);
      ctx.lineTo(-12.6, -2.3);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: 'aegis',
    name: 'AEGIS',
    desc: 'A flying bunker. Slower, but it shrugs off one hit and shields twice.',
    passive: 'Starts with 2 shield charges and 1 extra hull point.',
    cost: 1500,
    levelReq: 4,
    base: {
      maxSpeed: 320,
      accel: 860,
      turn: 6.2,
      shieldCharges: 2,
      shieldDuration: 2.8,
      boostDuration: 1.0,
      boostCooldown: 4.2,
      hp: 2,
      magnetRadius: 46,
    },
    colors: { body: '#dfe6ee', accent: '#5c8001', glass: '#22333b', trail: '#cfe0b0', glow: '#87b427' },
    outline: [
      [16, 0], [9, 3.2], [4, 4.2], [-2, 5.0], [-6.5, 10.0], [-10.5, 13.4],
      [-13.8, 13.2], [-12, 8.0], [-13.2, 5.6], [-16, 5.0], [-18, 2.6], [-18, 0],
    ],
    stripes: [
      [
        [-2.6, 5.2], [-9.6, 12.0], [-11.6, 11.8], [-5.2, 5.0],
      ],
      [
        [2.0, 4.2], [-1.0, 4.8], [-8.0, 4.8], [-9.0, 3.6],
      ],
    ],
    canopy: [6.6, 0, 3.4, 2.0],
    deco: (ctx, _t, c) => {
      // engine pods
      ctx.fillStyle = c.accent;
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.ellipse(-11.5, s * 6.4, 4.2, 1.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'phantom',
    name: 'PHANTOM',
    desc: 'Blended-wing prototype. Fast, agile, and it vacuum-pulls nearby stars.',
    passive: 'Star magnet (140u) + 2 shield charges + 1 extra hull point.',
    cost: 2600,
    levelReq: 6,
    base: {
      maxSpeed: 382,
      accel: 1060,
      turn: 7.2,
      shieldCharges: 2,
      shieldDuration: 2.6,
      boostDuration: 1.2,
      boostCooldown: 3.2,
      hp: 2,
      magnetRadius: 140,
    },
    colors: { body: '#e6e2f7', accent: '#7b2ff7', glass: '#241b45', trail: '#c3b1ff', glow: '#4cc9f0' },
    outline: [
      [20, 0], [12, 2.2], [5, 3.8], [-2, 5.6], [-9, 8.2], [-15, 10.6],
      [-17.6, 10.2], [-15.2, 7.2], [-12.8, 4.8], [-14.6, 3.0], [-16.6, 1.4], [-17, 0],
    ],
    stripes: [
      [
        [1.0, 5.2], [-8.4, 8.0], [-13.8, 9.8], [-14.6, 8.6], [-9.4, 6.8], [-0.4, 4.0],
      ],
    ],
    canopy: [8.6, 0, 3.6, 1.8],
    deco: (ctx, t, c) => {
      // pulsing energy line along the spine
      const pulse = 0.55 + 0.45 * Math.sin(t * 4);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = c.glow;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-14, 0);
      ctx.stroke();
      ctx.restore();
    },
  },
];

export function getAircraft(id: string): AircraftDef {
  return AIRCRAFT.find((a) => a.id === id) ?? AIRCRAFT[0];
}
