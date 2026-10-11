/**
 * src/physics/edges.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4.2; SPEC 4.6 (ray primitives + wall installer)
 * Runtime Edge construction and ray casts. installWall/installLine/installCircle return PlainEdge[] and reproduce
 * research/physics_data.json (same order: per vertex [corner circle, line]) - the data modules ship the pre-inflated result.
 *
 * Frame: T-frame (+x screen-LEFT, +y toward the player). A line is ONE-SIDED: it only blocks a ray travelling AGAINST its normal
 * n = (dy, -dx) (unit direction d). A circle is two-sided from outside; an origin already inside returns a non-positive distance.
 *
 * ASSUMPTIONS:
 *  - The runtime Edge is a class with a fixed field set (monomorphic hot path). Besides the contracted fields it carries
 *    x1,y1 (line end), len, cx/cy/r/rsq (circle), `gate` (rollover tag), `comp` (the owning component handler), `tag` (free integer),
 *    `stamp` and the bounding box used by the broadphase grid.
 *  - A zero-length line (len < 1e-12) is built with the direction (1,0); it can never be hit because lo === hi is a single point.
 */
import { PHYS } from '../data/constants.js';

/** distance returned for "no hit" (SPEC 4.3: d >= 1e9 means none). */
export const NO_HIT = 1e9;

const MIN_DIST = PHYS.rayMinDist;          // 0.002: hits up to this far BEHIND the origin still count
const CORNER_SCALE = PHYS.cornerScale;     // 1.001

/** One runtime collidable primitive (SPEC 4.2). */
export class Edge {
  constructor() {
    /** @type {'line'|'circle'} */ this.k = 'line';
    this.mask = 1;
    this.owner = '';
    this.role = 'wall';
    this.active = true;
    /** @type {string|null} */ this.gate = null;
    /** @type {any} */ this.comp = null;
    this.tag = 0;
    this.stamp = 0;
    // line
    this.x0 = 0; this.y0 = 0; this.x1 = 0; this.y1 = 0;
    this.dx = 0; this.dy = 0;     // unit direction
    this.nx = 0; this.ny = 0;     // (dy, -dx)
    this.len = 0;
    this.lo = 0; this.hi = 0;     // extent along x (useX) or y
    this.useX = true;
    // circle
    this.cx = 0; this.cy = 0; this.r = 0; this.rsq = 0;
    // broadphase bounding box
    this.minX = 0; this.minY = 0; this.maxX = 0; this.maxY = 0;
  }
}

/**
 * Set the geometry of an existing line edge in place (used by the flippers, which rebuild their lines every angle change).
 * @param {Edge} e
 */
export function setLine(e, x0, y0, x1, y1) {
  let dx = x1 - x0;
  let dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len > 1e-12) { dx /= len; dy /= len; } else { dx = 1; dy = 0; }
  e.k = 'line';
  e.x0 = x0; e.y0 = y0; e.x1 = x1; e.y1 = y1;
  e.len = len;
  e.useX = Math.abs(dx) >= 1e-9;
  if (!e.useX) dx = 0;
  e.dx = dx; e.dy = dy;
  e.nx = dy; e.ny = -dx;
  if (e.useX) { e.lo = Math.min(x0, x1); e.hi = Math.max(x0, x1); } else { e.lo = Math.min(y0, y1); e.hi = Math.max(y0, y1); }
  e.minX = Math.min(x0, x1); e.maxX = Math.max(x0, x1);
  e.minY = Math.min(y0, y1); e.maxY = Math.max(y0, y1);
}

/**
 * Set the geometry of an existing circle edge in place.
 * @param {Edge} e
 */
export function setCircle(e, cx, cy, r) {
  e.k = 'circle';
  e.cx = cx; e.cy = cy; e.r = r; e.rsq = r * r;
  e.minX = cx - r; e.maxX = cx + r; e.minY = cy - r; e.maxY = cy + r;
}

/** @returns {import('../types.js').Edge} */
export function makeLine(x0, y0, x1, y1, mask, owner, role = 'wall') {
  const e = new Edge();
  setLine(e, x0, y0, x1, y1);
  e.mask = mask; e.owner = owner; e.role = role;
  return e;
}

/** @returns {import('../types.js').Edge} */
export function makeCircle(cx, cy, r, mask, owner, role = 'wall') {
  const e = new Edge();
  setCircle(e, cx, cy, r);
  e.mask = mask; e.owner = owner; e.role = role;
  return e;
}

/**
 * Convert a DATA PlainEdge[] to runtime Edges (keeps `role` and the rollover `gate` tag). The line direction and normal are
 * recomputed from the end points (the rounded nx,ny of the data are not used).
 * @returns {import('../types.js').Edge[]}
 */
export function edgesFromPlain(plain, mask, owner) {
  const out = [];
  for (const p of plain || []) {
    const e = p.k === 'circle'
      ? makeCircle(p.cx, p.cy, p.r, mask, owner, p.role || 'wall')
      : makeLine(p.x0, p.y0, p.x1, p.y1, mask, owner, p.role || 'wall');
    if (p.gate) e.gate = p.gate;
    out.push(e);
  }
  return out;
}

/**
 * Distance along the unit ray (ox,oy)+t(dx,dy) to a one-sided line edge, or NO_HIT. SPEC 4.6:
 * hit iff dot(dir, n) < 0 and -0.002 <= t <= maxDist and the hit point lies inside the segment extent.
 */
export function rayLine(edge, ox, oy, dx, dy, maxDist) {
  const denom = dx * edge.dy - dy * edge.dx;           // dot(ray, n), n = (dy, -dx)
  if (!(denom < 0)) return NO_HIT;
  const t = (edge.dx * (oy - edge.y0) - edge.dy * (ox - edge.x0)) / denom;   // cross(d, O - P0) / denom
  if (t < -MIN_DIST || t > maxDist) return NO_HIT;
  const c = edge.useX ? ox + t * dx : oy + t * dy;
  return (c >= edge.lo && c <= edge.hi) ? t : NO_HIT;
}

/**
 * Distance along the unit ray to a circle edge (two-sided from outside), or NO_HIT. An origin already inside the circle returns
 * `tca - sqrt(...)` which is <= 0 (immediate collision). SPEC 4.6.
 */
export function rayCircle(edge, ox, oy, dx, dy, maxDist) {
  const lx = edge.cx - ox;
  const ly = edge.cy - oy;
  const tca = lx * dx + ly * dy;
  if (tca < 0) return NO_HIT;
  const lm = lx * lx + ly * ly;
  const thc = edge.rsq - lm + tca * tca;
  if (lm < edge.rsq) return tca - Math.sqrt(thc > 0 ? thc : 0);
  if (thc < 0) return NO_HIT;
  const t0 = tca - Math.sqrt(thc);
  if (t0 < 0 || t0 > maxDist) return NO_HIT;
  return t0;
}

/** One shifted line as PlainEdge. */
function shiftedLine(x0, y0, x1, y1, offset) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len;
  const ny = -dx / len;
  return { k: 'line', x0: x0 + nx * offset, y0: y0 + ny * offset, x1: x1 + nx * offset, y1: y1 + ny * offset, nx, ny };
}

/**
 * Closed polygon (DAT order, closing duplicate removed, >= 3 vertices) inflated by `offset` (SPEC 4.6): per vertex
 * [corner circle (iff offset != 0 and sign(cross(v - prev, next - v)) == sign(offset), radius offset*1.001), line v -> next shifted by offset].
 * @param {[number, number][]} pts
 * @param {number} offset
 * @returns {import('../types.js').PlainEdge[]}
 */
export function installWall(pts, offset) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n];
    const v = pts[i];
    const q = pts[(i + 1) % n];
    if (offset !== 0) {
      const cross = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]);
      if (Math.sign(cross) === Math.sign(offset)) out.push({ k: 'circle', cx: v[0], cy: v[1], r: offset * CORNER_SCALE });
    }
    out.push(shiftedLine(v[0], v[1], q[0], q[1], offset));
  }
  return out;
}

/** Single line (code 2) shifted by offset along its normal. @returns {import('../types.js').PlainEdge[]} */
export function installLine(p0, p1, offset) {
  return [shiftedLine(p0[0], p0[1], p1[0], p1[1], offset)];
}

/** Circle (code 1) of radius r + offset. @returns {import('../types.js').PlainEdge[]} */
export function installCircle(c, r, offset) {
  return [{ k: 'circle', cx: c[0], cy: c[1], r: r + offset }];
}
