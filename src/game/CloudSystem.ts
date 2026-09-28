/**
 * CloudSystem — the MOVING SKY (master plan §11, §41).
 *
 * Five depth layers driven by REAL camera position (not constant scrolling):
 *   4. distant terrain islands   (parallax 0.10)
 *   3. far haze clouds           (parallax 0.32)
 *   2. medium clouds             (parallax 0.60)
 *   1. near clouds               (parallax 0.95)
 *   +  wisps that drift OVER the aircraft (parallax 1.08)
 *   +  atmospheric speed streaks (screen space, driven by camera velocity)
 *
 * Cloud sprites are procedurally pre-rendered once into offscreen canvases,
 * then blitted — cheap enough for 60 FPS on phones.
 */

import type { Camera } from './Camera';
import { mulberry32, wrapPos } from './util/math';

interface CloudBlob {
  /** Base position inside the layer tile. */
  x: number;
  y: number;
  sprite: number;
  scale: number;
  alpha: number;
  /** Slow independent drift. */
  dx: number;
  dy: number;
}

interface Layer {
  parallax: number;
  tile: number;
  blobs: CloudBlob[];
  /** Draw above gameplay entities (wisps). */
  onTop?: boolean;
}

const SPRITE = 220; // sprite canvas size in px

function makeCloudSprite(seed: number, puffiness: number, r: number, g: number, b: number, soft: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SPRITE;
  c.height = SPRITE;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  const puffs = 5 + Math.floor(rnd() * 4 * puffiness);
  for (let i = 0; i < puffs; i++) {
    const px = SPRITE * (0.25 + rnd() * 0.5);
    const py = SPRITE * (0.35 + rnd() * 0.35);
    const pr = SPRITE * (0.14 + rnd() * 0.2) * (i === 0 ? 1.25 : 1);
    const grad = ctx.createRadialGradient(px, py, 0, px, py, pr);
    grad.addColorStop(0, `rgba(${r},${g},${b},${0.85 * soft})`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},${0.42 * soft})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function makeTerrainSprite(seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SPRITE;
  c.height = SPRITE;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  // Faint far-below landmass: soft irregular blob, muted blue-green.
  const cx = SPRITE / 2;
  const cy = SPRITE / 2;
  const pts: [number, number][] = [];
  const n = 9 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = SPRITE * (0.16 + rnd() * 0.16);
    pts.push([cx + Math.cos(a) * rad * (1.3 + rnd() * 0.4), cy + Math.sin(a) * rad]);
  }
  ctx.filter = 'blur(6px)';
  ctx.fillStyle = 'rgba(88,116,110,0.5)';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    ctx.quadraticCurveTo(prev[0], prev[1], (prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(122,148,120,0.42)';
  ctx.beginPath();
  ctx.ellipse(cx + 8, cy - 4, SPRITE * 0.12, SPRITE * 0.07, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = 'none';
  return c;
}

interface AtmosDot {
  x: number;
  y: number;
  size: number;
  alpha: number;
}

export class CloudSystem {
  private layers: Layer[] = [];
  private sprites: HTMLCanvasElement[] = [];
  private terrainSprites: HTMLCanvasElement[] = [];
  private atmos: AtmosDot[] = [];
  private prevTravelX = 0;
  private prevTravelY = 0;
  private camDeltaX = 0;
  private camDeltaY = 0;
  private initialized = false;

  /** (Re)build sprites & blobs. `quality` scales blob counts. */
  init(viewW: number, viewH: number, quality: 'low' | 'medium' | 'high'): void {
    const q = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
    this.sprites = [
      makeCloudSprite(11, 1.0, 255, 255, 255, 1.0),
      makeCloudSprite(22, 0.8, 252, 253, 255, 1.0),
      makeCloudSprite(33, 1.2, 244, 248, 255, 0.9),
      makeCloudSprite(44, 0.9, 235, 242, 252, 0.8), // far, bluish
      makeCloudSprite(55, 1.1, 224, 234, 248, 0.6), // haze
    ];
    this.terrainSprites = [makeTerrainSprite(66), makeTerrainSprite(77), makeTerrainSprite(88)];

    const rnd = mulberry32(20260928);
    const def: { parallax: number; tile: number; count: number; alpha: number; scale: [number, number]; sprite: number[]; onTop?: boolean }[] = [
      { parallax: 0.1, tile: 2600, count: Math.round(6 * q) + 2, alpha: 0.5, scale: [0.9, 1.7], sprite: [0] }, // terrain (uses terrainSprites)
      { parallax: 0.32, tile: 2200, count: Math.round(9 * q) + 3, alpha: 0.55, scale: [1.3, 2.1], sprite: [4, 3] },
      { parallax: 0.6, tile: 1800, count: Math.round(10 * q) + 3, alpha: 0.8, scale: [0.9, 1.5], sprite: [3, 2] },
      { parallax: 0.95, tile: 1500, count: Math.round(9 * q) + 2, alpha: 0.95, scale: [0.6, 1.1], sprite: [0, 1, 2] },
      { parallax: 1.08, tile: 1500, count: Math.round(3 * q) + 1, alpha: 0.34, scale: [1.5, 2.3], sprite: [1], onTop: true },
    ];

    this.layers = def.map((d, li) => {
      // Tile must comfortably cover the screen so ±1 copies always suffice.
      const tile = Math.max(d.tile, Math.max(viewW, viewH) + 400);
      const blobs: CloudBlob[] = [];
      const isTerrain = li === 0;
      for (let i = 0; i < d.count; i++) {
        blobs.push({
          x: rnd() * tile,
          y: rnd() * tile,
          sprite: isTerrain
            ? Math.floor(rnd() * this.terrainSprites.length)
            : d.sprite[Math.floor(rnd() * d.sprite.length)],
          scale: d.scale[0] + rnd() * (d.scale[1] - d.scale[0]),
          alpha: d.alpha * (0.75 + rnd() * 0.5),
          dx: (rnd() * 2 - 1) * (isTerrain ? 0.4 : 2.2),
          dy: (rnd() * 2 - 1) * (isTerrain ? 0.3 : 1.4),
        });
      }
      return { parallax: d.parallax, tile, blobs, onTop: d.onTop };
    });

    // Atmospheric speed streaks (screen space).
    const nAtmos = quality === 'low' ? 18 : quality === 'medium' ? 30 : 44;
    this.atmos = [];
    for (let i = 0; i < nAtmos; i++) {
      this.atmos.push({
        x: rnd() * viewW,
        y: rnd() * viewH,
        size: 0.8 + rnd() * 1.6,
        alpha: 0.14 + rnd() * 0.3,
      });
    }
    this.initialized = true;
  }

  /** Reset screen-space streak history after a camera snap/teleport. */
  resetMotion(cam: Camera): void {
    this.prevTravelX = cam.travelX;
    this.prevTravelY = cam.travelY;
    this.camDeltaX = 0;
    this.camDeltaY = 0;
  }

  update(dt: number, cam: Camera): void {
    if (!this.initialized) return;
    // Unwrapped camera travel drives streaks seamlessly across world seams.
    this.camDeltaX = cam.travelX - this.prevTravelX;
    this.camDeltaY = cam.travelY - this.prevTravelY;
    // Ignore any deliberate camera snap (new run / reset), not ordinary travel.
    if (Math.abs(this.camDeltaX) > 320 || Math.abs(this.camDeltaY) > 320) {
      this.camDeltaX = 0;
      this.camDeltaY = 0;
    }
    this.prevTravelX = cam.travelX;
    this.prevTravelY = cam.travelY;

    // Slow independent cloud drift inside each tile.
    for (const layer of this.layers) {
      const T = layer.tile;
      for (const b of layer.blobs) {
        b.x = wrapPos(b.x + b.dx * dt, T);
        b.y = wrapPos(b.y + b.dy * dt, T);
      }
    }

    // Atmosphere dots stream opposite to camera movement.
    const k = 1.15;
    for (const a of this.atmos) {
      a.x -= this.camDeltaX * k;
      a.y -= this.camDeltaY * k;
      if (a.x < -8) a.x += cam.viewW + 16;
      else if (a.x > cam.viewW + 8) a.x -= cam.viewW + 16;
      if (a.y < -8) a.y += cam.viewH + 16;
      else if (a.y > cam.viewH + 8) a.y -= cam.viewH + 16;
    }
  }

  /** Render layers below gameplay (terrain → far → mid → near). */
  renderBelow(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (!this.initialized) return;
    for (const layer of this.layers) {
      if (layer.onTop) continue;
      this.renderLayer(ctx, cam, layer, layer === this.layers[0]);
    }
  }

  /** Render wisp layers above gameplay entities. */
  renderAbove(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (!this.initialized) return;
    for (const layer of this.layers) {
      if (layer.onTop) this.renderLayer(ctx, cam, layer, false);
    }
    this.renderAtmos(ctx, cam);
  }

  private renderLayer(ctx: CanvasRenderingContext2D, cam: Camera, layer: Layer, terrain: boolean): void {
    const T = layer.tile;
    const ox = wrapPos(cam.travelX * layer.parallax, T);
    const oy = wrapPos(cam.travelY * layer.parallax, T);
    const vw = cam.viewW;
    const vh = cam.viewH;
    const sprites = terrain ? this.terrainSprites : this.sprites;

    for (const b of layer.blobs) {
      const spr = sprites[b.sprite % sprites.length];
      const w = SPRITE * b.scale;
      // Position within tile relative to camera offset, then test 3×3 copies.
      const baseX = b.x - ox;
      const baseY = b.y - oy;
      for (let tx = -1; tx <= 1; tx++) {
        for (let ty = -1; ty <= 1; ty++) {
          const sx = baseX + tx * T;
          const sy = baseY + ty * T;
          if (sx + w / 2 < -40 || sx - w / 2 > vw + 40 || sy + w / 2 < -40 || sy - w / 2 > vh + 40) continue;
          ctx.globalAlpha = Math.min(1, b.alpha);
          ctx.drawImage(spr, sx - w / 2, sy - w / 2, w, w);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderAtmos(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const speed = Math.hypot(this.camDeltaX, this.camDeltaY);
    if (speed < 0.4) return;
    const streak = Math.min(26, speed * 1.4);
    const nx = speed > 0 ? this.camDeltaX / speed : 0;
    const ny = speed > 0 ? this.camDeltaY / speed : 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const a of this.atmos) {
      ctx.globalAlpha = a.alpha * Math.min(1, speed / 6);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + nx * streak * a.size, a.y + ny * streak * a.size);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
