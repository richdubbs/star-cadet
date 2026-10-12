/**
 * src/render/table.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 "What to build" 1-5 + "Per-frame state read from RenderFrame" (additive module, imports three).
 * Builds the whole static + animated table scene ONCE from `data` and returns a controller whose update(frame, dt) applies the per-frame state
 * (flippers, plunger, drop/spot targets, bumpers, rebounders, kickbacks, gates, blocker, spinners, kickout / sink / ramp-hole glows, a_roll9).
 * All geometry is ORIGINAL (extruded from the DAT polygons / built from primitives); no game bitmaps, no pilot.
 *
 * Draw-call budget (measured): ~230 draw calls / ~22k triangles in the main pass (< 250 / < 250k); static geometry is merged per material
 * (walls, rails, posts, wires, deck); animated parts (targets, bumpers, flippers, plunger, mouths) keep their own meshes.
 *
 * ASSUMPTIONS (visual freedoms of SPEC 3.6 / 6.8, all documented in the hand-off note):
 *  - wall_102 (thin supports under the lower ramp) is not drawn: the ramp slab and its rails already show that boundary and drawing it would poke
 *    through the ramp surface; walls 288 / 301 (slingshot bodies) carry the FLOOR texture on their top face (the painted slingshot decal).
 *  - drop targets are symmetric slabs (yellow tile on both big faces); heights come from the data (`top`). Every target slab is ONE single-material mesh
 *    (geom/shapes.targetSlabMesh: top and ends sample the tan frame border of the same texture): 22 draw calls per pass instead of 110.
 *  - wormhole sinks and the escape chute get a black mouth panel with a steel arch (coloured for the three wormholes) on the un-inflated capture line;
 *    kickouts get a dark pit decal with a steel ring; the ball sinks into it (held balls have z 0 / 0.3).
 *  - the hidden tube mouth (s_ramp9 entry) gets a half-pipe hood with a steel rim; its far end a mouth panel like the sinks.
 *  - visual sizes follow the COLLISION geometry where it matters: drop/spot target slabs are as thick as their collision polygon, the attack bumper
 *    drum is never wider than the ball can reach (r + R), gate flaps sit behind their line.
 */
import * as THREE from 'three';
import { extrudePolygonParts } from './geom/extrude.js';
import { MeshBuilder, mergeMeshData } from './geom/meshdata.js';
import { boxMesh, targetSlabMesh, cylinderMesh, annulusMesh, discMesh, wireMesh, flipperParts, regularPolygon, insetRibbonMesh, archMesh } from './geom/shapes.js';
import { buildDeckParts } from './geom/deck.js';
import { toGeometry } from './three_utils.js';
import { patchUV, FLOOR_RECT } from './art/mapping.js';
import { bumperRingColor } from './art/palette.js';
import { approach, clamp, rotYOfDir } from './convert.js';

const TAU = Math.PI * 2;

/** Walls that are NOT drawn as plain rails (handled separately). */
const SLING_BODIES = new Set(['wall_288', 'wall_301']);
const RUBBER_WALLS = new Set(['wall_329', 'wall_330', 'wall_331', 'wall_332', 'wall_333', 'wall_334', 'wall_335', 'wall_336']);

/**
 * @param {{data:import('../types.js').DataModule, art:import('../types.js').ArtPack, kit:ReturnType<typeof import('./materials.js').createMaterialKit>}} o
 */
export function buildTable(o) {
  const { data, art, kit } = o;
  const H = data.HEIGHTS;
  const deckZ = H.deckSurface;
  const root = new THREE.Group();
  root.name = 'table';
  /** @type {THREE.BufferGeometry[]} */
  const geos = [];
  /** @type {THREE.Mesh[]} */
  const casters = [];
  /** @type {THREE.Mesh[]} */
  const receivers = [];
  const floorPatch = art && art.floor && art.floor.canvas ? art.floor : { rect: FLOOR_RECT, width: 1, height: 1 };

  /** Add a mesh from a geometry; returns it. */
  function mesh(geo, material, opt = {}) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = !!opt.cast; m.receiveShadow = !!opt.receive;
    if (opt.order) m.renderOrder = opt.order;
    if (opt.name) m.name = opt.name;
    if (m.castShadow) casters.push(m);
    if (m.receiveShadow) receivers.push(m);
    (opt.parent || root).add(m);
    geos.push(geo);
    return m;
  }
  const place = (obj, x, y, z = 0) => { obj.position.set(-x, z, y); return obj; };

  // =============================================================================================================================================
  // 1. floor
  // =============================================================================================================================================
  {
    const b = new MeshBuilder();
    const r = floorPatch.rect;
    const corners = [[r.xMin, r.yMin], [r.xMax, r.yMin], [r.xMax, r.yMax], [r.xMin, r.yMax]];
    const ids = corners.map(([x, y]) => { const uv = patchUV(floorPatch, x, y); return b.vertex(x, y, 0, 0, 0, 1, uv[0], uv[1]); });
    b.quad(ids[0], ids[1], ids[2], ids[3]);
    mesh(toGeometry(b.build()), kit.floor, { receive: true, name: 'floor' });
  }

  // 2. the cabinet walls around the playfield are part of the cabinet (cabinet.js)

  // =============================================================================================================================================
  // 3. island walls: dark metal body, red band under a silver top (rails); rubbers; slingshot bodies; rebounders (dynamic)
  // =============================================================================================================================================
  const wallBody = [], wallBand = [], wallCap = [], wallCapArt = [], wallCapDeck = [], rubberStatic = [], slingTops = [], slingSides = [];
  const rebounders = {};
  for (const w of data.WALLS) {
    if (w.solid !== 'island' || w.name === 'wall_102') continue;
    const z0 = w.mask === 4 ? deckZ : 0;
    const top = w.top;
    if (w.name.startsWith('v_rebo')) {
      const p = extrudePolygonParts(w.pts, 0, top, { uv: (x, y, kind, s, z) => (kind === 'side' ? [s * 0.8, z * 0.8] : [x * 0.8, y * 0.8]), smoothAngleDeg: 50 });
      const geo = toGeometry(mergeMeshData([p.side, p.top], ['side', 'top']));
      const mat = kit.rubber.clone();
      kit.mats.push(mat);
      const m = mesh(geo, [mat, mat], { cast: true, receive: true, name: w.name });
      rebounders[w.name] = { mesh: m, mat, e: 0 };
      continue;
    }
    if (RUBBER_WALLS.has(w.name)) {
      const p = extrudePolygonParts(w.pts, z0, top, { uv: (x, y, kind, s, z) => (kind === 'side' ? [s * 0.8, z * 0.8] : [x * 0.8, y * 0.8]), smoothAngleDeg: 50 });
      rubberStatic.push(p.side, p.top);
      continue;
    }
    if (SLING_BODIES.has(w.name)) {
      const p = extrudePolygonParts(w.pts, z0, top, { uv: (x, y, kind, s, z) => (kind === 'side' ? [s * 0.4, z * 0.4] : patchUV(floorPatch, x, y)) });
      slingSides.push(p.side); slingTops.push(p.top);
      continue;
    }
    const bandH = Math.min(0.12, (top - z0) * 0.22);
    const body = extrudePolygonParts(w.pts, z0, top - bandH, { uv: (x, y, kind, s, z) => [s * 0.4, z * 0.4] });
    const band = extrudePolygonParts(w.pts, top - bandH, top, { smoothAngleDeg: 40 });
    wallBody.push(body.side); wallBand.push(band.side);
    // top face: the painted art under the wall (floor art for the playfield, deck art on the deck) with a silver rail ribbon along its edge
    const onDeck = w.mask === 4;
    const patch = onDeck && art && art.deck && art.deck.canvas ? art.deck : floorPatch;
    const cap = extrudePolygonParts(w.pts, z0, top, { uv: (x, y) => patchUV(patch, x, y) });
    (onDeck ? wallCapDeck : wallCapArt).push(cap.top);
    wallCap.push(insetRibbonMesh(w.pts, top + 0.003, onDeck ? 0.14 : 0.17));
  }
  if (wallBody.length) {
    mesh(toGeometry(mergeMeshData(wallBody)), kit.wallMetal, { cast: true, receive: true, name: 'wallBody' });
    mesh(toGeometry(mergeMeshData(wallBand)), kit.wallRed, { cast: true, name: 'wallBand' });
    mesh(toGeometry(mergeMeshData(wallCapArt)), kit.floor, { cast: true, receive: true, name: 'wallCapArt' });
    if (wallCapDeck.length) mesh(toGeometry(mergeMeshData(wallCapDeck)), kit.deck, { cast: true, receive: true, name: 'wallCapDeck' });
    mesh(toGeometry(mergeMeshData(wallCap)), kit.wallCap, { cast: false, receive: true, name: 'wallCap' });
  }
  if (rubberStatic.length) mesh(toGeometry(mergeMeshData(rubberStatic)), kit.rubber, { cast: true, receive: true, name: 'rubbers' });
  if (slingSides.length) {
    mesh(toGeometry(mergeMeshData(slingSides)), kit.wallMetal, { cast: true, receive: true, name: 'slingSides' });
    mesh(toGeometry(mergeMeshData(slingTops)), kit.floor, { cast: true, receive: true, name: 'slingTops' });
  }

  // =============================================================================================================================================
  // 4. posts: silver foot, red band, silver cap (deck posts 326-328 stand on the deck)
  // =============================================================================================================================================
  {
    const foot = [], band = [], cap = [];
    for (const p of data.POSTS) {
      const base = p.mask === 4 ? deckZ : 0;
      const topZ = p.top;
      const hgt = topZ - base;
      const [cx, cy] = p.c;
      const bandLo = base + hgt * (H.postRubberBand[0] / H.postCap), bandHi = base + hgt * (H.postRubberBand[1] / H.postCap);
      foot.push(cylinderMesh({ cx, cy, r: p.r, z0: base, z1: bandLo, segments: 14, capTop: false }));
      band.push(cylinderMesh({ cx, cy, r: p.r, z0: bandLo, z1: bandHi, segments: 14, capTop: false, uRepeat: 2, vScale: 2 }));
      cap.push(cylinderMesh({ cx, cy, r: p.r * 1.12, rTop: p.r * 0.95, z0: bandHi, z1: topZ, segments: 14, capTop: true }));
      foot.push(cylinderMesh({ cx, cy, r: p.r * 1.12, z0: base, z1: base + 0.03, segments: 14, capTop: true }));
    }
    mesh(toGeometry(mergeMeshData(foot)), kit.silver, { cast: true, name: 'postFoot' });
    mesh(toGeometry(mergeMeshData(band)), kit.postBand, { cast: true, name: 'postBand' });
    mesh(toGeometry(mergeMeshData(cap)), kit.silver, { cast: true, name: 'postCap' });
  }

  // =============================================================================================================================================
  // 5. ramp + deck + rails (one height field), ramp-hole decal, hidden-tube covers
  // =============================================================================================================================================
  const deckParts = buildDeckParts(data, { cell: 0.1 });
  mesh(toGeometry(deckParts.surface), kit.deck, { receive: true, cast: true, name: 'deckSurface' });
  mesh(toGeometry(mergeMeshData([deckParts.railInner, deckParts.railOuter])), kit.rampSide, { cast: true, receive: true, name: 'deckRails' });
  mesh(toGeometry(deckParts.railTop), kit.rampRailTop, { cast: true, name: 'deckRailTop' });

  // =============================================================================================================================================
  // holes, pits, mouths
  // =============================================================================================================================================
  /** dark pit decal on the floor + steel ring; returns the glow mesh handle. */
  function pit(cx, cy, r, z, glowColor) {
    const pitGeo = toGeometry(discMesh({ cx, cy, r: r * 1.5, z: z + 0.003, segments: 28 }));
    mesh(pitGeo, kit.pit, { order: 2, name: 'pit' });
    mesh(toGeometry(annulusMesh({ cx, cy, r0: r - 0.03, r1: r + 0.07, z: z + 0.012, segments: 32 })), kit.steelDark, { name: 'pitRing' });
    const g = kit.glow(glowColor);
    const gm = mesh(toGeometry(discMesh({ cx, cy, r: r * 1.9, z: z + 0.02, segments: 28 })), g, { order: 3, name: 'pitGlow' });
    gm.visible = false;
    return { mesh: gm, mat: g, e: 0 };
  }
  const kickoutGlow = {};
  for (const k of data.KICKOUTS) {
    const r = k.id === 1 ? 0.34 : 0.43;
    kickoutGlow[k.name] = pit(k.c[0], k.c[1], r, 0, k.id === 1 ? 0xff5030 : k.id === 2 ? 0x60a8ff : 0xb070ff);
  }
  // ramp hole on the deck
  const rampHoleGlow = {};
  {
    const hc = data.RAMP_HOLE.c;
    mesh(toGeometry(discMesh({ cx: hc[0], cy: hc[1], r: 0.5, z: deckZ + 0.006, segments: 28 })), kit.pit, { order: 2, name: 'rampHolePit' });
    mesh(toGeometry(annulusMesh({ cx: hc[0], cy: hc[1], r0: 0.3, r1: 0.38, z: deckZ + 0.014, segments: 28 })), kit.steelDark, { name: 'rampHoleRing' });
    const g = kit.glow(0x7fd0ff);
    const gm = mesh(toGeometry(discMesh({ cx: hc[0], cy: hc[1], r: 0.75, z: deckZ + 0.02, segments: 24 })), g, { order: 3, name: 'rampHoleGlow' });
    gm.visible = false;
    rampHoleGlow.mesh = gm; rampHoleGlow.mat = g; rampHoleGlow.e = 0;
  }

  // sink / chute / tube mouths: black panel on the (un-inflated) capture line, steel arch (colour = wormhole colour)
  const mouths = {};
  const SINK_COLORS = { red: 0xe02a22, green: 0x22c24a, yellow: 0xe8d82a };
  function mouth(name, p0, p1, normal, colorHex, lift = 0) {
    const g = new THREE.Group();
    g.name = name;
    const mx = (p0[0] + p1[0]) / 2 + normal[0] * 0.03, my = (p0[1] + p1[1]) / 2 + normal[1] * 0.03;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const ang = rotYOfDir(p1[0] - p0[0], p1[1] - p0[1]);
    place(g, mx, my, lift);
    g.rotation.y = ang;
    const radius = Math.min(0.5, len / 2);
    // black panel (arch shaped: rectangle + half disc) approximated by a plane + circle
    const panelMat = kit.black;
    const rect = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.98, 0.36), panelMat);
    rect.position.y = 0.18; rect.renderOrder = 2;
    const half = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.98, 20, 0, Math.PI), panelMat);
    half.position.y = 0.36;
    g.add(rect, half);
    geos.push(rect.geometry, half.geometry);
    const ringMat = kit.standard({ color: new THREE.Color(colorHex), roughness: 0.3, metalness: 0.7, emissive: new THREE.Color(colorHex), emissiveIntensity: 0.0 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.055, 8, 24, Math.PI), ringMat);
    arch.position.y = 0.36; arch.castShadow = true;
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 8), ringMat);
    postL.position.set(-radius, 0.18, 0);
    const postR = postL.clone(); postR.position.x = radius;
    g.add(arch, postL, postR);
    geos.push(arch.geometry, postL.geometry);
    root.add(g);
    const glow = kit.glow(colorHex);
    const gm = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.8, 20), glow);
    gm.rotation.x = -Math.PI / 2; gm.position.set(0, 0.03, 0); gm.visible = false; gm.renderOrder = 3;
    g.add(gm); geos.push(gm.geometry);
    return { group: g, ringMat, glowMat: glow, glowMesh: gm, e: 0 };
  }
  for (const s of data.SINKS) {
    const edge = s.edges.find((e) => e.k === 'line');
    const n = edge ? [edge.nx, edge.ny] : [0, 1];
    const color = s.color ? SINK_COLORS[s.color] : 0x9aa0ac;
    mouths[s.name] = mouth(s.name, s.line[0], s.line[1], n, color);
  }
  // hidden tube: exit mouth (far end) as a mouth panel; entry mouth as a small roofed hood
  {
    const ex = data.RAMPS.tube.exitFar;
    const dx = ex.p1[0] - ex.p0[0], dy = ex.p1[1] - ex.p0[1], l = Math.hypot(dx, dy);
    mouths.tubeExit = mouth('tubeExit', ex.p0, ex.p1, [dy / l, -dx / l], 0x7a60c8);   // emerging balls move along +n = (dy, -dx)/|d|
    const en = data.RAMPS.tube.enter;
    const xa = Math.min(en.p0[0], en.p1[0]) - 0.05, xb = Math.max(en.p0[0], en.p1[0]) + 0.02;
    const yFront = (en.p0[1] + en.p1[1]) / 2 - 0.0, depth = 1.15;
    const cx = (xa + xb) / 2, cy = yFront - depth / 2;
    // a half-pipe hood (clearance 0.95: the ball, top 0.6, passes under) with a steel rim at the mouth
    const r = (xb - xa) / 2;
    const hood = archMesh({ cx, y0: yFront, y1: yFront - depth, r, z0: 0.0, segments: 20, });
    const hoodMat = kit.hoodDark.clone();
    hoodMat.side = THREE.DoubleSide;
    kit.mats.push(hoodMat);
    mesh(toGeometry(hood), hoodMat, { cast: true, receive: true, name: 'tubeHood' });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.055, 8, 24, Math.PI), kit.steelDark);
    rim.position.set(-cx, 0, yFront); rim.castShadow = true;
    root.add(rim); geos.push(rim.geometry);
    mesh(toGeometry(discMesh({ cx, cy: yFront - depth / 2, r: 0.7, z: 0.01, segments: 20 })), kit.pit, { order: 2, name: 'tubePit' });
  }

  // =============================================================================================================================================
  // 6. bumpers
  // =============================================================================================================================================
  const bumpers = {};
  for (const b of data.BUMPERS) {
    const attack = b.kind === 'attack';
    const spec = attack ? H.attackBumper : H.launchBumper;
    const base = b.mask === 4 ? deckZ : 0;
    const R = Math.min(spec.radius, b.r + 0.3 - 0.02);   // never wider than the ball can reach (collision radius + R)
    const bodyH = attack ? spec.drumTop : spec.bodyAboveDeck;
    const g = new THREE.Group();
    g.name = b.name;
    place(g, b.c[0], b.c[1], base);
    root.add(g);
    const baseR = attack ? spec.baseRingRadius : R * 1.12;
    mesh(toGeometry(cylinderMesh({ cx: 0, cy: 0, r: baseR, z0: 0, z1: 0.04, segments: 28 })), kit.bumperBase, { parent: g, cast: true, receive: true });
    mesh(toGeometry(cylinderMesh({ cx: 0, cy: 0, r: R, z0: 0, z1: bodyH, segments: 28, capTop: true, uRepeat: 1, vScale: 1 })), kit.bumperDrum, { parent: g, cast: true, receive: true });
    // star ring on the drum top (tinted per level) - ART's white star texture when present, else an own 7-point star polygon
    let starGeo;
    const starMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(bumperRingColor(b.kind, 0)), map: kit.tex.bumperStar || null, transparent: !!kit.tex.bumperStar, depthWrite: !kit.tex.bumperStar,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    kit.mats.push(starMat);
    if (kit.tex.bumperStar) {
      const q = new MeshBuilder();
      const s = R * 2.0;
      const a = q.vertex(-s / 2, -s / 2, bodyH + 0.006, 0, 0, 1, 0, 0), c = q.vertex(s / 2, -s / 2, bodyH + 0.006, 0, 0, 1, 1, 0);
      const d = q.vertex(s / 2, s / 2, bodyH + 0.006, 0, 0, 1, 1, 1), e = q.vertex(-s / 2, s / 2, bodyH + 0.006, 0, 0, 1, 0, 1);
      q.quad(a, c, d, e);
      starGeo = toGeometry(q.build());
    } else {
      // own 7-point star RING (outer points / inner notches, open in the middle so the depressed cap stays visible)
      const sb = new MeshBuilder();
      const zz = bodyH + 0.006, hole = R * 0.4;
      const outer = [], inner = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + 0.2, rr = i % 2 === 0 ? R * 0.97 : R * 0.64;
        outer.push(sb.vertex(Math.cos(a) * rr, Math.sin(a) * rr, zz, 0, 0, 1, 0.5, 0.5));
        inner.push(sb.vertex(Math.cos(a) * hole, Math.sin(a) * hole, zz, 0, 0, 1, 0.5, 0.5));
      }
      for (let i = 0; i < 14; i++) { const j = (i + 1) % 14; sb.quad(outer[i], outer[j], inner[j], inner[i]); }
      starGeo = toGeometry(sb.build());
    }
    mesh(starGeo, starMat, { parent: g, order: 4 });
    // cap (depresses on a hit)
    const capR = R * 0.5;
    const capGrp = new THREE.Group();
    g.add(capGrp);
    mesh(toGeometry(cylinderMesh({ cx: 0, cy: 0, r: capR, rTop: capR * 0.82, z0: bodyH, z1: bodyH + (attack ? 0.14 : 0.12), segments: 24 })), kit.bumperCap, { parent: capGrp, cast: true });
    // hit flash: additive halo on the drum top
    const haloMat = kit.glow(0xffffff);
    const halo = mesh(toGeometry(discMesh({ cx: 0, cy: 0, r: R * 1.85, z: bodyH + 0.012, segments: 28 })), haloMat, { parent: g, order: 6 });
    halo.visible = false;
    bumpers[b.name] = { def: b, group: g, cap: capGrp, starMat, travel: spec.capTravel, e: 0, level: -1, kind: b.kind, halo, haloMat };
  }

  // =============================================================================================================================================
  // 7. targets
  // =============================================================================================================================================
  /** long-axis rectangle of a 4-point target polygon */
  function rectOf(poly) {
    const e0 = [poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]], e1 = [poly[2][0] - poly[1][0], poly[2][1] - poly[1][1]];
    const l0 = Math.hypot(e0[0], e0[1]), l1 = Math.hypot(e1[0], e1[1]);
    const long = l0 >= l1 ? e0 : e1;
    return {
      cx: (poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4, cy: (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4,
      len: Math.max(l0, l1), thick: Math.min(l0, l1), rot: Math.atan2(long[1], long[0]),
    };
  }
  /** A target slab as ONE single-material mesh (geom/shapes.targetSlabMesh): one draw call per pass instead of five. */
  const targetGeometry = (opts) => toGeometry(targetSlabMesh(opts));
  const popups = {};
  for (const t of data.POPUP_TARGETS) {
    const r = rectOf(t.poly);
    const geo = targetGeometry({ cx: r.cx, cy: r.cy, w: r.len + 0.06, d: Math.max(r.thick * 1.35, 0.11), z0: t.top - 0.85, z1: t.top, rot: r.rot, uv: [1, 1] });
    const m = mesh(geo, kit.targetFace, { cast: true, receive: true, name: t.name });
    popups[t.name] = { mesh: m, h: 1, top: t.top };
  }
  const solos = {};
  for (const t of data.SOLO_TARGETS) {
    const r = rectOf(t.poly);
    const geo = targetGeometry({ cx: r.cx, cy: r.cy, w: r.len + 0.04, d: Math.max(r.thick * 1.25, 0.09), z0: 0, z1: t.top, rot: r.rot, uv: [1, 1] });
    const faceMat = kit.targetFace.clone(); kit.mats.push(faceMat);       // own material: the hit flash is per target
    const m = mesh(geo, faceMat, { cast: true, receive: true, name: t.name });
    solos[t.name] = { mesh: m, mat: faceMat };
  }

  // =============================================================================================================================================
  // 8. flippers
  // =============================================================================================================================================
  const flippers = {};
  for (const f of data.FLIPPERS) {
    const parts = flipperParts(f, { z0: 0.06, z1: H.flipperThickness + 0.06 });
    const g = new THREE.Group();
    g.name = f.name;
    place(g, f.pivot[0], f.pivot[1], 0);
    root.add(g);
    // the side/top meshes are authored relative to the pivot in T-frame (x,y) and converted by toGeometry; the group carries the live angle
    mesh(toGeometry(parts.top), kit.flipperTop, { parent: g, cast: true, receive: true });
    mesh(toGeometry(parts.side), kit.flipperSide, { parent: g, cast: true });
    mesh(toGeometry(cylinderMesh({ cx: 0, cy: 0, r: 0.09, z0: 0, z1: 0.5, segments: 12 })), kit.silver, { parent: g });
    flippers[f.name] = { group: g };
  }

  // =============================================================================================================================================
  // 9. plunger (rod + head + spring)
  // =============================================================================================================================================
  const plunger = {};
  {
    const P = data.PLUNGER;
    const cx = (-7.51 + -6.5) / 2;                 // lane centre
    const faceY = P.face[0][1];
    const head = new THREE.Group();
    head.name = 'plungerHead';
    root.add(head);
    const headLen = 0.48, shaftLen = 3.0, r = H.plungerRodDia / 2;
    const headGeo = new THREE.CylinderGeometry(r, r, headLen, 20); headGeo.rotateX(Math.PI / 2);
    const hm = mesh(headGeo, kit.chrome, { parent: head, cast: true });
    hm.position.set(-cx, 0.3, faceY + headLen / 2);
    const shaftGeo = new THREE.CylinderGeometry(0.11, 0.11, shaftLen, 12); shaftGeo.rotateX(Math.PI / 2);
    const sm = mesh(shaftGeo, kit.chrome, { parent: head, cast: true });
    sm.position.set(-cx, 0.3, faceY + headLen + shaftLen / 2);
    // spring: helix about the z axis (three), unit length, scaled to the live length
    class Helix extends THREE.Curve {
      getPoint(t, target = new THREE.Vector3()) {
        const a = t * TAU * 9;
        return target.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, t);
      }
    }
    const springGeo = new THREE.TubeGeometry(new Helix(), 160, 0.032, 6, false);
    const spring = mesh(springGeo, kit.spring, { cast: true, name: 'plungerSpring' });
    spring.position.set(-cx, 0.3, faceY + headLen);
    const restSpring = 14.3 - (faceY + headLen);
    spring.scale.z = restSpring;
    // fixed collar the spring pushes against
    const collar = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 16); collar.rotateX(Math.PI / 2);
    const cm = mesh(collar, kit.steelDark, {});
    cm.position.set(-cx, 0.3, 14.3);
    plunger.head = head; plunger.spring = spring; plunger.restSpring = restSpring; plunger.base = faceY + headLen; plunger.collarY = 14.3;
  }

  // =============================================================================================================================================
  // 10. kickbacks, gates, blocker
  // =============================================================================================================================================
  const kickbacks = {};
  for (const k of data.KICKBACKS) {
    const [a, b] = k.line;
    const mx = (a[0] + b[0]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = new THREE.Group();
    g.name = k.name;
    root.add(g);
    const plate = boxMesh({ cx: mx, cy: a[1] + 0.09, w: len, d: 0.18, z0: 0, z1: H.kickerPlate, uv: [1, 1] });
    mesh(toGeometry(plate), kit.steelDark, { parent: g, cast: true });
    const rod = new THREE.CylinderGeometry(0.225, 0.225, 1.5, 14); rod.rotateX(Math.PI / 2);
    const rm = mesh(rod, kit.chrome, { parent: g, cast: true });
    rm.position.set(-mx, 0.3, a[1] + 0.18 + 0.75);
    kickbacks[k.name] = { group: g, e: 0 };
  }
  const gates = {};
  for (const gt of data.GATES) {
    const [a, b] = gt.line;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e = gt.edges && gt.edges.find((q) => q.k === 'line');
    const n = e ? [e.nx, e.ny] : [0, 0];                    // the ball lives on +n: the flap sits BEHIND the line so the ball just touches it
    const geo = toGeometry(boxMesh({ cx: (a[0] + b[0]) / 2 - n[0] * 0.05, cy: (a[1] + b[1]) / 2 - n[1] * 0.05, w: len, d: 0.1, z0: 0, z1: H.gateFlap, rot: Math.atan2(b[1] - a[1], b[0] - a[0]), uv: [1, 1] }));
    const m = mesh(geo, kit.gateFlap, { cast: true, name: gt.name });
    gates[gt.name] = { mesh: m };
  }
  const blocker = {};
  {
    const B = data.BLOCKER;
    const g = new THREE.Group();
    g.name = 'blocker';
    root.add(g);
    mesh(toGeometry(cylinderMesh({ cx: B.c[0], cy: B.c[1], r: 0.2, z0: 0, z1: H.blockerPost - 0.08, segments: 16 })), kit.silver, { parent: g, cast: true });
    mesh(toGeometry(cylinderMesh({ cx: B.c[0], cy: B.c[1], r: 0.22, z0: H.blockerPost - 0.08, z1: H.blockerPost, segments: 16 })), kit.wallRed, { parent: g, cast: true });
    blocker.group = g; blocker.h = 0;
    g.visible = false;
  }

  // =============================================================================================================================================
  // 11. flag spinners, one-way wires, a_roll9 hexagon
  // =============================================================================================================================================
  const flags = {};
  for (const f of data.FLAGS) {
    const [a, b] = f.p0 ? [f.p0, f.p1] : [[0, 0], [1, 0]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = new THREE.Group();
    g.name = f.name;
    place(g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, H.flagAxisZ);
    g.rotation.y = rotYOfDir(b[0] - a[0], b[1] - a[1]);
    root.add(g);
    const pivot = new THREE.Group();
    g.add(pivot);
    const pg = new THREE.PlaneGeometry(len * 0.92, H.flagPanelChord); pg.rotateX(-Math.PI / 2);
    mesh(pg, kit.flagPanel, { parent: pivot, cast: true });
    const ax = new THREE.CylinderGeometry(0.03, 0.03, len, 8); ax.rotateZ(Math.PI / 2);
    mesh(ax, kit.silver, { parent: g });
    for (const sx of [-len / 2, len / 2]) {
      const post = new THREE.CylinderGeometry(0.05, 0.05, H.flagAxisZ + 0.1, 8);
      const pm = mesh(post, kit.silver, { parent: g, cast: true });
      pm.position.set(sx, -(H.flagAxisZ + 0.1) / 2 + 0.05, 0);
    }
    flags[f.name] = { pivot };
  }
  {
    const wires = [];
    for (const ow of data.ONEWAYS) {
      if (!ow.visible) continue;
      wires.push(wireMesh({ x0: ow.p0[0], y0: ow.p0[1], x1: ow.p1[0], y1: ow.p1[1], z: H.oneWayWireZ, r: H.oneWayWireRadius, segments: 8 }));
      for (const p of [ow.p0, ow.p1]) wires.push(cylinderMesh({ cx: p[0], cy: p[1], r: 0.06, z0: 0, z1: H.oneWayEndPost, segments: 10 }));
    }
    if (wires.length) mesh(toGeometry(mergeMeshData(wires)), kit.silver, { cast: true, name: 'oneWayWires' });
  }
  const roll9 = {};
  {
    const r9 = data.ROLLOVERS.find((r) => r.light);
    if (r9) {
      const c = r9.center;
      const outer = regularPolygon(c[0], c[1], 0.52, 6, Math.PI / 6);
      const inner = regularPolygon(c[0], c[1], 0.4, 6, Math.PI / 6);
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#b8561a'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const faceMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0c3a1c'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      kit.mats.push(ringMat, faceMat);
      mesh(toGeometry(extrudePolygonParts(outer, 0.011, 0.011).top), ringMat, { order: 3, name: 'roll9Ring' });
      mesh(toGeometry(extrudePolygonParts(inner, 0.013, 0.013).top), faceMat, { order: 4, name: 'roll9Face' });
      roll9.mat = faceMat; roll9.e = 0;
    }
  }

  // =============================================================================================================================================
  // per-frame update
  // =============================================================================================================================================
  const dark = new THREE.Color('#0c3a1c'), lit9 = new THREE.Color('#4cff80');
  const tmpColor = new THREE.Color();
  /** parsed once: the ring colour of every bumper level (no string parsing per frame) */
  const ringColors = { attack: [0, 1, 2, 3].map((l) => new THREE.Color(bumperRingColor('attack', l))), launch: [0, 1, 2, 3].map((l) => new THREE.Color(bumperRingColor('launch', l))) };
  const white = new THREE.Color(1, 1, 1);
  const SINK_NAMES = data.SINKS.map((s) => s.name);

  /**
   * @param {import('../types.js').RenderFrame} frame @param {number} dt seconds
   */
  function update(frame, dt) {
    const ph = frame.physics;
    if (!ph) return;
    // flippers
    for (const name in flippers) { const s = ph.flippers && ph.flippers[name]; if (s) flippers[name].group.rotation.y = s.angle; }
    // plunger
    if (ph.plunger) {
      const pull = clamp(ph.plunger.pull, 0, 1) * H.plungerTravel;
      plunger.head.position.z = pull;
      plunger.spring.position.z = plunger.base + pull;
      plunger.spring.scale.z = Math.max(0.12, plunger.collarY - plunger.base - pull);
    }
    // popups
    for (const name in popups) {
      const s = ph.popups && ph.popups[name]; const p = popups[name];
      if (!s) continue;
      p.h = approach(p.h, s.up ? 1 : 0, dt, 0.03);
      p.mesh.position.y = -(1 - p.h) * 0.85;
      p.mesh.visible = p.h > 0.02;
    }
    // solo targets
    for (const name in solos) {
      const s = ph.solos && ph.solos[name]; if (!s) continue;
      solos[name].mat.emissive.setRGB(s.flash * 0.9, s.flash * 0.8, s.flash * 0.25);
    }
    // bumpers (hit -> cap depresses, ring flashes; ring colour by level)
    const levels = frame.rules && frame.rules.bumperLevels;
    for (const name in bumpers) {
      const b = bumpers[name];
      const s = ph.bumpers && ph.bumpers[name];
      b.e = approach(b.e, s && s.hit ? 1 : 0, dt, s && s.hit ? 0.012 : 0.05);
      b.cap.position.y = -b.travel * b.e;
      const lv = levels ? (b.kind === 'attack' ? levels.attack : levels.launch) : 0;
      tmpColor.copy(ringColors[b.kind][clamp(lv | 0, 0, 3)]);
      b.starMat.color.copy(tmpColor).lerp(white, b.e * 0.75);
      b.haloMat.color.copy(tmpColor).lerp(white, 0.5); b.haloMat.opacity = b.e * 0.55; b.halo.visible = b.e > 0.02;
    }
    // rebounders
    for (const name in rebounders) {
      const r = rebounders[name]; const s = ph.rebounders && ph.rebounders[name];
      r.e = approach(r.e, s && s.flash ? 1 : 0, dt, s && s.flash ? 0.01 : 0.06);
      r.mat.emissive.setRGB(r.e * 0.95, r.e * 0.4, r.e * 0.3);
    }
    // kickbacks (plate kicks toward the table: -y)
    for (const name in kickbacks) {
      const k = kickbacks[name]; const s = ph.kickbacks && ph.kickbacks[name];
      k.e = approach(k.e, s && s.kicked ? 1 : 0, dt, s && s.kicked ? 0.015 : 0.05);
      k.group.position.z = -0.5 * k.e;      // three +z = T +y
    }
    // gates
    for (const name in gates) { const s = ph.gates && ph.gates[name]; if (s) gates[name].mesh.visible = !!s.enabled; }
    // blocker
    if (ph.blocker) {
      blocker.h = approach(blocker.h, ph.blocker.up ? 1 : 0, dt, 0.035);
      blocker.group.visible = blocker.h > 0.02;
      blocker.group.position.y = -(1 - blocker.h) * (H.blockerPost + 0.05);
    }
    // flags
    for (const name in flags) { const s = ph.flags && ph.flags[name]; if (s) flags[name].pivot.rotation.x = s.angle; }
    // kickouts / sinks / ramp hole glows
    const t = frame.time || 0;
    for (const name in kickoutGlow) {
      const g = kickoutGlow[name]; const s = ph.kickouts && ph.kickouts[name];
      let target = 0;
      if (s) {
        if (s.held) target = 0.75;
        else if (name === 'a_kout1' && s.active) target = 0.35 + 0.25 * Math.sin(t * 5);
      }
      g.e = approach(g.e, target, dt, 0.06);
      g.mat.opacity = g.e; g.mesh.visible = g.e > 0.01;
    }
    for (const name of SINK_NAMES) {
      const m = mouths[name]; const s = ph.sinks && ph.sinks[name];
      if (!m) continue;
      m.e = approach(m.e, s && s.occupied ? 1 : 0, dt, 0.06);
      m.ringMat.emissiveIntensity = m.e * 1.6;
      m.glowMat.opacity = m.e * 0.8; m.glowMesh.visible = m.e > 0.01;
    }
    // ramp hole glow while a ball sits in it
    if (rampHoleGlow.mat) {
      rampHoleGlow.e = approach(rampHoleGlow.e, ph.rampHole && ph.rampHole.occupied ? 1 : 0, dt, 0.06);
      rampHoleGlow.mat.opacity = rampHoleGlow.e * 0.7; rampHoleGlow.mesh.visible = rampHoleGlow.e > 0.01;
    }
    // a_roll9 hexagon
    if (roll9.mat) {
      const s = ph.rolloverSprites && ph.rolloverSprites.a_roll9;
      roll9.e = approach(roll9.e, s && s.lit ? 1 : 0, dt, 0.03);
      roll9.mat.color.copy(dark).lerp(lit9, roll9.e);
    }
  }

  return {
    root, update, casters, receivers,
    setShadows(on) { for (const m of casters) m.castShadow = on; for (const m of receivers) m.receiveShadow = on; },
    dispose() { for (const g of geos) g.dispose(); },
    /** exposed for tests / the harness */
    parts: { flippers, popups, solos, bumpers, rebounders, kickbacks, gates, blocker, flags, mouths, kickoutGlow, plunger, roll9, rampHoleGlow },
  };
}
