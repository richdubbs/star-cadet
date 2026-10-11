/**
 * src/render/geom/extrude.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1
 * Pure geometry builders returning MeshData = {positions, normals, uvs, indices} in T-frame coordinates (x, y, z = height; no three import).
 *   polygonArea(pts)                      signed shoelace area (S > 0 = counter-clockwise = SOLID ISLAND, S < 0 = shell, SPEC 3.1)
 *   triangulatePolygon(pts)               ear clipping of a simple polygon of either winding (concave ok) -> {points (CCW ring), triangles}
 *   extrudePolygon(pts, z0, z1, opts)     prism: top cap (+ optional bottom cap) + side quads with outward normals; groups top/side/bottom
 *   extrudePolygonParts(...)              the same as three separate MeshData ({top, side, bottom}) so the caller can use different materials
 *   pointInPolygon(x, y, pts)             even-odd test
 *
 * opts: { capBottom = false, smooth = true, smoothAngleDeg = 35, uvScale = 0.5,
 *         uv?: (x, y, kind: 'top'|'bottom'|'side', s: number, z: number) => [u, v] }
 *   `s` is the distance along the outline (for side faces), `z` the height of the vertex. Default UV: caps = (x, y) * uvScale,
 *   sides = (s, z) * uvScale. Side normals are flat per edge, smoothed across vertices whose adjacent edges turn by less than smoothAngleDeg.
 *
 * ASSUMPTIONS: the polygon may carry a closing duplicate of its first vertex and repeated vertices; both are removed. The output
 * orientation is always CCW-from-outside regardless of the winding of the input (a shell S<0 is extruded like an island: its walls
 * face outward from the polygon interior).
 */
import { MeshBuilder, mergeMeshData } from './meshdata.js';

const AREA_EPS = 1e-12;
const SAME_EPS = 1e-9;

/** Signed shoelace area of a polygon given as [[x,y],...] (closing duplicate ignored). @returns {number} */
export function polygonArea(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Remove the closing duplicate and consecutive duplicates. @returns {[number,number][]} a new array */
export function cleanRing(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < SAME_EPS && Math.abs(q[1] - p[1]) < SAME_EPS) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < SAME_EPS && Math.abs(out[0][1] - out[out.length - 1][1]) < SAME_EPS) out.pop();
  return out;
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function cross3(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }

function inTriangle(p, a, b, c) {
  const d1 = cross3(a, b, p), d2 = cross3(b, c, p), d3 = cross3(c, a, p);
  const neg = d1 < -AREA_EPS || d2 < -AREA_EPS || d3 < -AREA_EPS;
  const pos = d1 > AREA_EPS || d2 > AREA_EPS || d3 > AREA_EPS;
  return !(neg && pos);
}

function samePt(a, b) { return Math.abs(a[0] - b[0]) < SAME_EPS && Math.abs(a[1] - b[1]) < SAME_EPS; }

/**
 * Ear-clipping triangulation of a simple polygon (either winding, concave allowed).
 * @param {[number,number][]} pts
 * @returns {{points:[number,number][], triangles:number[]}} `points` = cleaned ring re-oriented CCW; `triangles` = flat index triples into it
 *          (every triangle has positive area). Degenerate input (< 3 distinct points) gives no triangles.
 */
export function triangulatePolygon(pts) {
  const ring = cleanRing(pts);
  if (ring.length < 3) return { points: ring, triangles: [] };
  if (polygonArea(ring) < 0) ring.reverse();
  const idx = ring.map((_, i) => i);
  const tris = [];
  let guard = ring.length * ring.length + 16;
  while (idx.length > 3 && guard-- > 0) {
    const m = idx.length;
    let clipped = false;
    for (let k = 0; k < m && !clipped; k++) {
      const ia = idx[(k + m - 1) % m], ib = idx[k], ic = idx[(k + 1) % m];
      const a = ring[ia], b = ring[ib], c = ring[ic];
      if (cross3(a, b, c) <= AREA_EPS) continue;
      let ok = true;
      for (let t = 0; t < m; t++) {
        const ip = idx[t];
        if (ip === ia || ip === ib || ip === ic) continue;
        const p = ring[ip];
        if (samePt(p, a) || samePt(p, b) || samePt(p, c)) continue;
        if (inTriangle(p, a, b, c)) { ok = false; break; }
      }
      if (ok) { tris.push(ia, ib, ic); idx.splice(k, 1); clipped = true; }
    }
    if (clipped) continue;
    // no ear: drop a collinear / degenerate vertex, otherwise force-clip the sharpest convex corner so we always terminate
    let drop = -1;
    for (let k = 0; k < m; k++) {
      const a = ring[idx[(k + m - 1) % m]], b = ring[idx[k]], c = ring[idx[(k + 1) % m]];
      if (Math.abs(cross3(a, b, c)) <= AREA_EPS) { drop = k; break; }
    }
    if (drop >= 0) { idx.splice(drop, 1); continue; }
    let best = -Infinity, bk = 0;
    for (let k = 0; k < m; k++) {
      const a = ring[idx[(k + m - 1) % m]], b = ring[idx[k]], c = ring[idx[(k + 1) % m]];
      const cr = cross3(a, b, c);
      if (cr > best) { best = cr; bk = k; }
    }
    tris.push(idx[(bk + m - 1) % m], idx[bk], idx[(bk + 1) % m]);
    idx.splice(bk, 1);
  }
  if (idx.length === 3 && cross3(ring[idx[0]], ring[idx[1]], ring[idx[2]]) > AREA_EPS) tris.push(idx[0], idx[1], idx[2]);
  return { points: ring, triangles: tris };
}

/**
 * Cap (horizontal face) of a polygon at height z. `up` selects the +z (true) or -z (false) facing version.
 * @param {[number,number][]} pts @param {number} z @param {boolean} up
 * @param {(x:number,y:number,kind:string,s:number,z:number)=>[number,number]} uvFn
 */
function capMesh(pts, z, up, uvFn) {
  const { points, triangles } = triangulatePolygon(pts);
  const b = new MeshBuilder();
  const kind = up ? 'top' : 'bottom';
  for (const p of points) { const uv = uvFn(p[0], p[1], kind, 0, z); b.vertex(p[0], p[1], z, 0, 0, up ? 1 : -1, uv[0], uv[1]); }
  for (let i = 0; i < triangles.length; i += 3) {
    if (up) b.tri(triangles[i], triangles[i + 1], triangles[i + 2]);
    else b.tri(triangles[i], triangles[i + 2], triangles[i + 1]);
  }
  return b.build();
}

/**
 * Side faces of the prism between z0 and z1 over the ring (the ring is CCW so the outward normal of an edge d is (dy, -dx)/|d|).
 * @param {[number,number][]} ring CCW, cleaned
 */
function sideMesh(ring, z0, z1, uvFn, smooth, smoothCos) {
  const n = ring.length;
  const b = new MeshBuilder();
  const nrm = [];
  const len = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], c = ring[(i + 1) % n];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    nrm.push([dy / l, -dx / l]);
    len.push(l);
  }
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], c = ring[(i + 1) % n];
    const nc = nrm[i], np = nrm[(i + n - 1) % n], nn = nrm[(i + 1) % n];
    const normAt = (other) => {
      if (!smooth) return nc;
      const d = nc[0] * other[0] + nc[1] * other[1];
      if (d < smoothCos) return nc;
      const x = nc[0] + other[0], y = nc[1] + other[1];
      const l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    };
    const na = normAt(np), nb = normAt(nn);
    const s0 = s, s1 = s + len[i];
    const u00 = uvFn(a[0], a[1], 'side', s0, z0), u10 = uvFn(c[0], c[1], 'side', s1, z0);
    const u11 = uvFn(c[0], c[1], 'side', s1, z1), u01 = uvFn(a[0], a[1], 'side', s0, z1);
    const v0 = b.vertex(a[0], a[1], z0, na[0], na[1], 0, u00[0], u00[1]);
    const v1 = b.vertex(c[0], c[1], z0, nb[0], nb[1], 0, u10[0], u10[1]);
    const v2 = b.vertex(c[0], c[1], z1, nb[0], nb[1], 0, u11[0], u11[1]);
    const v3 = b.vertex(a[0], a[1], z1, na[0], na[1], 0, u01[0], u01[1]);
    b.quad(v0, v1, v2, v3);
    s = s1;
  }
  return b.build();
}

function makeUv(opts) {
  const us = opts.uvScale ?? 0.5;
  if (opts.uv) return opts.uv;
  return (x, y, kind, s, z) => (kind === 'side' ? [s * us, z * us] : [x * us, y * us]);
}

/**
 * Extrude a simple polygon as separate parts (so the caller can assign materials per part).
 * @param {[number,number][]} pts @param {number} z0 @param {number} z1 @param {object} [opts] see the file header
 * @returns {{top: import('./meshdata.js').MeshData, side: import('./meshdata.js').MeshData, bottom: import('./meshdata.js').MeshData|null}}
 */
export function extrudePolygonParts(pts, z0, z1, opts = {}) {
  const ring = cleanRing(pts);
  if (ring.length >= 3 && polygonArea(ring) < 0) ring.reverse();
  const uvFn = makeUv(opts);
  const smoothCos = Math.cos(((opts.smoothAngleDeg ?? 35) * Math.PI) / 180);
  const top = capMesh(ring, z1, true, uvFn);
  const side = ring.length >= 3 ? sideMesh(ring, z0, z1, uvFn, opts.smooth !== false, smoothCos) : capMesh([], 0, true, uvFn);
  const bottom = opts.capBottom ? capMesh(ring, z0, false, uvFn) : null;
  return { top, side, bottom };
}

/**
 * Extrude a simple polygon between z0 and z1 into one MeshData with groups 'top', 'side' and (with capBottom) 'bottom'.
 * @param {[number,number][]} pts @param {number} z0 @param {number} z1 @param {object} [opts] see the file header
 * @returns {import('./meshdata.js').MeshData}
 */
export function extrudePolygon(pts, z0, z1, opts = {}) {
  const { top, side, bottom } = extrudePolygonParts(pts, z0, z1, opts);
  const list = [top, side];
  const names = ['top', 'side'];
  if (bottom) { list.push(bottom); names.push('bottom'); }
  return mergeMeshData(list, names);
}
