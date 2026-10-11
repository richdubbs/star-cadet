/**
 * src/render/geom/deck.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1; SPEC 3.5.1-3.5.2 (visual height field)
 * Pure (no three): the launch ramp + raised deck as ONE height field, plus its side rails.
 *
 *   deckHeightAt(x, y, data)       surface height of the ramp / deck at a T-frame point (SPEC 3.5.2 visual height field)
 *   buildDeckMesh(data, opts)      MeshData of the surface (cells of the shell 103 clipped EXACTLY to its outline) + the rail extrusion
 *   buildDeckParts(data, opts)     the same as separate parts {surface, railInner, railTop, railOuter} + {field}
 *   getDeckField(data)             cached helper {heightAt, normalAt, shell, ...} shared with the scene code
 *
 * Height field H(x, y) (SPEC 3.5.2):
 *   inside a ramp triangle i                                   -> a_i x + b_i y + c_i                  (exact, SPEC 3.5.1)
 *   inside DECK_FLOOR_POLY (shell minus ramp footprint)         -> 1.068                                (the deck)
 *   else inside the shell (rail margins + the tongue below the low mouth)
 *        or within 0.45 of the footprint                        -> clamp(plane of the nearest triangle, 0, 1.068)
 *   else                                                       -> 1.068
 * ASSUMPTIONS:
 *  - The SPEC says "else if distance to the footprint <= 0.45 use the nearest plane, otherwise 1.068". The shell's tongue below the low mouth is
 *    up to ~0.9 long, so inside the shell anything that is not DECK_FLOOR_POLY keeps the clamped nearest plane (which is 0 at the tongue), avoiding a
 *    1.068 cliff at the mouth. Outside the shell the SPEC rule applies unchanged.
 *  - Rails (shell outline extruded outward, 0.7 above the local surface) grow out of the floor (none below 0.1, full above 0.35): the shell outline is NOT
 *    a barrier for mask-1 balls (mask 6 has no bit 1), so no wall may stand across the low mouth / tongue.
 */
import { MeshBuilder, mergeMeshData } from './meshdata.js';
import { cleanRing, pointInPolygon, polygonArea, triangulatePolygon } from './extrude.js';
import { patchUV } from '../art/mapping.js';

const DECK_RECT = Object.freeze({ xMin: 1.04, xMax: 7.65, yMin: -2.06, yMax: 7.94 });   // ART's deck patch rect (ARCHITECTURE 9.2)
const NEAR_FOOTPRINT = 0.45;
const MIN_SURFACE_Z = 0.012;      // the surface mesh is drawn at least this high (the height field itself still returns 0 on the tongue)

/** @type {WeakMap<object, any>} */
const FIELD_CACHE = new WeakMap();

function distPointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Build (and cache per data object) the helper used by deckHeightAt and the mesh builders.
 * @param {import('../../types.js').DataModule} data
 */
export function getDeckField(data) {
  const hit = FIELD_CACHE.get(data);
  if (hit) return hit;
  const ramp = data.RAMPS.ramp;
  const deckZ = data.HEIGHTS.deckSurface;
  const planes = ramp.planes.map((p) => ({ v: p.v, a: p.offset[0], b: p.offset[1], c: p.offset[2] }));
  const shellWall = data.WALLS.find((w) => w.group === 103);
  const shell = cleanRing(shellWall.pts);
  const deckPoly = data.DECK_FLOOR_POLY;
  const tol = 1e-9;
  const inTri = (x, y, v) => {
    const [a, b, c] = v;
    const d1 = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const d2 = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]);
    const d3 = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0]);
    const neg = d1 < -tol || d2 < -tol || d3 < -tol;
    const pos = d1 > tol || d2 > tol || d3 > tol;
    return !(neg && pos);
  };
  const triDist = (x, y, v) => {
    if (inTri(x, y, v)) return 0;
    return Math.min(
      distPointSegment(x, y, v[0][0], v[0][1], v[1][0], v[1][1]),
      distPointSegment(x, y, v[1][0], v[1][1], v[2][0], v[2][1]),
      distPointSegment(x, y, v[2][0], v[2][1], v[0][0], v[0][1]));
  };
  const scratch = { z: 0, gx: 0, gy: 0 };
  const field = {
    deckZ, planes, shell, deckPoly,
    /** exact ramp plane containing the point, or -1 */
    triangleAt(x, y) { for (let i = 0; i < planes.length; i++) if (inTri(x, y, planes[i].v)) return i; return -1; },
    nearestPlane(x, y) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < planes.length; i++) { const d = triDist(x, y, planes[i].v); if (d < bd) { bd = d; best = i; } }
      return { index: best, dist: bd };
    },
    inShell(x, y) { return pointInPolygon(x, y, shell); },
    /**
     * Surface height and gradient at (x, y); fills and returns `out` ({z, gx, gy}).
     * @param {number} x @param {number} y @param {{z:number,gx:number,gy:number}} [out]
     */
    sample(x, y, out = { z: 0, gx: 0, gy: 0 }) {
      for (let i = 0; i < planes.length; i++) {
        if (inTri(x, y, planes[i].v)) { const p = planes[i]; out.z = p.a * x + p.b * y + p.c; out.gx = p.a; out.gy = p.b; return out; }
      }
      if (pointInPolygon(x, y, deckPoly)) { out.z = deckZ; out.gx = 0; out.gy = 0; return out; }
      const inside = pointInPolygon(x, y, shell);
      const n = field.nearestPlane(x, y);
      if (inside || n.dist <= NEAR_FOOTPRINT) {
        const p = planes[n.index];
        const raw = p.a * x + p.b * y + p.c;
        if (raw <= 0) { out.z = 0; out.gx = 0; out.gy = 0; } else if (raw >= deckZ) { out.z = deckZ; out.gx = 0; out.gy = 0; } else { out.z = raw; out.gx = p.a; out.gy = p.b; }
        return out;
      }
      out.z = deckZ; out.gx = 0; out.gy = 0;
      return out;
    },
    /** @returns {number} surface height at (x, y) */
    heightAt(x, y) { return field.sample(x, y, scratch).z; },
    /** upward unit normal of the surface at (x, y). @returns {[number, number, number]} */
    normalAt(x, y) {
      const s = field.sample(x, y, scratch);
      const l = Math.hypot(s.gx, s.gy, 1);
      return [-s.gx / l, -s.gy / l, 1 / l];
    },
  };
  FIELD_CACHE.set(data, field);
  return field;
}

/**
 * Surface height of the launch ramp / raised deck at a T-frame point (SPEC 3.5.2 visual height field).
 * @param {number} x @param {number} y @param {import('../../types.js').DataModule} data @returns {number}
 */
export function deckHeightAt(x, y, data) { return getDeckField(data).heightAt(x, y); }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Sutherland-Hodgman clip of a (concave) polygon against an axis-aligned rectangle
// ---------------------------------------------------------------------------------------------------------------------------------------------
function clipHalf(poly, inside, intersect) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ia = inside(a), ib = inside(b);
    if (ia) { out.push(a); if (!ib) out.push(intersect(a, b)); } else if (ib) out.push(intersect(a, b));
  }
  return out;
}

/** @returns {[number,number][]} polygon clipped to [x0,x1] x [y0,y1] */
export function clipPolygonToRect(poly, x0, y0, x1, y1) {
  let p = poly;
  const ix = (xv) => (a, b) => { const t = (xv - a[0]) / (b[0] - a[0]); return [xv, a[1] + t * (b[1] - a[1])]; };
  const iy = (yv) => (a, b) => { const t = (yv - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), yv]; };
  p = clipHalf(p, (q) => q[0] >= x0, ix(x0)); if (!p.length) return p;
  p = clipHalf(p, (q) => q[0] <= x1, ix(x1)); if (!p.length) return p;
  p = clipHalf(p, (q) => q[1] >= y0, iy(y0)); if (!p.length) return p;
  p = clipHalf(p, (q) => q[1] <= y1, iy(y1));
  return p;
}

/** Liang-Barsky: does the segment touch the closed rectangle? */
function segmentTouchesRect(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

/**
 * Build the deck surface + rails as separate parts.
 * @param {import('../../types.js').DataModule} data
 * @param {{cell?:number, rect?:{xMin:number,xMax:number,yMin:number,yMax:number}, railWidth?:number, railHeight?:number, railStep?:number, slab?:number}} [opts]
 */
export function buildDeckParts(data, opts = {}) {
  const field = getDeckField(data);
  const cell = opts.cell ?? 0.1;
  const rect = opts.rect ?? DECK_RECT;
  const patch = { rect, width: 1, height: 1 };
  const railW = opts.railWidth ?? 0.26;
  const railH = opts.railHeight ?? data.HEIGHTS.rampRailAbove;
  const step = opts.railStep ?? 0.25;
  const slab = opts.slab ?? data.HEIGHTS.slabThickness;
  const shell = field.shell;

  // ------------------------------------------------------------------ surface
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of shell) { xMin = Math.min(xMin, p[0]); xMax = Math.max(xMax, p[0]); yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); }
  const i0 = Math.floor(xMin / cell), i1 = Math.ceil(xMax / cell);
  const j0 = Math.floor(yMin / cell), j1 = Math.ceil(yMax / cell);
  const boundary = new Set();
  const key = (i, j) => (i - i0) * (j1 - j0 + 2) + (j - j0);
  for (let k = 0; k < shell.length; k++) {
    const a = shell[k], b = shell[(k + 1) % shell.length];
    const ea = Math.floor(Math.min(a[0], b[0]) / cell), eb = Math.floor(Math.max(a[0], b[0]) / cell);
    const fa = Math.floor(Math.min(a[1], b[1]) / cell), fb = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let i = ea; i <= eb; i++) for (let j = fa; j <= fb; j++) {
      if (segmentTouchesRect(a[0], a[1], b[0], b[1], i * cell, j * cell, (i + 1) * cell, (j + 1) * cell)) boundary.add(key(i, j));
    }
  }
  const sb = new MeshBuilder();
  // (sx, sy) = where the height field is sampled: for vertices that lie ON the shell outline (clipped cells) the in/out classification of the
  // field is unreliable, so those are sampled a hair towards the cell interior
  const vtx = (x, y, sx = x, sy = y) => {
    const z = Math.max(field.heightAt(sx, sy), MIN_SURFACE_Z);     // never coplanar with the floor (z-fighting at the low mouth / tongue)
    const n = field.normalAt(sx, sy);
    const uv = patchUV(patch, x, y);
    return sb.vertex(x, y, z, n[0], n[1], n[2], uv[0], uv[1]);
  };
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const x0 = i * cell, y0 = j * cell, x1 = x0 + cell, y1 = y0 + cell;
      if (boundary.has(key(i, j))) {
        const clipped = clipPolygonToRect(shell, x0, y0, x1, y1);
        if (clipped.length < 3) continue;
        const { points, triangles } = triangulatePolygon(clipped);
        if (!triangles.length) continue;
        let cx = 0, cy = 0;
        for (const p of points) { cx += p[0]; cy += p[1]; }
        cx /= points.length; cy /= points.length;
        const ids = points.map((p) => vtx(p[0], p[1], p[0] + (cx - p[0]) * 0.04, p[1] + (cy - p[1]) * 0.04));
        for (let t = 0; t < triangles.length; t += 3) sb.tri(ids[triangles[t]], ids[triangles[t + 1]], ids[triangles[t + 2]]);
      } else if (pointInPolygon(x0 + cell / 2, y0 + cell / 2, shell)) {
        const a = vtx(x0, y0), b = vtx(x1, y0), c = vtx(x1, y1), d = vtx(x0, y1);
        sb.tri(a, b, c); sb.tri(a, c, d);
      }
    }
  }
  const surface = sb.build();

  // ------------------------------------------------------------------ rails (outline extruded outward, CCW ring so outward = (dy, -dx))
  const ring = shell.slice();
  if (polygonArea(ring) < 0) ring.reverse();
  const pts = [];
  let sAcc = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) { const t = k / n; pts.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, s: sAcc + len * t }); }
    sAcc += len;
  }
  const M = pts.length;
  for (let k = 0; k < M; k++) {
    const p = pts[k], pr = pts[(k + M - 1) % M], nx = pts[(k + 1) % M];
    const d1x = p.x - pr.x, d1y = p.y - pr.y, l1 = Math.hypot(d1x, d1y) || 1;
    const d2x = nx.x - p.x, d2y = nx.y - p.y, l2 = Math.hypot(d2x, d2y) || 1;
    const n1x = d1y / l1, n1y = -d1x / l1, n2x = d2y / l2, n2y = -d2x / l2;
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
    const cosHalf = mx * n1x + my * n1y;
    const sc = Math.min(1 / Math.max(cosHalf, 0.5), 2);
    p.mx = mx; p.my = my;
    p.qx = p.x + mx * railW * sc; p.qy = p.y + my * railW * sc;
    p.h = field.heightAt(p.x - mx * 0.01, p.y - my * 0.01);          // sampled a hair inside the outline (on it the in/out test is unreliable)
    const fade = Math.max(0, Math.min(1, (p.h - 0.1) / 0.25));       // rails grow out of the floor: nothing at the low mouth / tongue
    p.h = Math.max(p.h, MIN_SURFACE_Z);
    p.fade = fade;
    p.top = p.h + railH * fade;
    p.lo = Math.max(0, p.h - slab);
  }
  const ib = new MeshBuilder(), tb = new MeshBuilder(), ob = new MeshBuilder();
  const us = 0.5;
  for (let k = 0; k < M; k++) {
    const a = pts[k], b = pts[(k + 1) % M];
    const s0 = a.s, s1 = k + 1 === M ? sAcc : b.s;
    if (a.fade === 0 && b.fade === 0) continue;                      // no rail where the surface lies on the floor
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const nox = dy / l, noy = -dx / l;     // outward
    // inner face (faces the table interior)
    {
      const v0 = ib.vertex(b.x, b.y, b.h, -nox, -noy, 0, s1 * us, b.h * us);
      const v1 = ib.vertex(a.x, a.y, a.h, -nox, -noy, 0, s0 * us, a.h * us);
      const v2 = ib.vertex(a.x, a.y, a.top, -nox, -noy, 0, s0 * us, a.top * us);
      const v3 = ib.vertex(b.x, b.y, b.top, -nox, -noy, 0, s1 * us, b.top * us);
      ib.quad(v0, v1, v2, v3);
    }
    // top
    {
      const v0 = tb.vertex(a.x, a.y, a.top, 0, 0, 1, s0 * us, 0);
      const v1 = tb.vertex(a.qx, a.qy, a.top, 0, 0, 1, s0 * us, 1);
      const v2 = tb.vertex(b.qx, b.qy, b.top, 0, 0, 1, s1 * us, 1);
      const v3 = tb.vertex(b.x, b.y, b.top, 0, 0, 1, s1 * us, 0);
      tb.quad(v0, v1, v2, v3);
    }
    // outer face
    {
      const v0 = ob.vertex(a.qx, a.qy, a.lo, nox, noy, 0, s0 * us, a.lo * us);
      const v1 = ob.vertex(b.qx, b.qy, b.lo, nox, noy, 0, s1 * us, b.lo * us);
      const v2 = ob.vertex(b.qx, b.qy, b.top, nox, noy, 0, s1 * us, b.top * us);
      const v3 = ob.vertex(a.qx, a.qy, a.top, nox, noy, 0, s0 * us, a.top * us);
      ob.quad(v0, v1, v2, v3);
    }
  }
  return { field, surface, railInner: ib.build(), railTop: tb.build(), railOuter: ob.build() };
}

/**
 * The ramp + deck as one MeshData (groups: 'surface', 'railInner', 'railTop', 'railOuter'). T-frame coordinates.
 * @param {import('../../types.js').DataModule} data @param {{cell?:number}} [opts]
 * @returns {import('./meshdata.js').MeshData}
 */
export function buildDeckMesh(data, opts = {}) {
  const parts = buildDeckParts(data, opts);
  return mergeMeshData([parts.surface, parts.railInner, parts.railTop, parts.railOuter], ['surface', 'railInner', 'railTop', 'railOuter']);
}
