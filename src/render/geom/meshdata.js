/**
 * src/render/geom/meshdata.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 (MeshData); additive helper module, pure (no three import).
 * MeshData = {positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array, groups?: {name,start,count}[]}
 * in T-FRAME coordinates (x, y, z = height). The scene code converts to Three.js axes (convert.js t2v) when it builds BufferGeometry.
 * Winding: counter-clockwise seen from outside, in the right-handed T-frame (the T -> Three mapping is a rotation, so it stays CCW there).
 */

/** @typedef {{name:string, start:number, count:number}} MeshGroup */
/** @typedef {{positions:Float32Array, normals:Float32Array, uvs:Float32Array, indices:Uint32Array, groups?:MeshGroup[]}} MeshData */

/** Growable mesh under construction. */
export class MeshBuilder {
  constructor() { this.p = []; this.n = []; this.t = []; this.i = []; }
  /** Number of vertices so far. */
  get vertexCount() { return this.p.length / 3; }
  /** Append a vertex; returns its index. */
  vertex(x, y, z, nx, ny, nz, u, v) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.t.push(u, v);
    return this.p.length / 3 - 1;
  }
  /** Append a triangle (CCW seen from outside). */
  tri(a, b, c) { this.i.push(a, b, c); }
  /** Append the quad a,b,c,d (CCW) as two triangles. */
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  /** @param {MeshGroup[]} [groups] @returns {MeshData} */
  build(groups) {
    /** @type {MeshData} */
    const md = {
      positions: Float32Array.from(this.p), normals: Float32Array.from(this.n), uvs: Float32Array.from(this.t),
      indices: Uint32Array.from(this.i),
    };
    if (groups) md.groups = groups;
    return md;
  }
}

/** @returns {MeshData} */
export function emptyMeshData() {
  return { positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) };
}

/** Number of triangles of a MeshData. */
export function triangleCount(md) { return md.indices.length / 3; }

/** Number of vertices of a MeshData. */
export function vertexCount(md) { return md.positions.length / 3; }

/**
 * Concatenate meshes. When `names` is given, one group per input (name, index range) is attached so one BufferGeometry can use several materials.
 * @param {MeshData[]} list @param {string[]} [names]
 * @returns {MeshData}
 */
export function mergeMeshData(list, names) {
  let nv = 0, ni = 0;
  for (const m of list) { nv += m.positions.length / 3; ni += m.indices.length; }
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), indices = new Uint32Array(ni);
  /** @type {MeshGroup[]} */
  const groups = [];
  let vo = 0, io = 0;
  list.forEach((m, k) => {
    positions.set(m.positions, vo * 3); normals.set(m.normals, vo * 3); uvs.set(m.uvs, vo * 2);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo;
    if (names) groups.push({ name: names[k], start: io, count: m.indices.length });
    vo += m.positions.length / 3; io += m.indices.length;
  });
  /** @type {MeshData} */
  const out = { positions, normals, uvs, indices };
  if (names) out.groups = groups;
  return out;
}

/**
 * Rigidly place a mesh: rotate about the vertical (z) axis by `rot` (T-frame CCW), then translate.
 * @param {MeshData} md @param {{x?:number,y?:number,z?:number,rot?:number}} t @returns {MeshData} a new MeshData
 */
export function placeMeshData(md, t) {
  const c = Math.cos(t.rot || 0), s = Math.sin(t.rot || 0);
  const tx = t.x || 0, ty = t.y || 0, tz = t.z || 0;
  const positions = new Float32Array(md.positions.length), normals = new Float32Array(md.normals.length);
  for (let i = 0; i < md.positions.length; i += 3) {
    const x = md.positions[i], y = md.positions[i + 1];
    positions[i] = x * c - y * s + tx; positions[i + 1] = x * s + y * c + ty; positions[i + 2] = md.positions[i + 2] + tz;
    const nx = md.normals[i], ny = md.normals[i + 1];
    normals[i] = nx * c - ny * s; normals[i + 1] = nx * s + ny * c; normals[i + 2] = md.normals[i + 2];
  }
  /** @type {MeshData} */
  const out = { positions, normals, uvs: md.uvs.slice(), indices: md.indices.slice() };
  if (md.groups) out.groups = md.groups.map((g) => ({ ...g }));
  return out;
}

/** Axis-aligned bounds of a MeshData (T-frame). @returns {{min:[number,number,number], max:[number,number,number]}} */
export function meshBounds(md) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < md.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = md.positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min: /** @type {[number,number,number]} */ (min), max: /** @type {[number,number,number]} */ (max) };
}

/**
 * Validate a MeshData (used by tests): finite numbers, indices in range, unit normals, consistent attribute sizes.
 * @returns {string[]} list of problems (empty = ok)
 */
export function validateMeshData(md) {
  const problems = [];
  const nv = md.positions.length / 3;
  if (md.normals.length !== md.positions.length) problems.push('normals length');
  if (md.uvs.length !== nv * 2) problems.push('uvs length');
  if (md.indices.length % 3 !== 0) problems.push('indices not a multiple of 3');
  for (let i = 0; i < md.positions.length; i++) if (!Number.isFinite(md.positions[i])) { problems.push('NaN position'); break; }
  for (let i = 0; i < md.uvs.length; i++) if (!Number.isFinite(md.uvs[i])) { problems.push('NaN uv'); break; }
  for (let i = 0; i < md.indices.length; i++) if (md.indices[i] >= nv) { problems.push('index out of range'); break; }
  for (let i = 0; i < md.normals.length; i += 3) {
    const l = Math.hypot(md.normals[i], md.normals[i + 1], md.normals[i + 2]);
    if (!(Math.abs(l - 1) < 1e-4)) { problems.push('normal not unit'); break; }
  }
  return problems;
}
