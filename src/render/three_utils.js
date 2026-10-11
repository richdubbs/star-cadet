/**
 * src/render/three_utils.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 (additive module, imports three). Not Node-importable (needs the import map); covered by the browser smoke test.
 * Helpers shared by the scene builders: MeshData (T-frame) -> BufferGeometry (Three axes), ART canvases -> textures with tolerance for missing /
 * stub canvases, and small procedural DataTextures (soft disc, ball detail, fallback environment, the chrome ball's environment) that need no DOM.
 *
 * ASSUMPTIONS: a canvas narrower than 8 px counts as "missing" (the architect's stubs create 4x4 canvases); all procedural textures come from
 * mulberry32 with a fixed seed so every run looks the same.
 */
import * as THREE from 'three';
import { mulberry32 } from './art/rng.js';
import { chromeEnvPixels } from './geom/envmap.js';

/**
 * Convert a T-frame MeshData to a BufferGeometry in Three axes (x' = -x, y' = z, z' = y: a proper rotation, so winding is kept).
 * @param {import('./geom/meshdata.js').MeshData} md
 * @returns {THREE.BufferGeometry}
 */
export function toGeometry(md) {
  const g = new THREE.BufferGeometry();
  const n = md.positions.length;
  const pos = new Float32Array(n), nor = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    pos[i] = -md.positions[i]; pos[i + 1] = md.positions[i + 2]; pos[i + 2] = md.positions[i + 1];
    nor[i] = -md.normals[i]; nor[i + 1] = md.normals[i + 2]; nor[i + 2] = md.normals[i + 1];
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(md.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(md.indices, 1));
  if (md.groups) md.groups.forEach((gr, i) => g.addGroup(gr.start, gr.count, i));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** True when the canvas is a usable painted texture (not missing / not a 4x4 stub). */
export function usableCanvas(c) {
  return !!c && typeof c.width === 'number' && c.width >= 8 && c.height >= 8;
}

/**
 * ART canvas -> CanvasTexture (sRGB, flipY as patchUV assumes). Returns null for a missing / stub canvas.
 * @param {any} canvas @param {{wrap?:'repeat'|'clamp', anisotropy?:number, repeat?:[number,number], srgb?:boolean, mipmaps?:boolean}} [o]
 * @returns {THREE.CanvasTexture|null}
 */
export function canvasTexture(canvas, o = {}) {
  if (!usableCanvas(canvas)) return null;
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const w = o.wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapS = w; t.wrapT = w;
  t.anisotropy = o.anisotropy ?? 4;
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  t.generateMipmaps = o.mipmaps !== false;
  t.minFilter = t.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** RGBA8 DataTexture from a typed array. */
export function dataTexture(data, w, h, o = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = o.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = o.mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = !!o.mipmaps;
  t.wrapS = o.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = t.wrapS;
  t.needsUpdate = true;
  return t;
}

/**
 * Soft round blob: colour (r,g,b) 0..255, alpha = smooth falloff to 0 at the rim. Used for the ball shadows, hole pits and glows.
 * @param {number} size @param {[number,number,number]} rgb @param {number} [power=2] falloff exponent @param {number} [core=0] flat core fraction 0..1
 */
export function softDiscTexture(size, rgb, power = 2, core = 0) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(dx, dy);
      let a = r >= 1 ? 0 : r <= core ? 1 : Math.pow(1 - (r - core) / (1 - core), power);
      a = Math.max(0, Math.min(1, a));
      const o = (y * size + x) * 4;
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = Math.round(a * 255);
    }
  }
  return dataTexture(d, size, size);
}

/** Faint scratch / speck detail for the chrome ball so that its rolling is visible (grey ~235 with darker hairlines). */
export function ballDetailTexture() {
  const W = 256, H = 128;
  const d = new Uint8Array(W * H * 4);
  const rand = mulberry32(60);
  for (let i = 0; i < W * H; i++) { const v = 238 + Math.floor(rand() * 10); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  const put = (x, y, v) => { x = ((x % W) + W) % W; if (y < 0 || y >= H) return; const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.min(d[o], v); };
  for (let s = 0; s < 26; s++) {                           // hairline scratches
    let x = rand() * W, y = rand() * H;
    const a = rand() * Math.PI, len = 8 + rand() * 26;
    const v = 150 + Math.floor(rand() * 50);
    for (let k = 0; k < len; k++) { put(Math.round(x), Math.round(y), v); x += Math.cos(a); y += Math.sin(a) * 0.6; }
  }
  for (let s = 0; s < 40; s++) put(Math.floor(rand() * W), Math.floor(rand() * H), 170);   // specks
  const t = dataTexture(d, W, H, { srgb: true, repeat: true, mipmaps: true });
  return t;
}

/**
 * Fallback equirectangular studio environment (used when ArtPack.misc.ballEnv is missing): dark floor, bright ceiling softboxes, horizon band.
 * @returns {THREE.DataTexture}
 */
export function fallbackEnvTexture() {
  const W = 128, H = 64;
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);                                  // 0 = zenith, 1 = nadir
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let r, g, b;
      if (v < 0.5) {                                        // sky: deep blue-grey to bright toward the horizon
        const k = 1 - v * 2;
        r = 70 + 150 * (1 - k) * (1 - k); g = 80 + 150 * (1 - k) * (1 - k); b = 110 + 120 * (1 - k) * (1 - k);
        const lx = Math.abs(((u + 0.5) % 1) - 0.5);
        if (v < 0.22 && (Math.abs(lx - 0.15) < 0.06 || lx > 0.42)) { r = g = b = 255; }     // softboxes
      } else {                                              // ground: dark with a faint blue bounce
        const k = (v - 0.5) * 2;
        r = 30 - 18 * k; g = 36 - 20 * k; b = 56 - 26 * k;
      }
      const o = (y * W + x) * 4;
      d[o] = Math.max(0, r); d[o + 1] = Math.max(0, g); d[o + 2] = Math.max(0, b); d[o + 3] = 255;
    }
  }
  const t = dataTexture(d, W, H, { srgb: true });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/**
 * Equirectangular environment of the CHROME BALL ONLY (the table metals keep ART's `ballEnv`); pixels from geom/envmap.js (pure, tested).
 * @returns {THREE.DataTexture}
 */
export function chromeEnvTexture() {
  const t = dataTexture(chromeEnvPixels(256, 128), 256, 128, { srgb: true });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/** Dispose geometries and materials of an object tree (textures are owned and disposed by the material kit). */
export function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}
