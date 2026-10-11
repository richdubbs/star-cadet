/**
 * src/physics/world.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4.4 (edge registry + nearest hit); SPEC 4.1 (10 x 15 edge grid), 4.3 (nearest hit along a ray)
 * The edge registry. Edges are registered once (never removed; activation is the edge's own `active` flag) into a 10 x 15 uniform grid
 * over x[-8,8], y[-14,15] by bounding box. A ray query walks only the cells under the bounding box of the (short) ray segment.
 * Cell indices are CLAMPED to the grid, identically for registration and query, so edges / balls outside the table still work.
 */
import { NO_HIT, rayLine, rayCircle } from './edges.js';

const X0 = -8;
const Y0 = -14;
const W = 16;
const H = 29;
const MARGIN = 0.0035;          // ray min distance (0.002) plus slack

export class World {
  /** @param {{boxesX?:number, boxesY?:number}} [grid] */
  constructor(grid = {}) {
    this.nx = grid.boxesX || 10;
    this.ny = grid.boxesY || 15;
    this.cw = W / this.nx;
    this.ch = H / this.ny;
    /** @type {import('./edges.js').Edge[]} */
    this.edges = [];
    /** @type {import('./edges.js').Edge[][]} */
    this.cells = [];
    for (let i = 0; i < this.nx * this.ny; i++) this.cells.push([]);
    this.stamp = 0;
    /** @type {import('./edges.js').Edge|null} edge found by the last cast() */
    this.hitEdge = null;
  }

  _cx(x) {
    const c = Math.floor((x - X0) / this.cw);
    return c < 0 ? 0 : c >= this.nx ? this.nx - 1 : c;
  }

  _cy(y) {
    const c = Math.floor((y - Y0) / this.ch);
    return c < 0 ? 0 : c >= this.ny ? this.ny - 1 : c;
  }

  /** Register one edge. Its bounding box (minX..maxY) must already be set (makeLine / makeCircle do that). */
  add(edge) {
    this.edges.push(edge);
    const cx0 = this._cx(edge.minX), cx1 = this._cx(edge.maxX);
    const cy0 = this._cy(edge.minY), cy1 = this._cy(edge.maxY);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.cells[cy * this.nx + cx].push(edge);
    return edge;
  }

  addAll(list) {
    for (const e of list) this.add(e);
  }

  /**
   * Nearest hit of the ray (ox,oy) + t*(dx,dy), 0 <= t <= maxd (hits up to 0.002 behind the origin count) among ACTIVE edges whose
   * mask shares a bit with `mask` and that are not in `skip[0..skipN)`. Returns the distance (NO_HIT if none) and stores the edge
   * in this.hitEdge. Ties keep the first edge found (registration order inside a cell).
   */
  cast(ox, oy, dx, dy, maxd, mask, skip, skipN) {
    const ex = ox + dx * maxd;
    const ey = oy + dy * maxd;
    const cx0 = this._cx((ox < ex ? ox : ex) - MARGIN), cx1 = this._cx((ox > ex ? ox : ex) + MARGIN);
    const cy0 = this._cy((oy < ey ? oy : ey) - MARGIN), cy1 = this._cy((oy > ey ? oy : ey) + MARGIN);
    if (this.stamp > 1e9) { this.stamp = 0; for (const e of this.edges) e.stamp = 0; }
    const stamp = ++this.stamp;
    let best = NO_HIT;
    let hit = null;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells[cy * this.nx + cx];
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e.stamp === stamp) continue;
          e.stamp = stamp;
          if (!e.active || (e.mask & mask) === 0) continue;
          if (skipN > 0) {
            let skipped = false;
            for (let s = 0; s < skipN; s++) if (skip[s] === e) { skipped = true; break; }
            if (skipped) continue;
          }
          const d = e.k === 'line' ? rayLine(e, ox, oy, dx, dy, maxd) : rayCircle(e, ox, oy, dx, dy, maxd);
          if (d < best) { best = d; hit = e; }
        }
      }
    }
    this.hitEdge = hit;
    return best;
  }

  /** Brute-force variant over every edge (tests: proves the grid never misses a hit). Same contract as cast(). */
  castBrute(ox, oy, dx, dy, maxd, mask, skip, skipN) {
    let best = NO_HIT;
    let hit = null;
    for (const e of this.edges) {
      if (!e.active || (e.mask & mask) === 0) continue;
      if (skipN > 0) {
        let skipped = false;
        for (let s = 0; s < skipN; s++) if (skip[s] === e) { skipped = true; break; }
        if (skipped) continue;
      }
      const d = e.k === 'line' ? rayLine(e, ox, oy, dx, dy, maxd) : rayCircle(e, ox, oy, dx, dy, maxd);
      if (d < best) { best = d; hit = e; }
    }
    this.hitEdge = hit;
    return best;
  }
}
