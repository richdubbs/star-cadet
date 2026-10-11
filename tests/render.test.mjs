/**
 * tests/render.test.mjs
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * Pure parts of src/render (no WebGL): convert, camera_math (SPEC App. D #1 projection checkpoints + the camera recipe), geom/extrude, geom/deck,
 * geom/shapes, geom/lamps, geom/meshdata. Visual checks of the scene (three.js) happen in the browser (INTEGRATOR screenshots vs layout_map.png).
 * Run alone:  node --test tests/render.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../src/data/index.js';
import { t2v, v2t, angleToRotY, rotYOfDir, approach, slew, clamp, lerp } from '../src/render/convert.js';
import {
  viewOffsetFor, viewOffsetForSize, projectPoint, ORIGINAL_CAMERA, bitmapPxToCanvas, topViewBounds,
} from '../src/render/camera_math.js';
import { polygonArea, extrudePolygon, extrudePolygonParts, triangulatePolygon, pointInPolygon, cleanRing } from '../src/render/geom/extrude.js';
import { deckHeightAt, buildDeckMesh, buildDeckParts, getDeckField, clipPolygonToRect } from '../src/render/geom/deck.js';
import {
  cylinderMesh, discMesh, annulusMesh, quadMesh, boxMesh, wireMesh, taperedCapsuleOutline, flipperParts, regularPolygon, insetRibbonMesh, archMesh,
} from '../src/render/geom/shapes.js';
import { placeLamps, buildLampQuads, shiftAlongCameraRay, srgbHexToLinear, dimTint } from '../src/render/geom/lamps.js';
import { MISC_KEYS_USED, ARTPACK_MEMBERS_USED } from '../src/render/art_keys.js';
import { createFakeCanvasFactory } from './helpers/fake_canvas.mjs';
import { paintAll } from '../src/render/art/index.js';
import { patchUV, lampCellUV } from '../src/render/art/mapping.js';
import { MeshBuilder, mergeMeshData, placeMeshData, validateMeshData, triangleCount, meshBounds, emptyMeshData } from '../src/render/geom/meshdata.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const cap = (md, group) => {                       // sum of triangle areas (xy projection) of one group
  const g = md.groups.find((x) => x.name === group);
  let a = 0;
  for (let i = g.start; i < g.start + g.count; i += 3) {
    const p = [0, 1, 2].map((k) => { const v = md.indices[i + k] * 3; return [md.positions[v], md.positions[v + 1]]; });
    a += polygonArea(p);
  }
  return a;
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// convert.js
// ---------------------------------------------------------------------------------------------------------------------------------------
test('convert: t2v / v2t are inverse proper rotations (T-frame +x = screen-left = Three -x)', () => {
  assert.deepEqual(t2v(1, 2, 3), [-1, 3, 2]);
  assert.deepEqual(t2v(0.5, -4), [-0.5, 0, -4]);
  for (const p of [[0, 0, 0], [1, 2, 3], [-8, 15, 0.3], [7.5, -14, 1.368]]) {
    const v = t2v(...p);
    assert.deepEqual(v2t(...v), p.map((x) => x + 0));
  }
  // determinant +1 (no mirroring): the images of the T axes form a right-handed basis
  const ex = t2v(1, 0, 0), ey = t2v(0, 1, 0), ez = t2v(0, 0, 1);
  const cross = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  assert.deepEqual(cross.map((x) => x + 0), ez.map((x) => x + 0));
});

test('convert: SPEC 1.2 rotation identity - T-frame CCW rotation by a == Three rotation.y = +a on t2v(v)', () => {
  for (const a of [0, 0.3, 1.21523, -1.214923, Math.PI / 2, 3]) {
    for (const v of [[1, 0], [0, 1], [-2.5, 3.1], [1.528, -1.068]]) {
      const c = Math.cos(a), s = Math.sin(a);
      const tRot = [v[0] * c - v[1] * s, v[0] * s + v[1] * c];                    // T-frame CCW rotation
      const [x, y, z] = t2v(v[0], v[1], 0);
      const ra = angleToRotY(a);
      const r3 = [x * Math.cos(ra) + z * Math.sin(ra), y, -x * Math.sin(ra) + z * Math.cos(ra)];   // three.js Object3D rotation about +Y by ra
      const expect = t2v(tRot[0], tRot[1], 0);
      near(r3[0], expect[0], 1e-12); near(r3[1], expect[1], 1e-12); near(r3[2], expect[2], 1e-12);
    }
  }
  near(rotYOfDir(0, 1), Math.PI / 2, 1e-12);
  near(rotYOfDir(-1, 0), Math.PI, 1e-12);
});

test('convert: easing helpers are frame-rate independent and bounded', () => {
  near(approach(0, 1, 0.1, 0.1), 1 - Math.exp(-1), 1e-12);
  const a = approach(approach(0, 1, 0.05, 0.1), 1, 0.05, 0.1), b = approach(0, 1, 0.1, 0.1);
  near(a, b, 1e-12, 'two half frames = one frame');
  assert.equal(approach(3, 7, 0.1, 0), 7);
  assert.equal(slew(0, 1, 0.1, 5), 0.5);
  assert.equal(slew(0, 1, 1, 5), 1);
  assert.equal(slew(1, 0, 0.1, 2), 0.8);
  assert.equal(clamp(5, 0, 1), 1); assert.equal(clamp(-5, 0, 1), 0); assert.equal(lerp(2, 4, 0.5), 3);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// camera_math.js  (SPEC App. D #1)
// ---------------------------------------------------------------------------------------------------------------------------------------
test('camera_math: projection checkpoints of SPEC App. D #1', () => {
  const p1 = projectPoint(2.4888, 12.0631);
  near(p1[0], 132.6, 0.1); near(p1[1], 384.3, 0.1);                                  // flipper pivot
  const p2 = projectPoint(-7.0209, 10.0849);
  near(p2[0], 319.5, 0.1); near(p2[1], 343.4, 0.1);                                  // plunger rest
  const corners = { '8,-14': [77.6, 19.6], '-8,-14': [288.4, 19.6], '8,15': [10.7, 451.5], '-8,15': [355.3, 451.5] };
  for (const [k, [ex, ey]] of Object.entries(corners)) {
    const [x, y] = k.split(',').map(Number);
    const p = projectPoint(x, y);
    near(p[0], ex, 0.1, 'corner ' + k + ' x'); near(p[1], ey, 0.1, 'corner ' + k + ' y');
  }
  // heights shift the pixel (higher = nearer the camera)
  const lo = projectPoint(5, 0, 0), hi = projectPoint(5, 0, 1.6);
  assert.ok(Math.abs(hi[0] - 183) > Math.abs(lo[0] - 183), 'wall top projects further from the principal point');
});

test('camera_math: viewOffsetFor(365) = {366, 476, 0, 0, 365, 416} and scales linearly', () => {
  assert.deepEqual(viewOffsetFor(365), { fullW: 366, fullH: 476, x: 0, y: 0, w: 365, h: 416 });
  const v = viewOffsetFor(730);
  assert.deepEqual(v, { fullW: 732, fullH: 952, x: 0, y: 0, w: 730, h: 832 });
  const k = viewOffsetFor(1000);
  near(k.fullW / 1000, 366 / 365, 1e-12); near(k.h / k.w, 416 / 365, 1e-12);
});

test('camera_math: viewOffsetForSize centres the 365x416 window and applies the nudge shake', () => {
  const a = viewOffsetForSize(730, 832);
  assert.equal(a.S, 2); near(a.x, 0, 1e-12); near(a.y, 0, 1e-12); assert.equal(a.w, 730); assert.equal(a.h, 832); assert.equal(a.fullW, 732);
  const wide = viewOffsetForSize(1000, 832);                          // wider canvas: window centred, S from the height
  assert.equal(wide.S, 2); near(wide.x, -135, 1e-9); near(wide.y, 0, 1e-12);
  const tall = viewOffsetForSize(730, 1000);
  assert.equal(tall.S, 2); near(tall.y, -84, 1e-9);
  const shaken = viewOffsetForSize(730, 832, { x: 2, y: -1 });         // image moves right / up: the window moves left / down
  assert.equal(shaken.x, -4); assert.equal(shaken.y, 2);
  const [bx, by] = bitmapPxToCanvas(132.6, 384.3, a);
  near(bx, 265.2, 1e-9); near(by, 768.6, 1e-9);
});

test('camera_math: the SPEC 1.4 camera recipe (fov, aspect, view offset) reproduces projectPoint for the whole table volume', () => {
  const C = ORIGINAL_CAMERA;
  near(C.fovDeg, 2 * Math.atan(238 / 400.000702) * 180 / Math.PI, 5e-4);
  near(C.aspect, 366 / 476, 1e-12);
  const S = 2, cssW = 730, cssH = 832;
  const off = viewOffsetForSize(cssW, cssH);
  const [px, py, pz] = C.position, [fx, fy, fz] = C.forward, [ux, uy, uz] = C.up;
  const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;      // right = forward x up
  const tanHalf = Math.tan((C.fovDeg * Math.PI) / 360);
  for (const [x, y, z] of [[0, 0, 0], [3, -5, 0], [-6, 12, 0.3], [7.5, -13, 1.6], [2.4888, 12.0631, 0], [-4, 6, 1.368]]) {
    const [vx, vy, vz] = t2v(x, y, z);
    const dx = vx - px, dy = vy - py, dz = vz - pz;
    const cx = dx * rx + dy * ry + dz * rz, cy = dx * ux + dy * uy + dz * uz, cz = dx * fx + dy * fy + dz * fz;
    // symmetric frustum of the FULL frame (366 x 476 times S), then the sub-window of setViewOffset
    const fullH = off.fullH;
    const ndcX = cx / cz / (tanHalf * C.aspect), ndcY = cy / cz / tanHalf;
    const fullPx = ((ndcX + 1) / 2) * off.fullW, fullPy = ((1 - ndcY) / 2) * fullH;
    const canvasX = fullPx - off.x, canvasY = fullPy - off.y;
    const [bx, by] = projectPoint(x, y, z);
    near(canvasX, bx * S, 2e-3, `x of (${x},${y},${z})`);     // fov 61.505 is the rounded SPEC value
    near(canvasY, by * S, 2e-3, `y of (${x},${y},${z})`);
  }
});

test('camera_math: topViewBounds fits the playfield for any aspect', () => {
  for (const aspect of [0.5, 365 / 416, 1, 2]) {
    const b = topViewBounds(aspect, 0.5);
    assert.ok(b.right - b.left >= 17 - 1e-9 && b.top - b.bottom >= 30 - 1e-9, 'whole table + margin visible');
    near((b.right - b.left) / (b.top - b.bottom), aspect, 1e-9);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// extrude.js
// ---------------------------------------------------------------------------------------------------------------------------------------
test('extrude: polygonArea signs of the SPEC 3.1 islands (S>0) and shells 103/106 (S<0)', () => {
  assert.equal(data.WALLS.length, 45);
  for (const w of data.WALLS) {
    const s = polygonArea(w.pts);
    if (w.group === 103 || w.group === 106) assert.ok(s < 0, w.name + ' is a shell');
    else assert.ok(s > 0, w.name + ' is an island');
    assert.equal(w.solid, s > 0 ? 'island' : 'shell');
  }
  near(Math.abs(polygonArea(data.WALLS.find((w) => w.group === 103).pts)), 26.69, 0.05, 'shell 103 area (SPEC 3.5.2)');
  assert.equal(polygonArea([[0, 0], [1, 0]]), 0);
  assert.equal(polygonArea([[0, 0], [2, 0], [2, 2], [0, 2]]), 4);
  assert.equal(polygonArea([[0, 0], [0, 2], [2, 2], [2, 0]]), -4);
});

test('extrude: a square prism has the expected vertex/triangle counts, unit normals and areas', () => {
  const sq = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const e = extrudePolygon(sq, 0, 1, { capBottom: true });
  assert.deepEqual(validateMeshData(e), []);
  assert.equal(e.positions.length / 3, 4 + 16 + 4);                  // top 4 + 4 side quads x 4 + bottom 4
  assert.equal(triangleCount(e), 2 + 8 + 2);
  near(cap(e, 'top'), 4, 1e-9); near(cap(e, 'bottom'), -4, 1e-9);
  const noBottom = extrudePolygon(sq, 0, 1);
  assert.equal(triangleCount(noBottom), 2 + 8);
  assert.deepEqual(noBottom.groups.map((g) => g.name), ['top', 'side']);
  // top-face normals point up, side normals are horizontal and point out of the polygon
  const parts = extrudePolygonParts(sq, 0, 1);
  for (let i = 0; i < parts.top.normals.length; i += 3) assert.deepEqual([parts.top.normals[i], parts.top.normals[i + 1], parts.top.normals[i + 2]], [0, 0, 1]);
  for (let i = 0; i < parts.side.positions.length; i += 3) {
    const nx = parts.side.normals[i], ny = parts.side.normals[i + 1];
    const px = parts.side.positions[i] - 1, py = parts.side.positions[i + 1] - 1;
    assert.equal(parts.side.normals[i + 2], 0);
    assert.ok(nx * px + ny * py > 0, 'side normal points outward');
  }
  // z range
  const b = meshBounds(e);
  assert.deepEqual(b.min, [0, 0, 0]); assert.deepEqual(b.max, [2, 2, 1]);
});

test('extrude: either winding gives the same outward-facing prism; closing duplicates and repeated points are ignored', () => {
  const ccw = [[0, 0], [3, 0], [3, 1], [0, 1]];
  const cw = ccw.slice().reverse();
  const withDup = [...ccw, ccw[0], ccw[0]];
  for (const p of [cw, withDup]) {
    const e = extrudePolygon(p, 0, 0.5);
    assert.deepEqual(validateMeshData(e), []);
    near(cap(e, 'top'), 3, 1e-9);
    assert.equal(triangleCount(e), 2 + 8);
  }
  assert.equal(cleanRing(withDup).length, 4);
});

test('extrude: concave polygon - cap area equals the polygon area, triangles tile it, normals unit', () => {
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];           // L shape, area 7
  const e = extrudePolygon(L, 0, 1);
  assert.deepEqual(validateMeshData(e), []);
  near(cap(e, 'top'), 7, 1e-9);
  assert.equal(e.groups.find((g) => g.name === 'top').count / 3, 4);   // n-2 triangles
  // no triangle of the cap lies outside the polygon (centroid test)
  const t = triangulatePolygon(L);
  for (let i = 0; i < t.triangles.length; i += 3) {
    const c = [0, 1].map((k) => (t.points[t.triangles[i]][k] + t.points[t.triangles[i + 1]][k] + t.points[t.triangles[i + 2]][k]) / 3);
    assert.ok(pointInPolygon(c[0], c[1], L), 'centroid inside');
  }
  // comb with several concavities
  const comb = [[0, 0], [6, 0], [6, 3], [5, 3], [5, 1], [4, 1], [4, 3], [3, 3], [3, 1], [2, 1], [2, 3], [1, 3], [1, 1], [0, 1]];
  const tc = triangulatePolygon(comb);
  let a = 0;
  for (let i = 0; i < tc.triangles.length; i += 3) a += polygonArea([tc.points[tc.triangles[i]], tc.points[tc.triangles[i + 1]], tc.points[tc.triangles[i + 2]]]);
  near(a, Math.abs(polygonArea(comb)), 1e-9);
});

test('extrude: every one of the 45 DAT polygons triangulates to exactly its area and extrudes to a valid mesh', () => {
  for (const w of data.WALLS) {
    const t = triangulatePolygon(w.pts);
    let a = 0;
    for (let i = 0; i < t.triangles.length; i += 3) {
      const tri = [t.points[t.triangles[i]], t.points[t.triangles[i + 1]], t.points[t.triangles[i + 2]]];
      const ar = polygonArea(tri);
      assert.ok(ar > 0, w.name + ' triangle CCW');
      a += ar;
    }
    near(a, Math.abs(polygonArea(w.pts)), 1e-6, w.name + ' cap area');
    const e = extrudePolygon(w.pts, 0, w.top || 1, { capBottom: true });
    assert.deepEqual(validateMeshData(e), [], w.name);
  }
});

test('extrude: custom uv callback and smooth normals', () => {
  const circle = regularPolygon(0, 0, 1, 24);
  const seen = new Set();
  const e = extrudePolygon(circle, 0, 1, { uv: (x, y, kind) => { seen.add(kind); return [x, y]; } });
  assert.deepEqual([...seen].sort(), ['side', 'top']);
  // smooth: neighbouring side vertices of a 24-gon share an (almost) radial normal
  const parts = extrudePolygonParts(circle, 0, 1, { smooth: true });
  for (let i = 0; i < parts.side.positions.length; i += 3) {
    const x = parts.side.positions[i], y = parts.side.positions[i + 1];
    const r = Math.hypot(x, y);
    near(parts.side.normals[i] * (x / r) + parts.side.normals[i + 1] * (y / r), 1, 1e-6, 'vertex normal is radial');
  }
  const flat = extrudePolygonParts([[0, 0], [1, 0], [1, 1], [0, 1]], 0, 1, { smooth: true });      // 90 degree corners stay hard
  const nset = new Set();
  for (let i = 0; i < flat.side.normals.length; i += 3) nset.add(flat.side.normals[i] + ',' + flat.side.normals[i + 1]);
  assert.equal(nset.size, 4);
  assert.ok(e.indices.length > 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// deck.js
// ---------------------------------------------------------------------------------------------------------------------------------------
test('deck: deckHeightAt equals the exact plane value at every ramp triangle centroid (SPEC 3.5.1)', () => {
  assert.equal(data.RAMPS.ramp.planes.length, 18);
  data.RAMPS.ramp.planes.forEach((p, i) => {
    const cx = (p.v[0][0] + p.v[1][0] + p.v[2][0]) / 3, cy = (p.v[0][1] + p.v[1][1] + p.v[2][1]) / 3;
    const exact = p.offset[0] * cx + p.offset[1] * cy + p.offset[2];
    near(deckHeightAt(cx, cy, data), exact, 1e-9, 'plane ' + i);
  });
  // and at the vertices: the surface heights of the SPEC table (spot checks)
  near(deckHeightAt(3.2964, 1.2325, data), 0.0, 2e-3, 'low mouth corner');
  near(deckHeightAt(3.5814, 0.4637, data), 0.6, 2e-3, 'plane 10 vertex');
  near(deckHeightAt(4.3948, -0.6761, data), 1.068, 2e-3, 'plateau vertex');
});

test('deck: 1.068 on the deck, 0 on the tongue below the low mouth, 1.068 far from the footprint', () => {
  near(deckHeightAt(6.5, 4, data), data.HEIGHTS.deckSurface, 1e-9);
  near(deckHeightAt(5.9, 7.2, data), 1.068, 1e-9);
  for (const p of data.DECK_FLOOR_POLY.slice(0, 20)) {                                      // vertices of the deck polygon, nudged inside
    const h = deckHeightAt(p[0] * 0.999 + 0.0004, p[1] * 0.999 + 0.0004, data);
    assert.ok(h <= 1.0681 && h >= -1e-9);
  }
  near(deckHeightAt(2.2, 1.53, data), 0, 1e-9, 'tongue');
  near(deckHeightAt(-3, 0, data), 1.068, 1e-9, 'outside the shell');
});

test('deck: continuous across the ramp footprint boundary within 0.05', () => {
  const fp = data.RAMP_FOOTPRINT_POLY;
  let worst = 0;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], b = fp[(i + 1) % fp.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    const nx = dy / l, ny = -dx / l;
    for (let t = 0.05; t < 1; t += 0.1) {
      const x = a[0] + dx * t, y = a[1] + dy * t;
      const h1 = deckHeightAt(x + nx * 0.01, y + ny * 0.01, data), h2 = deckHeightAt(x - nx * 0.01, y - ny * 0.01, data);
      worst = Math.max(worst, Math.abs(h1 - h2));
    }
  }
  assert.ok(worst < 0.05, 'worst jump ' + worst);
});

test('deck: buildDeckMesh is a valid, well-formed mesh covering the shell 103 area', () => {
  const m = buildDeckMesh(data, { cell: 0.1 });
  assert.deepEqual(validateMeshData(m), []);
  assert.deepEqual(m.groups.map((g) => g.name), ['surface', 'railInner', 'railTop', 'railOuter']);
  const surf = m.groups[0];
  // projected area of the surface triangles = shell area
  let area = 0;
  for (let i = surf.start; i < surf.start + surf.count; i += 3) {
    const p = [0, 1, 2].map((k) => { const v = m.indices[i + k] * 3; return [m.positions[v], m.positions[v + 1]]; });
    const ar = polygonArea(p);
    assert.ok(ar >= -1e-9, 'surface triangles face up');
    area += ar;
  }
  near(area, 26.69, 0.2, 'surface area');
  // heights stay inside [0, 1.768]; surface heights inside [0, 1.068]; vertices lie inside the shell (tolerance)
  const shell = getDeckField(data).shell;
  for (let i = surf.start; i < surf.start + surf.count; i++) {
    const v = m.indices[i] * 3;
    assert.ok(m.positions[v + 2] >= -1e-6 && m.positions[v + 2] <= 1.0681);
  }
  let outside = 0;
  for (let i = 0; i < surf.count; i++) {
    const v = m.indices[surf.start + i] * 3;
    const x = m.positions[v], y = m.positions[v + 1];
    if (!pointInPolygon(x, y, shell)) {
      // on the outline (clipped vertices lie on it): distance to the polygon must be ~0
      let d = Infinity;
      for (let k = 0; k < shell.length; k++) {
        const a = shell[k], b = shell[(k + 1) % shell.length];
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
        d = Math.min(d, Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)));
      }
      if (d > 1e-4) outside++;
    }
  }
  assert.equal(outside, 0, 'no surface vertex strays outside the shell');
  const b = meshBounds(m);
  assert.ok(b.max[2] <= 1.768 + 1e-6 && b.max[2] > 1.7, 'rail top = deck + 0.7 = 1.768');
  assert.ok(triangleCount(m) < 30000, 'triangle budget');
});

test('deck: rails fade to nothing where the surface is on the floor (no wall across the low mouth) and the clip helper works', () => {
  const parts = buildDeckParts(data);
  let lowRail = 0;
  for (let i = 0; i < parts.railInner.positions.length; i += 3) {
    const x = parts.railInner.positions[i], y = parts.railInner.positions[i + 1], z = parts.railInner.positions[i + 2];
    if (Math.abs(x - 2.1) < 0.7 && y > 1.5 && z > 0.05) lowRail++;           // the tongue's far end at (1.04..3.17, 1.34..2.09)
  }
  assert.equal(lowRail, 0);
  const poly = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const c = clipPolygonToRect(poly, 1, 1, 2, 2);
  near(Math.abs(polygonArea(c)), 1, 1e-12);
  assert.equal(clipPolygonToRect(poly, 5, 5, 6, 6).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// shapes.js / meshdata.js
// ---------------------------------------------------------------------------------------------------------------------------------------
test('shapes: every primitive is a valid mesh with the expected extents', () => {
  const c = cylinderMesh({ cx: 1, cy: 2, r: 0.5, z0: 0, z1: 0.9, segments: 16, capBottom: true });
  assert.deepEqual(validateMeshData(c), []);
  const cb = meshBounds(c);
  near(cb.min[0], 0.5, 1e-6); near(cb.max[0], 1.5, 1e-6); near(cb.max[2], 0.9, 1e-6);
  const cone = cylinderMesh({ cx: 0, cy: 0, r: 1, rTop: 0.5, z0: 0, z1: 1 });
  assert.deepEqual(validateMeshData(cone), []);
  assert.ok(cone.normals[2] > 0, 'tapered cylinder side normals tilt upwards');
  for (const m of [discMesh({ cx: 0, cy: 0, r: 1, z: 0.1 }), annulusMesh({ cx: 0, cy: 0, r0: 1, r1: 1.2, z: 0 }), quadMesh({ cx: 1, cy: 1, z: 0, w: 2, h: 1, rot: 0.7 }),
    wireMesh({ x0: 0, y0: 0, x1: 2, y1: 1, z: 0.4, r: 0.04 })]) assert.deepEqual(validateMeshData(m), []);
  const box = boxMesh({ cx: 0, cy: 0, w: 2, d: 1, z0: 0, z1: 1, bottom: true });
  assert.deepEqual(validateMeshData(box), []);
  assert.equal(box.groups.length, 6);
  assert.equal(triangleCount(box), 12);
  const rb = meshBounds(boxMesh({ cx: 3, cy: 4, w: 2, d: 1, z0: 0, z1: 1, rot: Math.PI / 2 }));
  near(rb.min[0], 2.5, 1e-6); near(rb.max[0], 3.5, 1e-6); near(rb.min[1], 3, 1e-6); near(rb.max[1], 5, 1e-6);
});

test('shapes: arch (tunnel hood) is an open upward half-cylinder with outward unit normals', () => {
  for (const [y0, y1] of [[0, 2], [2, 0]]) {
    const a = archMesh({ cx: 1, y0, y1, r: 0.5, z0: 0, segments: 12 });
    assert.deepEqual(validateMeshData(a), []);
    const b = meshBounds(a);
    near(b.min[0], 0.5, 1e-6); near(b.max[0], 1.5, 1e-6); near(b.max[2], 0.5, 1e-6); assert.ok(b.min[2] >= -1e-6);
    near(b.min[1], 0, 1e-6); near(b.max[1], 2, 1e-6);
    // every triangle faces away from the axis: its geometric normal points the same way as the stored vertex normals
    for (let i = 0; i < a.indices.length; i += 3) {
      const [p0, p1, p2] = [0, 1, 2].map((k) => { const v = a.indices[i + k] * 3; return [a.positions[v], a.positions[v + 1], a.positions[v + 2]]; });
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const v0 = a.indices[i] * 3;
      const dot = n[0] * a.normals[v0] + n[1] * a.normals[v0 + 1] + n[2] * a.normals[v0 + 2];
      assert.ok(dot > 0, 'triangle winding agrees with the outward normal');
    }
  }
});

test('shapes: tapered capsule outline is CCW with the pivot and tip radii; flipper parts point from pivot to rest tip', () => {
  const o = taperedCapsuleOutline(0.311, 0.193, 1.8638, 12);
  assert.ok(polygonArea(o) > 0);
  const xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
  near(Math.min(...xs), -0.311, 1e-9); near(Math.max(...xs), 1.8638 + 0.193, 1e-9);
  near(Math.max(...ys), 0.311, 0.01);
  for (const f of data.FLIPPERS) {
    const parts = flipperParts(f);
    assert.deepEqual(validateMeshData(parts.top), []);
    assert.deepEqual(validateMeshData(parts.side), []);
    const dx = f.restTip[0] - f.pivot[0], dy = f.restTip[1] - f.pivot[1];
    near(parts.length, Math.hypot(dx, dy), 1e-9);
    near(parts.restAngle, Math.atan2(dy, dx), 1e-12);
    // the farthest point of the body (relative to the pivot) lies along the rest direction at length + tip radius
    const b = meshBounds(parts.side);
    const far = Math.max(...[0, 1, 2, 3].map((k) => Math.hypot(parts.side.positions[k * 3], parts.side.positions[k * 3 + 1])));
    assert.ok(far > 0 && b.max[2] > 0.4 && b.min[2] < 0.1);
    // rotating the rest tip by angleMax lands on the raised tip (SPEC 2.3)
    const a = f.angleMax, c = Math.cos(a), s = Math.sin(a);
    near(f.pivot[0] + dx * c - dy * s, f.raisedTip[0], 1e-2, f.name + ' raised tip x');     // SPEC raised tip is 0.35 % shorter than a pure rotation
    near(f.pivot[1] + dx * s + dy * c, f.raisedTip[1], 1e-2, f.name + ' raised tip y');
  }
  // top-face UV: u runs 0 (pivot end) .. 1 (tip end)
  const p = flipperParts(data.FLIPPERS[0]);
  const us = []; for (let i = 0; i < p.top.uvs.length; i += 2) us.push(p.top.uvs[i]);
  assert.ok(Math.min(...us) >= -1e-9 && Math.max(...us) <= 1 + 1e-9 && Math.max(...us) > 0.95 && Math.min(...us) < 0.05);
});

test('shapes: inset ribbon covers thin rails completely and stays inside fat polygons', () => {
  const thin = [[0, 0], [2, 0], [2, 0.25], [0, 0.25]];
  const r = insetRibbonMesh(thin, 0.85, 0.2);
  assert.deepEqual(validateMeshData(r), []);
  let a = 0;
  for (let i = 0; i < r.indices.length; i += 3) a += Math.abs(polygonArea([0, 1, 2].map((k) => { const v = r.indices[i + k] * 3; return [r.positions[v], r.positions[v + 1]]; })));
  assert.ok(a >= 0.4 && a <= 0.62, 'ribbons of the two long edges meet without overlapping: ' + a);
  const fat = regularPolygon(0, 0, 3, 40);
  const rf = insetRibbonMesh(fat, 0.85, 0.2);
  for (let i = 0; i < rf.positions.length; i += 3) assert.ok(Math.hypot(rf.positions[i], rf.positions[i + 1]) <= 3.0001);
});

test('meshdata: builder, merge (with groups), place and validation', () => {
  const b = new MeshBuilder();
  const a0 = b.vertex(0, 0, 0, 0, 0, 1, 0, 0), a1 = b.vertex(1, 0, 0, 0, 0, 1, 1, 0), a2 = b.vertex(0, 1, 0, 0, 0, 1, 0, 1);
  b.tri(a0, a1, a2);
  const one = b.build();
  assert.equal(vertexCount(one), 3);
  const merged = mergeMeshData([one, one], ['a', 'b']);
  assert.equal(merged.positions.length / 3, 6);
  assert.deepEqual(merged.groups, [{ name: 'a', start: 0, count: 3 }, { name: 'b', start: 3, count: 3 }]);
  assert.deepEqual([...merged.indices], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(validateMeshData(merged), []);
  const moved = placeMeshData(one, { x: 5, y: 1, z: 2, rot: Math.PI / 2 });
  near(moved.positions[3], 5, 1e-6); near(moved.positions[4], 2, 1e-6); near(moved.positions[5], 2, 1e-6);
  near(moved.normals[2], 1, 1e-6);
  assert.equal(triangleCount(emptyMeshData()), 0);
  assert.ok(validateMeshData({ positions: new Float32Array([NaN, 0, 0]), normals: new Float32Array([0, 0, 1]), uvs: new Float32Array(2), indices: new Uint32Array([0, 0, 5]) }).length >= 2);
});
function vertexCount(md) { return md.positions.length / 3; }

// ---------------------------------------------------------------------------------------------------------------------------------------
// lamps geometry
// ---------------------------------------------------------------------------------------------------------------------------------------
test('lamps: one placement per lamp that has a position (139; lite192 has none) and ground-truth lifts', () => {
  const pl = placeLamps(data);
  assert.equal(pl.length, 139);
  assert.ok(!pl.some((p) => p.name === 'lite192'));
  const lifted = pl.filter((p) => p.lifted).map((p) => p.name);
  for (const n of ['lite84', 'lite85', 'lite300', 'lite322', 'lite5', 'lite6', 'lite7', 'literoll182', 'lite314']) assert.ok(lifted.includes(n), n + ' is lifted');
  for (const p of pl) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.w > 0 && p.h > 0);
    const def = data.LAMP_BY_NAME[p.name];
    if (!p.lifted) { assert.equal(p.x, def.pos[0]); assert.equal(p.y, def.pos[1]); assert.equal(p.z, def.z); } else assert.ok(p.z > def.z);
  }
  const sling = pl.find((p) => p.name === 'lite84');
  near(sling.z, 0.85 + 0.012, 1e-9);
  assert.equal(sling.dim, false, 'slingshot tops carry the floor art, no dim sprite needed');
  assert.equal(pl.find((p) => p.name === 'lite5').dim, true);
});

test('lamps: lifting onto the deck / ramp slides along the camera ray so the SCREEN position is preserved', () => {
  const pl = placeLamps(data);
  for (const name of ['literoll182', 'lite314']) {
    const p = pl.find((q) => q.name === name);
    const def = data.LAMP_BY_NAME[name];
    const want = projectPoint(def.pos[0], def.pos[1], def.z);
    const got = projectPoint(p.x, p.y, p.z);
    near(got[0], want[0], 1e-4, name + ' px'); near(got[1], want[1], 1e-4, name + ' py');
  }
  const [x, y] = shiftAlongCameraRay(3, 4, 0, 1.078);
  const a = projectPoint(3, 4, 0), b = projectPoint(x, y, 1.078);
  near(a[0], b[0], 1e-4); near(a[1], b[1], 1e-4);
});

test('lamps: quad corners are BL BR TR TL, CCW from above, image-right = T -x, image-up = T -y, rotated by rot', () => {
  const placements = [
    { name: 'lite1', index: 0, x: 10, y: 20, z: 0.01, w: 2, h: 1, rot: 0, nStates: 1, lifted: false, liftedOnto: null, dim: false },
    { name: 'lite2', index: 1, x: 0, y: 0, z: 0.01, w: 2, h: 1, rot: Math.PI / 2, nStates: 3, lifted: false, liftedOnto: null, dim: false },
  ];
  const cells = { lite1: { u0: 0.1, v0: 0.2, u1: 0.3, v1: 0.4 }, 'lite2#0': { u0: 0, v0: 0, u1: 0.5, v1: 0.5 }, 'lite2#1': { u0: 0.5, v0: 0, u1: 1, v1: 0.5 }, 'lite2#2': { u0: 0, v0: 0.5, u1: 0.5, v1: 1 } };
  const q = buildLampQuads(placements, (n, st, ns) => cells[ns > 1 ? `${n}#${st}` : n] || null);
  assert.equal(q.positions.length, 24); assert.equal(q.indices.length, 12);
  // lamp 0: BL = centre + (w/2, h/2) (image-left is T +x, image-bottom is T +y)
  assert.deepEqual([...q.positions.slice(0, 3)], [11, 20.5, 0.01].map(Math.fround));
  assert.deepEqual([...q.positions.slice(3, 6)], [9, 20.5, 0.01].map(Math.fround));    // BR
  assert.deepEqual([...q.positions.slice(6, 9)], [9, 19.5, 0.01].map(Math.fround));    // TR
  assert.deepEqual([...q.positions.slice(9, 12)], [11, 19.5, 0.01].map(Math.fround));  // TL
  assert.deepEqual([...q.uvs.slice(0, 8)], [0.1, 0.2, 0.3, 0.2, 0.3, 0.4, 0.1, 0.4].map(Math.fround));
  // CCW seen from +z
  const ccw = polygonArea([0, 1, 2, 3].map((k) => [q.positions[k * 3], q.positions[k * 3 + 1]]));
  assert.ok(ccw > 0);
  // lamp 1 rotated by +90 degrees CCW: the long axis now runs along T y
  const xs = [4, 5, 6, 7].map((k) => q.positions[k * 3]), ys = [4, 5, 6, 7].map((k) => q.positions[k * 3 + 1]);
  near(Math.max(...xs) - Math.min(...xs), 1, 1e-5); near(Math.max(...ys) - Math.min(...ys), 2, 1e-5);
  assert.equal(q.quads[1].states.length, 3);
  assert.deepEqual([...q.quads[1].states[1]], [0.5, 0, 1, 0, 1, 0.5, 0.5, 0.5].map(Math.fround));
  assert.deepEqual([...q.indices.slice(6, 12)], [4, 5, 6, 4, 6, 7]);
  // missing cell -> full square
  const q2 = buildLampQuads(placements.slice(0, 1), () => null);
  assert.deepEqual([...q2.uvs], [0, 0, 1, 0, 1, 1, 0, 1]);
});

test("lamps: quad UVs agree with ART's lampCellUV for every corner (also when the quad is rotated)", () => {
  const cell = { u0: 0.25, v0: 0.5, u1: 0.35, v1: 0.6 };
  for (const rot of [0, 0.7, -1.9, 2.4]) {
    const pl = [{ name: 'x', index: 0, x: 3, y: -2, z: 0.01, w: 0.8, h: 0.5, rot, nStates: 1, lifted: false, liftedOnto: null, dim: false }];
    const q = buildLampQuads(pl, () => cell);
    for (let k = 0; k < 4; k++) {
      // corner offset from the centre in the T-frame, rotated back into the quad-local frame
      const dx = q.positions[k * 3] - 3, dy = q.positions[k * 3 + 1] + 2;
      const c = Math.cos(-rot), s = Math.sin(-rot);
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      const [u, v] = lampCellUV(cell, [0.8, 0.5], lx, ly);
      near(q.uvs[k * 2], u, 1e-5, 'u rot ' + rot); near(q.uvs[k * 2 + 1], v, 1e-5, 'v rot ' + rot);
    }
  }
});

test('lamps: colour helpers (sRGB -> linear, dim tint of the unlit sprite)', () => {
  const w = srgbHexToLinear('#ffffff'), k = srgbHexToLinear('#000');
  assert.deepEqual(w.map((x) => +x.toFixed(6)), [1, 1, 1]);
  assert.deepEqual(k, [0, 0, 0]);
  near(srgbHexToLinear('#808080')[0], 0.2158, 1e-3);
  const def = data.LAMP_BY_NAME.lite1;
  const t = dimTint(def, 0, 1);
  for (const c of t) assert.ok(c >= 0 && c <= 1);
  const d3 = data.LAMP_BY_NAME.lite2;
  assert.equal(d3.nStates, 3);
  assert.equal(dimTint(d3, 99, 1).length, 3, 'index is clamped');
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// ART <-> RENDER contract
// ---------------------------------------------------------------------------------------------------------------------------------------
test('contract: ART delivers every ArtPack member and misc texture that RENDER consumes (sizes of ARCHITECTURE 9.3)', () => {
  const { createCanvas } = createFakeCanvasFactory({ strict: true });
  const pack = paintAll(data, { createCanvas, seed: 1, quality: 'low' });
  for (const k of ARTPACK_MEMBERS_USED) assert.ok(pack[k], 'ArtPack.' + k);
  const sizes = {
    ballEnv: [512, 256], metalSide: [256, 256], wallTop: [128, 128], rubber: [128, 128], postBand: [64, 64], bumperDrum: [256, 128],
    bumperStar: [256, 256], bumperCap: [128, 128], targetYellow: [128, 64], flagPanel: [128, 64], flipperBody: [256, 64], rampSide: [128, 128],
    plungerRod: [64, 256],
  };
  for (const k of Object.keys(MISC_KEYS_USED)) {
    assert.ok(pack.misc[k], 'misc.' + k + ' is delivered by ART');
    assert.deepEqual([pack.misc[k].width, pack.misc[k].height], sizes[k], 'misc.' + k + ' size');
  }
  // the floor/deck patches carry what the scene needs: a canvas, a rect and pixel sizes (UV by patchUV)
  for (const name of ['floor', 'deck']) {
    const p = pack[name];
    assert.ok(p.canvas && p.width > 8 && p.height > 8 && p.rect.xMax > p.rect.xMin);
    const uv = patchUV(p, (p.rect.xMin + p.rect.xMax) / 2, (p.rect.yMin + p.rect.yMax) / 2);
    near(uv[0], 0.5, 1e-9); near(uv[1], 0.5, 1e-9);
  }
  // lamp atlas: a cell for every placement RENDER makes (state 0), 3-image lamps as name#i
  const cells = pack.lampAtlas.cells;
  for (const pl of placeLamps(data)) {
    const key = pl.nStates > 1 ? pl.name + '#0' : pl.name;
    assert.ok(cells[key], 'atlas cell ' + key);
    const c = cells[key];
    assert.ok(c.u1 > c.u0 && c.v1 > c.v0 && c.u0 >= 0 && c.u1 <= 1 && c.v0 >= 0 && c.v1 <= 1);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// geom/envmap.js - the chrome ball's private environment (VISUAL QA: the ball must read as polished chrome, not as a glass bead)
// ---------------------------------------------------------------------------------------------------------------------------------------
import { chromeEnvPixels, CHROME_KEY_LIGHT } from '../src/render/geom/envmap.js';

test('envmap: chromeEnvPixels is deterministic RGBA8, opaque, rows nadir -> zenith', () => {
  const a = chromeEnvPixels(64, 32), b = chromeEnvPixels(64, 32);
  assert.equal(a.length, 64 * 32 * 4);
  assert.deepEqual(a, b);
  for (let i = 3; i < a.length; i += 4) assert.equal(a[i], 255);
});

test('envmap: bright soft box at the upper left, darker horizon, dark bluish ground, no seam at the horizon', () => {
  const W = 256, H = 128;
  const px = chromeEnvPixels(W, H);
  const lum = (c, r) => { const o = (r * W + c) * 4; return (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255; };
  const at = (azDeg, elDeg) => {
    const c = Math.min(W - 1, Math.max(0, Math.floor(((azDeg * Math.PI) / 180 / (2 * Math.PI) + 0.5) * W)));
    const r = Math.min(H - 1, Math.max(0, Math.floor((elDeg / 180 + 0.5) * H)));
    return [c, r];
  };
  const key = lum(...at(CHROME_KEY_LIGHT.azimuthDeg, CHROME_KEY_LIGHT.elevationDeg));
  assert.ok(key > 0.95, 'the key soft box is (nearly) white: ' + key);
  const ground = lum(...at(0, -70)), sky = lum(...at(90, 60)), horizonUp = lum(...at(120, 5)), horizonDown = lum(...at(120, -5));
  assert.ok(ground < 0.2, 'the nadir is dark: ' + ground);
  assert.ok(sky > ground + 0.25 && sky < key, 'sky is paler than the ground and dimmer than the soft box: ' + sky);
  assert.ok(Math.abs(horizonUp - horizonDown) < 0.12, 'the horizon is a soft band, not a seam: ' + horizonUp + ' vs ' + horizonDown);
  // the ground is bluish (never neutral black) so the lower rim of the ball stays readable on the navy floor
  const o = (at(0, -20)[1] * W + at(0, -20)[0]) * 4;
  assert.ok(px[o + 2] >= px[o], 'ground is blue-tinted');
  // the equirect wraps horizontally: first and last column are neighbours (no visible seam)
  for (let r = 0; r < H; r += 8) assert.ok(Math.abs(lum(0, r) - lum(W - 1, r)) < 0.08, 'horizontal wrap row ' + r);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// geom/shapes.js targetSlabMesh - one draw call per target (VISUAL QA: frame cost; 22 targets x 5 material groups -> 22 draws per pass)
// ---------------------------------------------------------------------------------------------------------------------------------------
import { targetSlabMesh } from '../src/render/geom/shapes.js';

test('targetSlabMesh: single-material slab (no groups), tile UVs on the two big faces, constant frame UV on top and ends', () => {
  const md = targetSlabMesh({ cx: 1, cy: -2, w: 0.7, d: 0.12, z0: 0, z1: 0.33, rot: 0.4, uv: [1, 1] });
  assert.equal(md.groups, undefined, 'no groups: a single draw call');
  assert.deepEqual(validateMeshData(md), [], 'valid mesh data');
  assert.equal(triangleCount(md), 10, 'a box without underside: 5 quads');
  const uvOf = (v) => [md.uvs[v * 2], md.uvs[v * 2 + 1]];
  let tile = 0, frame = 0;
  for (let i = 0; i < md.indices.length; i++) {
    const [u, v] = uvOf(md.indices[i]);
    if (Math.abs(u - 0.03) < 1e-6 && Math.abs(v - 0.5) < 1e-6) frame++;
    else { assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1); tile++; }
  }
  assert.equal(tile, 12, 'two big faces x 6 indices');
  assert.equal(frame, 18, 'top + two ends x 6 indices');
  // the frame UV lands in the tan border of ART's tile (u < 0.06 of the 128 px texture) and not in the yellow face (starts at 8 px = 0.0625)
  assert.ok(0.03 < 8 / 128);
  // the options of boxMesh are honoured: same positions as the grouped box
  const ref = boxMesh({ cx: 1, cy: -2, w: 0.7, d: 0.12, z0: 0, z1: 0.33, rot: 0.4, uv: [1, 1] });
  assert.deepEqual(Array.from(md.positions), Array.from(ref.positions));
});

test('targetSlabMesh: a custom frame UV is honoured', () => {
  const md = targetSlabMesh({ cx: 0, cy: 0, w: 1, d: 0.1, z0: 0, z1: 0.5, frameUV: [0.9, 0.1] });
  const hits = Array.from(md.indices).filter((v) => Math.abs(md.uvs[v * 2] - 0.9) < 1e-6 && Math.abs(md.uvs[v * 2 + 1] - 0.1) < 1e-6).length;
  assert.equal(hits, 18);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// geom/ride.js - a ball resting on the plunger rides it back (VISUAL QA: the retracted rod used to leave the ball hanging 1 unit above it)
// ---------------------------------------------------------------------------------------------------------------------------------------
import { plungerRideOffset, PLUNGER_REST_SPEED } from '../src/render/geom/ride.js';

test('plungerRideOffset: only a ball resting on the plunger rides it, by pull * travel', () => {
  const P = data.PLUNGER, travel = data.HEIGHTS.plungerTravel;
  const restY = P.face[0][1] - 0.3;
  near(restY, 11.674978, 1e-6, 'rest face of the ball centre (SPEC 4.9.14: 11.675)');
  const resting = { x: P.feed[0], y: restY, mask: 1, speed: 0.03 };
  assert.equal(plungerRideOffset(resting, 0, P, travel), 0, 'no pull, no offset');
  near(plungerRideOffset(resting, 0.5, P, travel), 0.5 * travel, 1e-12);
  near(plungerRideOffset(resting, 1, P, travel), travel, 1e-12);
  near(plungerRideOffset(resting, 7, P, travel), travel, 1e-12, 'pull is clamped to 1');
  // the feed position (10.08, still falling onto the rod), a ball in flight, another layer or another lane: no offset
  assert.equal(plungerRideOffset({ ...resting, y: 10.0849 }, 1, P, travel), 0, 'ball not yet on the plunger');
  assert.equal(plungerRideOffset({ ...resting, speed: PLUNGER_REST_SPEED + 1 }, 1, P, travel), 0, 'kicked ball');
  assert.equal(plungerRideOffset({ ...resting, x: -5.5 }, 1, P, travel), 0, 'other lane');
  assert.equal(plungerRideOffset({ ...resting, mask: 4 }, 1, P, travel), 0, 'other layer');
  assert.equal(plungerRideOffset({ ...resting, y: restY + 0.5 }, 1, P, travel), 0, 'ball below the rest face (cannot happen)');
  // the shifted ball still sits on the shifted rod head: ball centre + R == head face at every pull
  for (const pull of [0.2, 0.7, 1]) near(restY + plungerRideOffset(resting, pull, P, travel) + 0.3, P.face[0][1] + pull * travel, 1e-9);
});
