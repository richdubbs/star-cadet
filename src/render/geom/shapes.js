/**
 * src/render/geom/shapes.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 (pure geometry helpers; additive module). No three import; MeshData in T-frame coordinates (z = height).
 * Small parametric solids used by the scene builders: cylinders/cones, discs, rings, oriented boxes, horizontal tubes, the tapered-capsule flipper
 * outline, regular polygons. Every builder returns MeshData with unit normals, CCW-from-outside winding and sensible UVs.
 *
 * ASSUMPTIONS: UVs of caps are planar (x - cx, y - cy) / (2 r) + 0.5, of cylinder sides (angle / 2pi * uRepeat, height * vScale); boxes map each face to
 * 0..1 x 0..1 (so a tile texture lands once per face unless a scale is given). The flipper top UV runs u along the long axis (pivot = 0, tip = 1).
 */
import { MeshBuilder, mergeMeshData, placeMeshData } from './meshdata.js';
import { extrudePolygonParts, cleanRing, polygonArea } from './extrude.js';

const TAU = Math.PI * 2;

/**
 * Cylinder / truncated cone about the vertical axis.
 * @param {{cx:number, cy:number, r:number, rTop?:number, z0:number, z1:number, segments?:number, capTop?:boolean, capBottom?:boolean, uRepeat?:number, vScale?:number}} o
 * @returns {import('./meshdata.js').MeshData}
 */
export function cylinderMesh(o) {
  const seg = o.segments ?? 16;
  const rTop = o.rTop ?? o.r;
  const uRep = o.uRepeat ?? 1, vs = o.vScale ?? 1;
  const b = new MeshBuilder();
  const h = o.z1 - o.z0;
  const slope = (o.r - rTop) / (h || 1);                      // outward tilt of the side normal
  const nz = slope / Math.hypot(1, slope), nr = 1 / Math.hypot(1, slope);
  const ring0 = [], ring1 = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
    ring0.push(b.vertex(o.cx + c * o.r, o.cy + s * o.r, o.z0, c * nr, s * nr, nz, (i / seg) * uRep, 0));
    ring1.push(b.vertex(o.cx + c * rTop, o.cy + s * rTop, o.z1, c * nr, s * nr, nz, (i / seg) * uRep, h * vs));
  }
  for (let i = 0; i < seg; i++) b.quad(ring0[i], ring0[i + 1], ring1[i + 1], ring1[i]);
  if (o.capTop !== false && rTop > 0) {
    const c = b.vertex(o.cx, o.cy, o.z1, 0, 0, 1, 0.5, 0.5);
    const rim = [];
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU; rim.push(b.vertex(o.cx + Math.cos(a) * rTop, o.cy + Math.sin(a) * rTop, o.z1, 0, 0, 1, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2)); }
    for (let i = 0; i < seg; i++) b.tri(c, rim[i], rim[i + 1]);
  }
  if (o.capBottom) {
    const c = b.vertex(o.cx, o.cy, o.z0, 0, 0, -1, 0.5, 0.5);
    const rim = [];
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU; rim.push(b.vertex(o.cx + Math.cos(a) * o.r, o.cy + Math.sin(a) * o.r, o.z0, 0, 0, -1, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2)); }
    for (let i = 0; i < seg; i++) b.tri(c, rim[i + 1], rim[i]);
  }
  return b.build();
}

/**
 * Flat disc (decal) at height z facing up (or down).
 * @param {{cx:number, cy:number, r:number, z:number, segments?:number, up?:boolean}} o @returns {import('./meshdata.js').MeshData}
 */
export function discMesh(o) {
  const seg = o.segments ?? 24;
  const up = o.up !== false;
  const b = new MeshBuilder();
  const c = b.vertex(o.cx, o.cy, o.z, 0, 0, up ? 1 : -1, 0.5, 0.5);
  const rim = [];
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU; rim.push(b.vertex(o.cx + Math.cos(a) * o.r, o.cy + Math.sin(a) * o.r, o.z, 0, 0, up ? 1 : -1, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2)); }
  for (let i = 0; i < seg; i++) { if (up) b.tri(c, rim[i], rim[i + 1]); else b.tri(c, rim[i + 1], rim[i]); }
  return b.build();
}

/**
 * Flat ring (annulus) at height z, facing up.
 * @param {{cx:number, cy:number, r0:number, r1:number, z:number, segments?:number}} o @returns {import('./meshdata.js').MeshData}
 */
export function annulusMesh(o) {
  const seg = o.segments ?? 32;
  const b = new MeshBuilder();
  const a0 = [], a1 = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
    a0.push(b.vertex(o.cx + c * o.r0, o.cy + s * o.r0, o.z, 0, 0, 1, i / seg, 0));
    a1.push(b.vertex(o.cx + c * o.r1, o.cy + s * o.r1, o.z, 0, 0, 1, i / seg, 1));
  }
  for (let i = 0; i < seg; i++) b.quad(a0[i], a1[i], a1[i + 1], a0[i + 1]);
  return b.build();
}

/**
 * Flat rectangle at height z facing up, centred at (cx, cy), `w` along local x and `h` along local y, rotated CCW by `rot`.
 * UV: u along local x, v along local y (0..1).
 * @param {{cx:number, cy:number, z:number, w:number, h:number, rot?:number}} o @returns {import('./meshdata.js').MeshData}
 */
export function quadMesh(o) {
  const b = new MeshBuilder();
  const hw = o.w / 2, hh = o.h / 2;
  const a = b.vertex(-hw, -hh, 0, 0, 0, 1, 0, 0), c = b.vertex(hw, -hh, 0, 0, 0, 1, 1, 0);
  const d = b.vertex(hw, hh, 0, 0, 0, 1, 1, 1), e = b.vertex(-hw, hh, 0, 0, 0, 1, 0, 1);
  b.quad(a, c, d, e);
  return placeMeshData(b.build(), { x: o.cx, y: o.cy, z: o.z, rot: o.rot || 0 });
}

/**
 * Oriented box: `w` along local x, `d` along local y, from z0 to z1, centred at (cx, cy), rotated CCW by `rot`. Each face has UV 0..1 x 0..1
 * (scaled by `uv = [su, sv]`). `bottom: false` omits the underside. Groups (one per face, 6 indices each): top, -y, +y, +x, -x[, bottom].
 * @param {{cx:number, cy:number, w:number, d:number, z0:number, z1:number, rot?:number, bottom?:boolean, uv?:[number,number]}} o
 * @returns {import('./meshdata.js').MeshData}
 */
export function boxMesh(o) {
  const hw = o.w / 2, hd = o.d / 2, z0 = o.z0, z1 = o.z1;
  const su = o.uv ? o.uv[0] : 1, sv = o.uv ? o.uv[1] : 1;
  const b = new MeshBuilder();
  const face = (n, p0, p1, p2, p3) => {
    const v0 = b.vertex(p0[0], p0[1], p0[2], n[0], n[1], n[2], 0, 0), v1 = b.vertex(p1[0], p1[1], p1[2], n[0], n[1], n[2], su, 0);
    const v2 = b.vertex(p2[0], p2[1], p2[2], n[0], n[1], n[2], su, sv), v3 = b.vertex(p3[0], p3[1], p3[2], n[0], n[1], n[2], 0, sv);
    b.quad(v0, v1, v2, v3);
  };
  face([0, 0, 1], [-hw, -hd, z1], [hw, -hd, z1], [hw, hd, z1], [-hw, hd, z1]);                 // top
  face([0, -1, 0], [-hw, -hd, z0], [hw, -hd, z0], [hw, -hd, z1], [-hw, -hd, z1]);              // -y side
  face([0, 1, 0], [hw, hd, z0], [-hw, hd, z0], [-hw, hd, z1], [hw, hd, z1]);                   // +y side
  face([1, 0, 0], [hw, -hd, z0], [hw, hd, z0], [hw, hd, z1], [hw, -hd, z1]);                   // +x side
  face([-1, 0, 0], [-hw, hd, z0], [-hw, -hd, z0], [-hw, -hd, z1], [-hw, hd, z1]);              // -x side
  if (o.bottom) face([0, 0, -1], [-hw, hd, z0], [hw, hd, z0], [hw, -hd, z0], [-hw, -hd, z0]);  // underside
  const names = ['top', '-y', '+y', '+x', '-x', 'bottom'];
  const faces = o.bottom ? 6 : 5;
  const groups = [];
  for (let f = 0; f < faces; f++) groups.push({ name: names[f], start: f * 6, count: 6 });
  return placeMeshData(b.build(groups), { x: o.cx, y: o.cy, rot: o.rot || 0 });
}

/**
 * A drop / spot target slab as ONE single-material mesh (no groups: one draw call in the main pass and one in the shadow pass instead of five).
 * The two big faces (+y / -y) keep the tile UVs 0..1; the top and the two ends get a constant UV `frameUV` that samples the tan frame border of the
 * same texture (ART's `misc.targetYellow` has a tan border at u < 0.06), so the slab reads as a yellow tile in a tan frame.
 * @param {Parameters<typeof boxMesh>[0] & {frameUV?:[number,number]}} o  (same options as boxMesh)
 * @returns {import('./meshdata.js').MeshData}
 */
export function targetSlabMesh(o) {
  const md = boxMesh(o);
  const f = o.frameUV || [0.03, 0.5];
  for (const g of md.groups || []) {
    if (g.name === '-y' || g.name === '+y') continue;
    for (let i = g.start; i < g.start + g.count; i++) { const v = md.indices[i]; md.uvs[v * 2] = f[0]; md.uvs[v * 2 + 1] = f[1]; }
  }
  return { positions: md.positions, normals: md.normals, uvs: md.uvs, indices: md.indices };
}

/**
 * Horizontal cylinder (a wire) from (x0, y0) to (x1, y1) at height z, radius r.
 * @param {{x0:number,y0:number,x1:number,y1:number,z:number,r:number,segments?:number}} o @returns {import('./meshdata.js').MeshData}
 */
export function wireMesh(o) {
  const seg = o.segments ?? 8;
  const dx = o.x1 - o.x0, dy = o.y1 - o.y0, L = Math.hypot(dx, dy);
  const b = new MeshBuilder();
  const r0 = [], r1 = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
    // local frame: x along the wire, (y, z) circle
    r0.push(b.vertex(0, c * o.r, s * o.r, 0, c, s, 0, i / seg));
    r1.push(b.vertex(L, c * o.r, s * o.r, 0, c, s, L, i / seg));
  }
  for (let i = 0; i < seg; i++) b.quad(r0[i], r0[i + 1], r1[i + 1], r1[i]);
  return placeMeshData(b.build(), { x: o.x0, y: o.y0, z: o.z, rot: Math.atan2(dy, dx) });
}

/**
 * Outline of a tapered capsule (flipper): circle of radius r0 at the origin (pivot) and r1 at (L, 0) (tip), joined by the external tangents.
 * Counter-clockwise ring; `arcSeg` = segments per half circle.
 * @returns {[number, number][]}
 */
export function taperedCapsuleOutline(r0, r1, L, arcSeg = 16) {
  const alpha = Math.acos((r0 - r1) / L);
  const pts = [];
  for (let i = 0; i <= arcSeg; i++) { const t = -alpha + (2 * alpha * i) / arcSeg; pts.push([L + r1 * Math.cos(t), r1 * Math.sin(t)]); }   // tip arc, -alpha .. +alpha
  for (let i = 0; i <= arcSeg; i++) { const t = alpha + ((TAU - 2 * alpha) * i) / arcSeg; pts.push([r0 * Math.cos(t), r0 * Math.sin(t)]); }   // pivot arc
  return pts;
}

/**
 * Flipper body: tapered capsule extruded z0..z1, its long axis rotated to point from the pivot to the REST tip.
 * Local frame = relative to the pivot (the scene positions the group at the pivot and rotates it by the live angle about the vertical axis).
 * Returns separate parts: top (UV: u along the axis 0..1, v across 0..1) and side (UV: perimeter, height).
 * @param {{pivot:[number,number], restTip:[number,number], pivotR:number, tipR:number}} def
 * @param {{z0?:number, z1?:number, arcSeg?:number}} [o]
 * @returns {{top: import('./meshdata.js').MeshData, side: import('./meshdata.js').MeshData, length:number, restAngle:number}}
 */
export function flipperParts(def, o = {}) {
  const dx = def.restTip[0] - def.pivot[0], dy = def.restTip[1] - def.pivot[1];
  const L = Math.hypot(dx, dy);
  const restAngle = Math.atan2(dy, dx);
  const outline = taperedCapsuleOutline(def.pivotR, def.tipR, L, o.arcSeg ?? 14);
  const total = L + def.pivotR + def.tipR;
  const uv = (x, y, kind, s, z) => (kind === 'top' ? [(x + def.pivotR) / total, 0.5 + y / (2 * def.pivotR)] : [s * 0.5, z * 0.5]);
  const parts = extrudePolygonParts(outline, o.z0 ?? 0.06, o.z1 ?? 0.42, { uv, smoothAngleDeg: 60 });
  return {
    top: placeMeshData(parts.top, { rot: restAngle }), side: placeMeshData(parts.side, { rot: restAngle }), length: L, restAngle,
  };
}


/**
 * Flat silver-rail ribbon running along the INSIDE of a polygon outline at height z (the top of a wall: the rail edge, while the middle of the
 * top shows the painted floor art). Width = min(width, 0.55 * local thickness estimate 2 A / P): on a thin rail the two ribbons of the opposite
 * long edges just meet (no overlap, so no z-fighting). Miter joins (scale clamped to 2.2). Faces up.
 * UV: u = distance along the outline * 0.5, v = across the ribbon (0 at the outline, 1 at the inner edge) - ART's wallTop has its red stripe on
 * both long edges (v = across the wall), giving a red-edged silver rail.
 * @param {[number,number][]} pts polygon (either winding) @param {number} z @param {number} [width=0.18]
 * @returns {import('./meshdata.js').MeshData}
 */
export function insetRibbonMesh(pts, z, width = 0.18) {
  const ring = cleanRing(pts);
  if (ring.length < 3) return new MeshBuilder().build();
  if (polygonArea(ring) < 0) ring.reverse();
  const n = ring.length;
  let per = 0;
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const w = Math.max(0.03, Math.min(width, (0.55 * 2 * Math.abs(polygonArea(ring))) / per));
  const inward = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    inward.push([-dy / l, dx / l]);
  }
  const inner = [];
  for (let i = 0; i < n; i++) {
    const n1 = inward[(i + n - 1) % n], n2 = inward[i];
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n2[0]; my = n2[1]; } else { mx /= ml; my /= ml; }
    const c = Math.max(mx * n2[0] + my * n2[1], 0.45);
    const k = Math.min(w / c, w * 2.2);
    inner.push([ring[i][0] + mx * k, ring[i][1] + my * k]);
  }
  const b = new MeshBuilder();
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]);
    const v0 = b.vertex(ring[i][0], ring[i][1], z, 0, 0, 1, s * 0.5, 0), v1 = b.vertex(ring[j][0], ring[j][1], z, 0, 0, 1, (s + len) * 0.5, 0);
    const v2 = b.vertex(inner[j][0], inner[j][1], z, 0, 0, 1, (s + len) * 0.5, 1), v3 = b.vertex(inner[i][0], inner[i][1], z, 0, 0, 1, s * 0.5, 1);
    b.quad(v0, v1, v2, v3);
    s += len;
  }
  return b.build();
}

/**
 * Open half-cylinder ("arch", a tunnel hood) running along the T-frame y axis from y0 to y1: semicircle of radius r centred at (cx, z0) in the
 * x-z plane (the upper half), outward normals. UV: u = angle / pi, v = distance along y.
 * @param {{cx:number, y0:number, y1:number, r:number, z0?:number, segments?:number}} o @returns {import('./meshdata.js').MeshData}
 */
export function archMesh(o) {
  const seg = o.segments ?? 16;
  const z0 = o.z0 ?? 0;
  const b = new MeshBuilder();
  const r0 = [], r1 = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI, c = Math.cos(a), s = Math.sin(a);
    r0.push(b.vertex(o.cx + c * o.r, o.y0, z0 + s * o.r, c, 0, s, i / seg, 0));
    r1.push(b.vertex(o.cx + c * o.r, o.y1, z0 + s * o.r, c, 0, s, i / seg, Math.abs(o.y1 - o.y0)));
  }
  // outward = away from the axis; with y1 > y0 the winding below is CCW seen from outside
  for (let i = 0; i < seg; i++) {
    if (o.y1 >= o.y0) b.quad(r0[i + 1], r0[i], r1[i], r1[i + 1]);
    else b.quad(r0[i], r0[i + 1], r1[i + 1], r1[i]);
  }
  return b.build();
}

/** Regular polygon ring (CCW) of `n` vertices. @returns {[number, number][]} */
export function regularPolygon(cx, cy, r, n, phase = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = phase + (i / n) * TAU; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Merge helper re-export for scene code. */
export { mergeMeshData, placeMeshData };
