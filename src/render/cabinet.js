/**
 * src/render/cabinet.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: additive module (imports three). The arcade cabinet around the playfield, built once from primitives and the ART textures of
 * ArtPack.cabinet (art/cabinet.js); every texture falls back to a flat colour when missing. Panel dimensions: art/mapping.js CABINET.
 *
 * Parts (Three.js axes of the table: x = -Tx, y = height above the playfield, z = Ty; the playfield is flat, the room is tilted instead):
 *   body      trapezoid side panels with side art (the bottom is level in the room, so the body is deeper at the back), painted front and rear
 *             faces, inner walls above the playfield, violet T-molding on the front corners, satin-steel side rails and lockdown bar with a
 *             crisp highlight line (a polished finish would turn the key light into a long blooming streak), playfield glass (reflections only);
 *   front     coin door with lit price inserts, start button (blinks while no game runs), shooter rod + knob (follows the plunger pull);
 *   sides     flipper buttons (pushed in while the flipper key is held), leg plates;
 *   backbox   backlit backglass, speaker panel with two grilles and an amber dot-matrix display (dmd.js: player, ball, score, messages),
 *             side art, neon tubes, violet T-molding; it stands truly upright, i.e. leans back by the playfield incline;
 *   room      four equal legs with levelers and contact shadows, power cord, arcade carpet (mottled so its repeat does not show) in a violet
 *             under-glow (a point light under the body + a light pool on the carpet), fading into the dark room.
 * The real world is the table frame turned by the incline about x. Nothing here casts shadows (the key light's shadow map covers the playfield).
 *
 * update(frame, dt, dim) animates the moving parts; dim (0.55..1, tilt) also dims the lit parts.
 *
 * ASSUMPTIONS: about 35 draw calls; the display texture is re-uploaded only when its text changed. The playfield glass is a custom additive shader
 * (Fresnel x a procedural room with two light bars): a lit, alpha-blended sheet hazes the playfield, and a lit mirror throws a blooming glint of
 * the key light over the flippers in the close cinematic views.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from './three_utils.js';
import { createDmd } from './dmd.js';
import { CABINET, CABINET_SIDE, cabinetBottomY } from './art/mapping.js';

/** Playfield incline (rad): the table frame is the room turned by this about x. */
export const INCLINE = CABINET.incline;

/** Room floor (room axes) and backbox size, table units. The lockdown bar stands about 36 inches above the floor. */
export const ROOM = Object.freeze({ floorY: -27.4, box: Object.freeze({ halfW: 9.3, height: 22.5, depth: 8.0 }) });

/**
 * @param {{art:import('../types.js').ArtPack, kit:any, data:import('../types.js').DataModule}} o
 */
export function buildCabinet(o) {
  const { kit } = o;
  const art = (o.art && o.art.cabinet) || {};
  const root = new THREE.Group();
  root.name = 'cabinet';
  /** @type {THREE.BufferGeometry[]} */ const geos = [];
  /** @type {THREE.Material[]} */ const mats = [];
  /** @type {THREE.Texture[]} */ const texs = [];
  const own = (m) => { mats.push(m); return m; };
  const tex = (canvas, opts) => { const t = canvasTexture(canvas, { anisotropy: kit.aniso || 4, ...opts }); if (t) texs.push(t); return t; };
  const env = (k) => (kit.envMap ? { envMap: kit.envMap, envMapIntensity: k } : {});

  // ---- materials ------------------------------------------------------------------------------------------------------------------------
  const T = {
    sideL: tex(art.sideL), sideR: tex(art.sideR), front: tex(art.front), rear: tex(art.rear), boxRear: tex(art.boxRear), boxSide: tex(art.boxSide), backglass: tex(art.backglass),
    speaker: tex(art.speaker), coinDoor: tex(art.coinDoor), carpet: tex(art.carpet, { wrap: 'repeat', anisotropy: 16 }), mottle: tex(art.mottle, { wrap: 'repeat' }),
    inside: tex(art.inside, { wrap: 'repeat' }),
  };
  const lit = (map, color, extra = {}) => own(new THREE.MeshStandardMaterial({ map: map || null, color: map ? 0xffffff : new THREE.Color(color), ...extra }));
  const panel = { roughness: 0.42, metalness: 0.05, ...env(0.35) };
  const glowTex = kit.textures && kit.textures.glow ? kit.textures.glow : null;
  const M = {
    sideL: lit(T.sideL, '#1a0f3a', panel), sideR: lit(T.sideR, '#1a0f3a', panel), front: lit(T.front, '#1a0f3a', panel), rear: lit(T.rear, '#16142a', panel),
    boxRear: lit(T.boxRear, '#16142a', panel),
    boxSide: lit(T.boxSide, '#1a0f3a', panel),
    inside: lit(T.inside, '#17142e', { roughness: 0.6, metalness: 0.1, ...env(0.3) }),
    body: own(new THREE.MeshStandardMaterial({ color: 0x1c1a32, roughness: 0.5, metalness: 0.1, ...env(0.35) })),
    chrome: own(new THREE.MeshStandardMaterial({ color: 0xc4c8d2, roughness: 0.28, metalness: 1.0, ...env(0.55) })),
    rail: own(new THREE.MeshStandardMaterial({ color: 0xa4a8b4, roughness: 0.6, metalness: 1.0, ...env(0.6) })),
    roof: own(new THREE.MeshStandardMaterial({ color: 0x14122a, roughness: 0.7, metalness: 0.1, ...env(0.12) })),
    shine: own(new THREE.MeshBasicMaterial({ color: 0xd4d8e2 })),
    steel: own(new THREE.MeshStandardMaterial({ color: 0x8a909c, roughness: 0.45, metalness: 0.9, ...env(0.9) })),
    tmold: own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.45, 2.1), toneMapped: false })),
    coinDoor: lit(T.coinDoor, '#4a4e58', { roughness: 0.38, metalness: 0.75, ...env(0.9) }),
    speaker: lit(T.speaker, '#121216', { roughness: 0.5, metalness: 0.3, ...env(0.4) }),
    backglass: own(new THREE.MeshBasicMaterial({ map: T.backglass || null, color: T.backglass ? 0xffffff : 0x2a1458, toneMapped: false })),
    display: own(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 2.0, 2.0), toneMapped: false })),
    neonViolet: own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.75, 3.2), toneMapped: false })),
    neonCyan: own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 3.0), toneMapped: false })),
    coinLight: own(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.3, 0.18), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
    coinHalo: own(new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1.6, 0.2, 0.1), transparent: true, opacity: glowTex ? 0.5 : 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
    buttonRed: own(new THREE.MeshStandardMaterial({ color: 0xd4141e, roughness: 0.22, metalness: 0.05, emissive: new THREE.Color(0x5a0408), ...env(0.6) })),
    start: own(new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.25, metalness: 0.0, emissive: new THREE.Color(0xff8a00), emissiveIntensity: 0.6, ...env(0.5) })),
    knob: own(new THREE.MeshStandardMaterial({ color: 0xc8101c, roughness: 0.18, metalness: 0.0, ...env(0.8) })),
    leg: own(new THREE.MeshStandardMaterial({ color: 0x4a4a5e, roughness: 0.45, metalness: 0.5, ...env(0.9) })),
    rubber: own(new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.9, metalness: 0.0 })),
    carpet: lit(T.carpet, '#0a0812', { roughness: 1.0, metalness: 0.0, ...(T.carpet ? { color: new THREE.Color(0.3, 0.28, 0.34) } : {}) }),
    mottle: own(new THREE.MeshBasicMaterial({ map: T.mottle || null, color: 0x000000, transparent: true, opacity: T.mottle ? 0.85 : 0, depthWrite: false })),
    floorFade: own(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, vertexColors: true, depthWrite: false })),
    pool: own(new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(0.24, 0.1, 0.52), transparent: true, opacity: glowTex ? 1 : 0, blending: THREE.AdditiveBlending, depthWrite: false })),
    shadow: own(new THREE.MeshBasicMaterial({ map: kit.textures && kit.textures.shadow ? kit.textures.shadow : null, color: 0x000000, transparent: true, opacity: 1, depthWrite: false })),
    footprint: own(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, vertexColors: true, depthWrite: false })),
    distant: own(new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: glowTex ? 0.05 : 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false })),
    // playfield glass: only its Fresnel reflection of a dark room with two soft ceiling light bars is ADDED (no albedo, no direct-light glints), so it
    // is all but invisible from the normal steep view and shows a moving sheen when the view is turned low
    glass: own(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { strength: { value: 1 } },
      vertexShader: `varying vec3 vWorld; varying vec3 vNormal;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float strength; varying vec3 vWorld; varying vec3 vNormal;
        void main() {
          vec3 v = normalize(vWorld - cameraPosition);
          vec3 n = normalize(vNormal);
          float c = clamp(dot(-v, n), 0.0, 1.0);
          float f = 0.04 + 0.96 * pow(1.0 - c, 5.0);
          vec3 r = reflect(v, n);
          float bars = smoothstep(0.09, 0.0, abs(r.x - 0.3)) + smoothstep(0.06, 0.0, abs(r.x + 0.4));
          bars *= smoothstep(0.25, 0.55, r.y);
          vec3 env = vec3(0.02, 0.018, 0.04) + vec3(0.55, 0.56, 0.62) * bars + vec3(0.16, 0.08, 0.32) * smoothstep(0.4, 0.95, r.y);
          gl_FragColor = vec4(env * f * strength, 1.0);
        }`,
    })),
  };
  if (T.carpet) T.carpet.repeat.set(16, 16);
  if (T.mottle) { T.mottle.repeat.set(5.3, 5.3); T.mottle.rotation = 0.3; }
  if (T.inside) T.inside.wrapT = THREE.ClampToEdgeWrapping;

  // ---- quad batches (one merged mesh per material) ----------------------------------------------------------------------------------------
  /** @type {Map<THREE.Material, {pos:number[], nor:number[], uv:number[], idx:number[]}>} */
  const batches = new Map();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  /** Convex polygon (counter-clockwise seen from its front) with one uv per corner; a 4-corner call is a quad. */
  function poly(mat, pts, uvs) {
    let bt = batches.get(mat);
    if (!bt) { bt = { pos: [], nor: [], uv: [], idx: [] }; batches.set(mat, bt); }
    e1.subVectors(pts[1], pts[0]); e2.subVectors(pts[pts.length - 1], pts[0]); nrm.crossVectors(e1, e2).normalize();
    const base = bt.pos.length / 3;
    pts.forEach((p, i) => { bt.pos.push(p.x, p.y, p.z); bt.nor.push(nrm.x, nrm.y, nrm.z); bt.uv.push(uvs[i][0], uvs[i][1]); });
    for (let i = 1; i < pts.length - 1; i++) bt.idx.push(base, base + i, base + i + 1);
  }
  const quad = (mat, a, b, c, d, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) => poly(mat, [a, b, c, d], uv);
  /** Axis-aligned box as quads (faces chosen by letters: x X y Y z Z = -x +x -y +y -z +z). */
  function box(mat, x0, y0, z0, x1, y1, z1, faces = 'xXyYzZ') {
    const uvZY = [[0, 0], [z1 - z0, 0], [z1 - z0, y1 - y0], [0, y1 - y0]];
    if (faces.includes('X')) quad(mat, V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), uvZY);
    if (faces.includes('x')) quad(mat, V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), uvZY);
    if (faces.includes('Y')) quad(mat, V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0));
    if (faces.includes('y')) quad(mat, V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1));
    if (faces.includes('Z')) quad(mat, V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1));
    if (faces.includes('z')) quad(mat, V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0));
  }
  function flushBatches(parent, name) {
    for (const [mat, bt] of batches) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bt.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(bt.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bt.uv, 2));
      g.setIndex(bt.idx);
      g.computeBoundingSphere();
      geos.push(g);
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      if (mat.transparent) m.renderOrder = 8;
      parent.add(m);
    }
    batches.clear();
  }
  /** Merge a list of geometries into one mesh. */
  function merged(list, mat, parent, name) {
    const g = list.length === 1 ? list[0].clone() : mergeGeometries(list, false);
    for (const x of list) x.dispose();
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    parent.add(m);
    return m;
  }

  const { xIn, xOut, zFrontIn, zFront, zTopIn, zBox, zBack, yTop } = CABINET;
  const S = CABINET_SIDE;
  const yFrontBottom = S.yFront, yBackBottom = S.yBack;

  // =============================================================================================================================================
  // body
  // =============================================================================================================================================
  // trapezoid side panels, planar uv (u along the cabinet read from outside, v up from the deepest point)
  const sv = (y) => (y - yBackBottom) / S.height;
  poly(M.sideL, [V(-xOut, yBackBottom, zBack), V(-xOut, yFrontBottom, zFront), V(-xOut, yTop, zFront), V(-xOut, yTop, zBack)],
    [[0, 0], [1, sv(yFrontBottom)], [1, 1], [0, 1]]);
  poly(M.sideR, [V(xOut, yFrontBottom, zFront), V(xOut, yBackBottom, zBack), V(xOut, yTop, zBack), V(xOut, yTop, zFront)],
    [[0, sv(yFrontBottom)], [1, 0], [1, 1], [0, 1]]);
  // inner walls above the playfield (inside art repeats every 4 wall heights)
  const rep = (len) => len / (yTop * 4);
  const insideLen = zFrontIn - zTopIn;
  quad(M.inside, V(-xIn, -0.2, zFrontIn), V(-xIn, -0.2, zTopIn), V(-xIn, yTop, zTopIn), V(-xIn, yTop, zFrontIn), [[0, 0], [rep(insideLen), 0], [rep(insideLen), 1], [0, 1]]);
  quad(M.inside, V(xIn, -0.2, zTopIn), V(xIn, -0.2, zFrontIn), V(xIn, yTop, zFrontIn), V(xIn, yTop, zTopIn), [[0, 0], [rep(insideLen), 0], [rep(insideLen), 1], [0, 1]]);
  quad(M.inside, V(-xIn, -0.2, zTopIn), V(xIn, -0.2, zTopIn), V(xIn, yTop, zTopIn), V(-xIn, yTop, zTopIn), [[0, 0], [rep(2 * xIn), 0], [rep(2 * xIn), 1], [0, 1]]);
  quad(M.inside, V(xIn, -0.2, zFrontIn), V(-xIn, -0.2, zFrontIn), V(-xIn, yTop, zFrontIn), V(xIn, yTop, zFrontIn), [[0, 0], [rep(2 * xIn), 0], [rep(2 * xIn), 1], [0, 1]]);
  // front and rear faces (painted), the level bottom and the tops of the walls
  quad(M.front, V(-xOut, yFrontBottom, zFront), V(xOut, yFrontBottom, zFront), V(xOut, yTop, zFront), V(-xOut, yTop, zFront));
  quad(M.rear, V(xOut, yBackBottom, zBack), V(-xOut, yBackBottom, zBack), V(-xOut, yTop, zBack), V(xOut, yTop, zBack));
  quad(M.body, V(-xOut, yBackBottom, zBack), V(xOut, yBackBottom, zBack), V(xOut, yFrontBottom, zFront), V(-xOut, yFrontBottom, zFront));
  box(M.body, -xOut, yTop - 0.01, zBack, -xIn, yTop, zFront, 'Y');
  box(M.body, xIn, yTop - 0.01, zBack, xOut, yTop, zFront, 'Y');
  box(M.body, -xIn, yTop - 0.01, zFrontIn, xIn, yTop, zFront, 'Y');
  box(M.body, -xIn, yTop - 0.01, zBack, xIn, yTop, zTopIn, 'Y');
  // violet T-molding on the front corners (edge definition in the dark room)
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -xOut - 0.04 : xOut - 0.08, x1 = sx < 0 ? -xOut + 0.08 : xOut + 0.04;
    box(M.tmold, x0, yFrontBottom, zFront - 0.08, x1, yTop - 0.02, zFront + 0.04, 'xXZ');
  }
  // leg plates (steel, where the legs bolt on)
  for (const sx of [-1, 1]) for (const z of [zFront - 1.2, zBack + 1.2]) {
    const x = sx * (xOut + 0.02), y0 = cabinetBottomY(z) + 0.3, y1 = y0 + 3.3;
    if (sx < 0) quad(M.steel, V(x, y0, z - 0.9), V(x, y0, z + 0.9), V(x, y1, z + 0.9), V(x, y1, z - 0.9));
    else quad(M.steel, V(x, y0, z + 0.9), V(x, y0, z - 0.9), V(x, y1, z - 0.9), V(x, y1, z + 0.9));
  }
  // coin door (a slightly raised panel with steel edges) and its lit price inserts (insert = painted rectangle of art/cabinet.js)
  const door = { x0: -2.8, x1: 2.8, y0: -4.45, y1: 0.45, z: zFront + 0.12 };
  quad(M.coinDoor, V(door.x0, door.y0, door.z), V(door.x1, door.y0, door.z), V(door.x1, door.y1, door.z), V(door.x0, door.y1, door.z));
  box(M.rail, door.x0 - 0.12, door.y0 - 0.12, zFront, door.x1 + 0.12, door.y1 + 0.12, door.z - 0.002, 'xXyY');
  for (const u of [0.29, 0.71]) {
    const cx = door.x0 + (door.x1 - door.x0) * u, hw = (door.x1 - door.x0) * 0.0972;
    const yA = door.y1 - (door.y1 - door.y0) * 0.3084, yB = door.y1 - (door.y1 - door.y0) * 0.132, cy = (yA + yB) / 2;
    quad(M.coinLight, V(cx - hw, yA, door.z + 0.01), V(cx + hw, yA, door.z + 0.01), V(cx + hw, yB, door.z + 0.01), V(cx - hw, yB, door.z + 0.01));
    const r = hw * 2.1;
    quad(M.coinHalo, V(cx - r, cy - r, door.z + 0.02), V(cx + r, cy - r, door.z + 0.02), V(cx + r, cy + r, door.z + 0.02), V(cx - r, cy + r, door.z + 0.02));
  }
  // glass over the playfield, in the channel just under the rails
  quad(M.glass, V(-xIn, yTop - 0.12, zFrontIn), V(xIn, yTop - 0.12, zFrontIn), V(xIn, yTop - 0.12, zBox), V(-xIn, yTop - 0.12, zBox));
  flushBatches(root, 'cabinetBody');
  // leg bolts: two chrome carriage-bolt heads on every leg plate
  {
    const bolts = [];
    for (const sx of [-1, 1]) for (const z of [zFront - 1.2, zBack + 1.2]) for (const dz of [-0.45, 0.45]) {
      const y = cabinetBottomY(z) + 0.3 + 3.3 * 0.62;
      const g = new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 0.45, 1);
      g.rotateZ(-sx * Math.PI / 2);
      g.translate(sx * (xOut + 0.03), y, z + dz);
      bolts.push(g);
    }
    merged(bolts, M.chrome, root, 'legBolts');
  }

  // side rails (rounded profile, from the backbox to the lockdown bar) and the lockdown bar, with a highlight line along each
  {
    const xi = 7.62, xo = 8.98, y1 = yTop + 0.34;
    const rail = (sx) => {
      const s = new THREE.Shape();
      const lip = yTop - 0.42;
      const p = (x, y) => [sx * x, y];
      const pts = [p(xi, yTop), p(xi, yTop + 0.12), p(xi + 0.12, y1 - 0.06), p(xi + 0.3, y1), p(xo - 0.28, y1), p(xo - 0.08, y1 - 0.08), p(xo, y1 - 0.26), p(xo, lip), p(xOut, lip), p(xOut, yTop)];
      s.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: zFront - 0.6 - zBox, bevelEnabled: false, curveSegments: 6 });
      g.translate(0, 0, zBox);
      return g;
    };
    merged([rail(-1), rail(1)], M.rail, root, 'sideRails');
    const zA = zFrontIn - 0.55, zB = zFront + 0.42, y0 = yTop - 0.05, yb = yTop + 0.5;
    const s = new THREE.Shape();                                     // profile in (-z, y), extruded along x
    const prof = [[zA, y0], [zA, yb - 0.18], [zA + 0.25, yb], [zB - 0.35, yb], [zB, yb - 0.25], [zB, y0 - 0.25], [zFront, y0 - 0.25], [zFront, y0]];
    s.moveTo(-prof[0][0], prof[0][1]);
    for (let i = 1; i < prof.length; i++) s.lineTo(-prof[i][0], prof[i][1]);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 2 * 9.0, bevelEnabled: false, curveSegments: 6 });
    g.rotateY(Math.PI / 2);
    g.translate(-9.0, 0, 0);
    merged([g], M.rail, root, 'lockdownBar');
    // highlight lines (below the bloom threshold): on top of each rail and along the lockdown bar's front chamfer
    for (const sx of [-1, 1]) {
      const a = sx * (xo - 0.48), b = sx * (xo - 0.4), l = Math.min(a, b), r = Math.max(a, b), yy = y1 + 0.004;
      quad(M.shine, V(l, yy, zFront - 0.6), V(r, yy, zFront - 0.6), V(r, yy, zBox), V(l, yy, zBox));
    }
    const cz = zB - 0.175, cy = yb - 0.125, dz = 0.35, dy = -0.25, len = Math.hypot(dz, dy), hw = 0.03;
    const nz = -dy / len, ny = dz / len, off = 0.004;                // chamfer normal (out and up)
    const tz = (dz / len) * hw, ty = (dy / len) * hw;
    quad(M.shine, V(-9, cy - ty + ny * off, cz - tz + nz * off), V(9, cy - ty + ny * off, cz - tz + nz * off), V(9, cy + ty + ny * off, cz + tz + nz * off), V(-9, cy + ty + ny * off, cz + tz + nz * off));
    flushBatches(root, 'railShine');
  }

  // =============================================================================================================================================
  // front: start button, shooter; sides: flipper buttons
  // =============================================================================================================================================
  const cyl = (r, len, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg);
  const startBtn = new THREE.Group();
  startBtn.position.set(-6.1, 1.0, zFront);
  root.add(startBtn);
  {
    const bezel = cyl(0.56, 0.1, 28); bezel.rotateX(Math.PI / 2); bezel.translate(0, 0, 0.05);
    startBtn.add(new THREE.Mesh(bezel, M.chrome)); geos.push(bezel);
    const cap = cyl(0.42, 0.24, 28); cap.rotateX(Math.PI / 2); cap.translate(0, 0, 0.16);
    startBtn.add(new THREE.Mesh(cap, M.start)); geos.push(cap);
  }
  const shooter = new THREE.Group();
  shooter.position.set(-((-7.51 + -6.5) / 2), -0.2, zFront);      // the plunger lane (T-frame x -7.005)
  root.add(shooter);
  const shooterRod = new THREE.Group();
  shooter.add(shooterRod);
  {
    const plate = new THREE.BoxGeometry(1.5, 1.5, 0.1); plate.translate(0, 0, 0.05);
    shooter.add(new THREE.Mesh(plate, M.chrome)); geos.push(plate);
    const sleeve = cyl(0.26, 0.4, 20); sleeve.rotateX(Math.PI / 2); sleeve.translate(0, 0, 0.3);
    shooter.add(new THREE.Mesh(sleeve, M.chrome)); geos.push(sleeve);
    const rod = cyl(0.1, 1.5, 14); rod.rotateX(Math.PI / 2); rod.translate(0, 0, 0.8);
    shooterRod.add(new THREE.Mesh(rod, M.chrome)); geos.push(rod);
    const knob = new THREE.CylinderGeometry(0.34, 0.3, 0.62, 24); knob.rotateX(Math.PI / 2); knob.translate(0, 0, 1.75);
    shooterRod.add(new THREE.Mesh(knob, M.knob)); geos.push(knob);
    const cap = new THREE.SphereGeometry(0.34, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); cap.rotateX(Math.PI / 2); cap.scale(1, 1, 0.45); cap.translate(0, 0, 2.06);
    shooterRod.add(new THREE.Mesh(cap, M.knob)); geos.push(cap);
  }
  const flipperButtons = {};
  for (const [name, sx] of [['a_flip1', -1], ['a_flip2', 1]]) {
    const g = new THREE.Group();
    g.position.set(sx * xOut, 0.75, zFront - 2.2);
    root.add(g);
    const bezel = cyl(0.55, 0.08, 28); bezel.rotateZ(Math.PI / 2); bezel.translate(sx * 0.04, 0, 0);
    g.add(new THREE.Mesh(bezel, M.chrome)); geos.push(bezel);
    const btn = new THREE.Group();
    g.add(btn);
    const cap = cyl(0.4, 0.3, 28); cap.rotateZ(Math.PI / 2); cap.translate(sx * 0.15, 0, 0);
    btn.add(new THREE.Mesh(cap, M.buttonRed)); geos.push(cap);
    flipperButtons[name] = { btn, sx, e: 0 };
  }

  // =============================================================================================================================================
  // backbox (stands upright in the room: leans back by the incline in the table frame)
  // =============================================================================================================================================
  const B = ROOM.box;
  const backbox = new THREE.Group();
  backbox.name = 'backbox';
  backbox.position.set(0, yTop, zBox);
  backbox.rotation.x = -INCLINE;
  root.add(backbox);
  const gY0 = 7.5, gY1 = B.height - 0.9, gX = B.halfW - 0.75;       // backglass window
  const sY0 = 0.35, sY1 = 7.05;                                     // speaker panel
  {
    const hw = B.halfW, H = B.height, D = B.depth;
    quad(M.boxSide, V(-hw, 0, -D), V(-hw, 0, 0), V(-hw, H, 0), V(-hw, H, -D));
    quad(M.boxSide, V(hw, 0, 0), V(hw, 0, -D), V(hw, H, -D), V(hw, H, 0));
    box(M.roof, -hw, H - 0.01, -D, hw, H, 0, 'Y');
    box(M.tmold, -hw - 0.05, H - 0.08, -D, -hw + 0.08, H + 0.05, 0, 'xYz');
    box(M.tmold, hw - 0.08, H - 0.08, -D, hw + 0.05, H + 0.05, 0, 'XYz');
    quad(M.boxRear, V(hw, 0, -D), V(-hw, 0, -D), V(-hw, H, -D), V(hw, H, -D));
    box(M.body, -hw, -0.01, -D, hw, 0, 0, 'y');
    quad(M.body, V(-hw, sY1, 0), V(hw, sY1, 0), V(hw, gY0, 0), V(-hw, gY0, 0));
    quad(M.body, V(-hw, gY1, 0), V(hw, gY1, 0), V(hw, H, 0), V(-hw, H, 0));
    quad(M.body, V(-hw, gY0, 0), V(-gX, gY0, 0), V(-gX, gY1, 0), V(-hw, gY1, 0));
    quad(M.body, V(gX, gY0, 0), V(hw, gY0, 0), V(hw, gY1, 0), V(gX, gY1, 0));
    quad(M.body, V(-hw, 0, 0), V(hw, 0, 0), V(hw, sY0, 0), V(-hw, sY0, 0));
    quad(M.backglass, V(-gX, gY0, -0.18), V(gX, gY0, -0.18), V(gX, gY1, -0.18), V(-gX, gY1, -0.18));
    box(M.rail, -gX - 0.16, gY0 - 0.16, -0.2, gX + 0.16, gY0, 0.06, 'yYZ');
    box(M.rail, -gX - 0.16, gY1, -0.2, gX + 0.16, gY1 + 0.16, 0.06, 'yYZ');
    box(M.rail, -gX - 0.16, gY0, -0.2, -gX, gY1, 0.06, 'xXZ');
    box(M.rail, gX, gY0, -0.2, gX + 0.16, gY1, 0.06, 'xXZ');
    quad(M.speaker, V(-hw, sY0, 0.02), V(hw, sY0, 0.02), V(hw, sY1, 0.02), V(-hw, sY1, 0.02));
    // violet T-molding round the front edges, steel cap on the top edge
    box(M.tmold, -hw - 0.05, 0, -0.12, -hw + 0.08, H, 0.06, 'xXZ');
    box(M.tmold, hw - 0.08, 0, -0.12, hw + 0.05, H, 0.06, 'xXZ');
    box(M.rail, -hw - 0.06, H - 0.1, -0.6, hw + 0.06, H + 0.06, 0.08, 'YZ');
    flushBatches(backbox, 'backboxBody');
    const neonA = cyl(0.11, 2 * gX, 10); neonA.rotateZ(Math.PI / 2); neonA.translate(0, H - 0.45, 0.22);
    merged([neonA], M.neonViolet, backbox, 'neonTop');
    const neonB = cyl(0.08, 2 * gX, 10); neonB.rotateZ(Math.PI / 2); neonB.translate(0, gY0 - 0.42, 0.16);
    merged([neonB], M.neonCyan, backbox, 'neonLow');
  }
  // dot-matrix display (128 x 32 amber dots, 4:1) between the speakers
  const dmd = typeof document !== 'undefined' ? createDmd((w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h })) : null;
  const dmdTex = dmd ? tex(dmd.canvas, { anisotropy: 8 }) : null;
  if (dmdTex) { M.display.map = dmdTex; M.display.needsUpdate = true; }
  const dispGeo = new THREE.PlaneGeometry(9.6, 2.4);
  const display = new THREE.Mesh(dispGeo, M.display);
  display.position.set(0, (sY0 + sY1) / 2, 0.06);
  display.name = 'dmd';
  backbox.add(display);
  geos.push(dispGeo);

  // =============================================================================================================================================
  // room: legs, cord, floor (room axes: the table frame turned back by the incline)
  // =============================================================================================================================================
  const room = new THREE.Group();
  room.name = 'room';
  room.rotation.x = -INCLINE;
  root.add(room);
  const toRoom = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(1, 0, 0), INCLINE);
  const floorY = ROOM.floorY;
  const centre = toRoom(0, 0, (zFront + zBack) / 2);
  {
    const legs = [], feet = [], shadows = [];
    for (const sx of [-1, 1]) for (const z of [zFront - 0.55, zBack + 0.55]) {
      const top = toRoom(sx * (xOut - 0.5), cabinetBottomY(z) + 3.2, z);
      const len = top.y - floorY - 0.55;
      const g = new THREE.CylinderGeometry(1.22, 0.86, len, 4, 1);  // square frustum: 1.72 -> 1.22 wide
      g.rotateY(Math.PI / 4);
      g.translate(top.x, top.y - len / 2, top.z);
      legs.push(g);
      const stem = cyl(0.16, 0.5, 10); stem.translate(top.x, floorY + 0.38, top.z);
      const pad = new THREE.CylinderGeometry(0.42, 0.5, 0.18, 18); pad.translate(top.x, floorY + 0.09, top.z);
      feet.push(stem, pad);
      const sh = new THREE.PlaneGeometry(3.6, 3.6); sh.rotateX(-Math.PI / 2); sh.translate(top.x, floorY + 0.025, top.z);
      shadows.push(sh);
    }
    merged(legs, M.leg, room, 'legs');
    merged(feet, M.rubber, room, 'levelers');
    merged(shadows, M.shadow, room, 'legShadows').renderOrder = 5;
    // power cord: out of the rear face, down to the floor and away
    const p0 = toRoom(5.5, yBackBottom + 1.4, zBack - 0.05);
    const curve = new THREE.CatmullRomCurve3([p0, p0.clone().add(new THREE.Vector3(0.1, -0.4, -0.9)), new THREE.Vector3(p0.x + 0.5, floorY + 2.0, p0.z - 2.2),
      new THREE.Vector3(p0.x + 1.0, floorY + 0.12, p0.z - 3.6), new THREE.Vector3(p0.x + 3.5, floorY + 0.12, p0.z - 9)]);
    merged([new THREE.TubeGeometry(curve, 40, 0.13, 8, false)], M.rubber, room, 'cord');
    // floor: carpet, mottle (breaks the tile repeat), violet light pool, contact shadow, fade to the dark room
    const flat = (g, y) => { g.rotateX(-Math.PI / 2); g.translate(centre.x, floorY + y, centre.z); return g; };
    merged([flat(new THREE.CircleGeometry(95, 64), 0)], M.carpet, room, 'floor');
    merged([flat(new THREE.CircleGeometry(95, 64), 0.01)], M.mottle, room, 'floorMottle').renderOrder = 1;
    merged([flat(new THREE.PlaneGeometry(36, 58), 0.02)], M.pool, room, 'lightPool').renderOrder = 2;
    // footprint shadow: a rounded rectangle with a flat core (vertex alpha), so the glow seems to leak out from under the body's edges
    const fp = flat(new THREE.PlaneGeometry(26, 48, 26, 48), 0.03);
    {
      const p = fp.getAttribute('position');
      const c = new Float32Array(p.count * 4);
      for (let i = 0; i < p.count; i++) {
        const dx = Math.max(0, Math.abs(p.getX(i) - centre.x) - 7.5), dz = Math.max(0, Math.abs(p.getZ(i) - centre.z) - 18.5);
        const d = Math.hypot(dx, dz) / 4.5;
        const a = d >= 1 ? 0 : 1 - d * d * (3 - 2 * d);
        c[i * 4 + 3] = 0.62 * a;
      }
      fp.setAttribute('color', new THREE.BufferAttribute(c, 4));
    }
    merged([fp], M.footprint, room, 'floorShadow').renderOrder = 3;
    // far away in the dark room: a few faint neon glows (other machines, signs) for depth
    const glows = [];
    for (const [x, y, z, s, col] of [[62, 10, -48, 20, [0.2, 0.8, 1.0]], [-70, 8, 30, 18, [1.0, 0.3, 0.6]]]) {
      const g = new THREE.PlaneGeometry(s, s * 0.6);
      g.lookAt(new THREE.Vector3(-x, 0, -z));
      g.translate(centre.x + x, floorY + y, centre.z + z);
      const colors = new Float32Array(g.getAttribute('position').count * 3).map((_, i) => col[i % 3]);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      glows.push(g);
    }
    M.distant.vertexColors = true;
    merged(glows, M.distant, room, 'distantNeon').renderOrder = 1;
    const ring = flat(new THREE.RingGeometry(26, 95.5, 64, 4), 0.04);
    const pos = ring.getAttribute('position');
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i) - centre.x, pos.getZ(i) - centre.z);
      const a = Math.min(1, Math.max(0, (r - 26) / 60));
      col[i * 4 + 3] = a * a * (3 - 2 * a);
    }
    ring.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const fade = new THREE.Mesh(ring, M.floorFade);
    fade.renderOrder = 4;
    fade.name = 'floorFade';
    room.add(fade);
    geos.push(ring);
  }
  // violet under-glow: a point light under the body (lights the legs, the carpet and the lower body; the playfield faces away from it)
  const underGlow = new THREE.PointLight(0x8a5cff, 70, 46, 2);
  underGlow.position.set(centre.x, floorY + 3.0, centre.z);
  room.add(underGlow);

  // =============================================================================================================================================
  // per frame
  // =============================================================================================================================================
  const startBase = M.start.emissive.clone();
  const backglassBase = M.backglass.color.clone(), displayBase = M.display.color.clone(), tmold0 = M.tmold.color.clone();
  const neonA0 = M.neonViolet.color.clone(), neonB0 = M.neonCyan.color.clone(), coin0 = M.coinLight.color.clone(), glow0 = underGlow.intensity;
  let t = 0;
  /**
   * @param {import('../types.js').RenderFrame} frame @param {number} dt @param {number} [dim=1] tilt dimming (lights x dim)
   */
  function update(frame, dt, dim = 1) {
    t += dt;
    const ph = frame.physics;
    if (ph) {
      for (const name in flipperButtons) {
        const b = flipperButtons[name];
        const s = ph.flippers && ph.flippers[name];
        b.e += ((s && s.up ? 1 : 0) - b.e) * Math.min(1, dt * 30);
        b.btn.position.x = -b.sx * 0.16 * b.e;
      }
      if (ph.plunger) shooterRod.position.z = Math.max(0, Math.min(1, ph.plunger.pull)) * 1.0;
    }
    const v = frame.rules;
    const idle = !v || v.phase === 'idle' || v.phase === 'gameOver' || v.demo;
    const pulse = idle ? (Math.sin(t * 6.0) > 0 ? 1 : 0.15) : 0.45;
    M.start.emissive.copy(startBase).multiplyScalar(pulse * dim);
    const flick = 0.94 + 0.06 * Math.sin(t * 37.0) * Math.sin(t * 5.3);
    M.backglass.color.copy(backglassBase).multiplyScalar(dim);
    M.display.color.copy(displayBase).multiplyScalar(0.55 + 0.45 * dim);
    M.neonViolet.color.copy(neonA0).multiplyScalar(dim * flick);
    M.neonCyan.color.copy(neonB0).multiplyScalar(dim);
    M.coinLight.color.copy(coin0).multiplyScalar(dim);
    M.tmold.color.copy(tmold0).multiplyScalar(dim);
    underGlow.intensity = glow0 * dim;
    if (dmd && dmdTex && dmd.draw(v, t)) dmdTex.needsUpdate = true;
  }

  return {
    root, update,
    parts: { backbox, room, startBtn, shooter, shooterRod, flipperButtons, display, underGlow },
    materials: M,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const x of texs) x.dispose();
    },
  };
}
