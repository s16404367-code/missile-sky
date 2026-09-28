/**
 * CollisionSystem — broad-phase spatial grid + narrow-phase wrapped circle
 * tests (master plan §16, §17, §20, §21).
 *
 * Handles, every frame:
 *   missile ↔ missile  → explosion reactions with BFS chain propagation
 *   missile ↔ player   → shield blocks / hull hits (resolved by Game)
 *   player  ↔ star     → collection
 *   player  ↔ power-up → collection
 *
 * The system is physics-only: it deactivates entities and reports what
 * happened through a reused result object; scoring/audio/particles are the
 * Game's job.
 */

import { WORLD_H, WORLD_W, type World } from './World';
import type { Missile } from './Missile';
import type { Player } from './Player';
import { PLAYER_RADIUS, SHIELD_RADIUS } from './Player';
import type { Star, StarSystem } from './StarSystem';
import type { PowerUp, PowerUpSystem } from './PowerUpSystem';

/* ------------------------------------------------------------- spatial grid */

const CELL = 96;
const COLS = Math.ceil(WORLD_W / CELL);
const ROWS = Math.ceil(WORLD_H / CELL);

export class SpatialGrid {
  private buckets: number[][] = [];
  private used: number[] = [];

  constructor() {
    for (let i = 0; i < COLS * ROWS; i++) this.buckets.push([]);
  }

  clear(): void {
    for (const k of this.used) this.buckets[k].length = 0;
    this.used.length = 0;
  }

  private put(key: number, index: number): void {
    const b = this.buckets[key];
    if (b.length === 0) this.used.push(key);
    b.push(index);
  }

  /**
   * Insert an entity. Entities near a world edge are ALSO inserted into the
   * wrapped cell on the opposite side (ghosts), so collisions across the seam
   * are detected. Duplicate pair reports are harmless — handlers are
   * idempotent because entities deactivate immediately.
   */
  insert(index: number, x: number, y: number): void {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    this.put(this.key(cx, cy), index);
    const nearL = x < CELL, nearR = x > WORLD_W - CELL;
    const nearT = y < CELL, nearB = y > WORLD_H - CELL;
    if (nearL) this.put(this.key(cx - 1, cy), index);
    if (nearR) this.put(this.key(cx + 1, cy), index);
    if (nearT) this.put(this.key(cx, cy - 1), index);
    if (nearB) this.put(this.key(cx, cy + 1), index);
    if (nearL && nearT) this.put(this.key(cx - 1, cy - 1), index);
    if (nearL && nearB) this.put(this.key(cx - 1, cy + 1), index);
    if (nearR && nearT) this.put(this.key(cx + 1, cy - 1), index);
    if (nearR && nearB) this.put(this.key(cx + 1, cy + 1), index);
  }

  private key(cx: number, cy: number): number {
    const wx = ((cx % COLS) + COLS) % COLS;
    const wy = ((cy % ROWS) + ROWS) % ROWS;
    return wy * COLS + wx;
  }

  /** Collect entity indices whose cells overlap the circle (x,y,r). */
  query(x: number, y: number, r: number, out: number[]): void {
    out.length = 0;
    const minCx = Math.floor((x - r) / CELL);
    const maxCx = Math.floor((x + r) / CELL);
    const minCy = Math.floor((y - r) / CELL);
    const maxCy = Math.floor((y + r) / CELL);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const b = this.buckets[this.key(cx, cy)];
        for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
  }

  /**
   * Iterate candidate pairs: within each used bucket plus the right / bottom /
   * diagonal neighbours (each unordered pair visited at least once).
   */
  forEachPair(cb: (a: number, b: number) => void): void {
    const offsets = [[1, 0], [-1, 1], [0, 1], [1, 1]];
    for (const k of this.used) {
      const b = this.buckets[k];
      if (b.length === 0) continue;
      const cy = Math.floor(k / COLS);
      const cx = k - cy * COLS;
      for (let i = 0; i < b.length; i++) {
        for (let j = i + 1; j < b.length; j++) cb(b[i], b[j]);
      }
      for (const [ox, oy] of offsets) {
        const nb = this.buckets[this.key(cx + ox, cy + oy)];
        if (nb.length === 0) continue;
        for (let i = 0; i < b.length; i++) {
          for (let j = 0; j < nb.length; j++) {
            if (nb !== b || j > i) cb(b[i], nb[j]);
          }
        }
      }
    }
  }
}

/* --------------------------------------------------------------- reactions */

export interface Reaction {
  x: number;
  y: number;
  /** Every missile destroyed in this reaction (chain included). */
  destroyed: Missile[];
}

export interface CollisionResult {
  reactions: Reaction[];
  /** Missiles that physically reached the player (Game resolves shield/hp). */
  playerHits: Missile[];
  shieldBlocks: Missile[];
  stars: Star[];
  powerups: PowerUp[];
}

const REACTION_POOL: Reaction[] = [];
for (let i = 0; i < 72; i++) REACTION_POOL.push({ x: 0, y: 0, destroyed: [] });

export class CollisionSystem {
  readonly grid = new SpatialGrid();
  readonly result: CollisionResult = {
    reactions: [],
    playerHits: [],
    shieldBlocks: [],
    stars: [],
    powerups: [],
  };
  private queryOut: number[] = [];
  private blastQueue: { x: number; y: number; r: number }[] = [];
  private reactionCursor = 0;
  /** Frame-stamp dedupe for grid query results (avoids per-frame Set allocs). */
  private stamp = new Int32Array(256);
  private frameId = 1;

  private nextReaction(): Reaction {
    const r = REACTION_POOL[this.reactionCursor % REACTION_POOL.length];
    this.reactionCursor++;
    r.destroyed.length = 0;
    return r;
  }

  update(
    world: World,
    player: Player,
    missiles: Missile[],
    stars: StarSystem,
    powerups: PowerUpSystem,
    playerAlive: boolean,
  ): CollisionResult {
    const res = this.result;
    res.reactions.length = 0;
    res.playerHits.length = 0;
    res.shieldBlocks.length = 0;
    res.stars.length = 0;
    res.powerups.length = 0;

    // ---- broad phase: rebuild grid ----------------------------------------
    this.grid.clear();
    for (let i = 0; i < missiles.length; i++) {
      const m = missiles[i];
      if (m.active) this.grid.insert(i, m.x, m.y);
    }

    // ---- missile ↔ missile with chain BFS ----------------------------------
    this.grid.forEachPair((a, b) => {
      const ma = missiles[a];
      const mb = missiles[b];
      if (a === b || !ma.active || !mb.active) return; // skip ghost self-pairs; already consumed
      const dx = world.deltaX(ma.x, mb.x);
      const dy = world.deltaY(ma.y, mb.y);
      const rr = ma.radius + mb.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        const reaction = this.nextReaction();
        reaction.x = ma.x + dx * 0.5;
        reaction.y = ma.y + dy * 0.5;
        ma.active = false;
        mb.active = false;
        reaction.destroyed.push(ma, mb);
        this.propagateChain(world, missiles, reaction, ma);
        this.propagateChain(world, missiles, reaction, mb);
        res.reactions.push(reaction);
      }
    });

    // ---- player interactions ------------------------------------------------
    if (playerAlive && player.alive) {
      const shielded = player.shieldT > 0;
      const invulnerable = player.invulnT > 0;
      const reach = shielded ? SHIELD_RADIUS : PLAYER_RADIUS;
      this.frameId++;
      this.grid.query(player.x, player.y, reach + 16, this.queryOut);
      for (const idx of this.queryOut) {
        if (this.stamp[idx] === this.frameId) continue; // ghost duplicate
        this.stamp[idx] = this.frameId;
        const m = missiles[idx];
        if (!m.active) continue;
        if (m.noHit) continue; // attract-mode missiles never hit
        const dx = world.deltaX(m.x, player.x);
        const dy = world.deltaY(m.y, player.y);
        const rr = reach + m.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          if (invulnerable && !shielded) continue; // blink phase: missiles pass through
          m.active = false;
          if (shielded) {
            res.shieldBlocks.push(m);
            // A shield block still triggers a (chain-capable) explosion.
            const reaction = this.nextReaction();
            reaction.x = m.x;
            reaction.y = m.y;
            reaction.destroyed.push(m);
            this.propagateChain(world, missiles, reaction, m);
            res.reactions.push(reaction);
          } else {
            res.playerHits.push(m);
          }
        }
      }

      // ---- stars + magnet ----------------------------------------------------
      const magnetR = player.stats.magnetRadius;
      for (const s of stars.stars) {
        if (!s.active) continue;
        const dx = world.deltaX(s.x, player.x);
        const dy = world.deltaY(s.y, player.y);
        const d = Math.hypot(dx, dy);
        if (magnetR > 60 && d < magnetR && d > 1) {
          // Gently vacuum the star toward the aircraft.
          const pull = 420 * (1 - d / magnetR);
          s.vx -= (dx / d) * pull * 0.016;
          s.vy -= (dy / d) * pull * 0.016;
        }
        if (d < PLAYER_RADIUS + s.radius) {
          s.active = false;
          res.stars.push(s);
        }
      }

      // ---- power-ups -----------------------------------------------------------
      for (const p of powerups.powerups) {
        if (!p.active) continue;
        const dx = world.deltaX(p.x, player.x);
        const dy = world.deltaY(p.y, player.y);
        if (dx * dx + dy * dy < (PLAYER_RADIUS + p.radius) * (PLAYER_RADIUS + p.radius)) {
          p.active = false;
          res.powerups.push(p);
        }
      }
    }

    return res;
  }

  /** BFS: an exploding missile's blast destroys neighbours, which also explode. */
  private propagateChain(world: World, missiles: Missile[], reaction: Reaction, origin: Missile): void {
    const q = this.blastQueue;
    q.length = 0;
    q.push({ x: origin.x, y: origin.y, r: origin.blast });
    let head = 0;
    while (head < q.length) {
      const e = q[head++];
      this.grid.query(e.x, e.y, e.r + 14, this.queryOut);
      for (const idx of this.queryOut) {
        const m = missiles[idx];
        if (!m.active) continue;
        const dx = world.deltaX(m.x, e.x);
        const dy = world.deltaY(m.y, e.y);
        if (dx * dx + dy * dy <= (e.r + m.radius * 0.6) * (e.r + m.radius * 0.6)) {
          m.active = false;
          reaction.destroyed.push(m);
          q.push({ x: m.x, y: m.y, r: m.blast });
        }
      }
    }
  }
}
