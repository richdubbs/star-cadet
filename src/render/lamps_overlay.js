/**
 * src/render/lamps_overlay.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 "Lamp overlays" (additive module, imports three).
 * One additive-blended mesh (+ one more for lamps whose atlas cell is missing) with a quad per lamp that has a position (139): textured with the lit
 * sprite of ArtPack.lampAtlas.cells[name] (or cells[name#onIdx] for the 3-image lamps lite2/3/4); per-vertex alpha 1 when the lamp is lit.
 * Rebuilt only when LampsView.version changes (plus onIdx changes); allocation-free after the first call.
 *
 *   - depthWrite off, toneMapped off, over-bright lit colour so the bloom pass picks the lamps up;
 *   - lamps lifted onto geometry (geom/lamps.js) that has no floor art under them keep a dim "unlit" sprite instead of vanishing when off;
 *   - missing atlas cell / stub atlas: a soft round glow tinted with LampDef.colors[onIdx].lit is used (so the table is lit even without ART).
 *
 * ASSUMPTIONS: the atlas cell is the sprite as seen from above by the player (see geom/lamps.js); quads are rotated by LampDef.rot.
 */
import * as THREE from 'three';
import { placeLamps, buildLampQuads, srgbHexToLinear, dimTint } from './geom/lamps.js';
import { canvasTexture } from './three_utils.js';

const LIT_GAIN = 1.45;       // > 1 so the bloom threshold is crossed by lit lamps only
const DIM_GAIN = 0.55;
const DECAL_GAIN = 0.75;     // the two big slingshot decals would otherwise bloom to a white blob

/**
 * @param {{data:import('../types.js').DataModule, art:import('../types.js').ArtPack, kit:ReturnType<typeof import('./materials.js').createMaterialKit>}} o
 */
export function createLampOverlay(o) {
  const { data, art, kit } = o;
  const atlas = art && art.lampAtlas;
  const cells = (atlas && atlas.cells) || {};
  const atlasTex = Object.keys(cells).length > 0 ? canvasTexture(atlas.canvas, { anisotropy: 2 }) : null;
  const keyOf = (name, st, n) => (n > 1 ? `${name}#${st}` : name);
  const placements = placeLamps(data);
  const withCell = [], without = [];
  for (const pl of placements) (atlasTex && cells[keyOf(pl.name, 0, pl.nStates)] ? withCell : without).push(pl);

  const root = new THREE.Group();
  root.name = 'lampOverlay';
  const geos = [], mats = [];
  /** @type {{lamp:string, def:any, pl:any, vertex:number, states:Float32Array[], tinted:boolean, geo:THREE.BufferGeometry, lit:number, idx:number}[]} */
  const all = [];

  function makePart(list, texture, tinted) {
    if (!list.length) return;
    const q = buildLampQuads(list, (name, st, n) => cells[keyOf(name, st, n)] || null);
    const geo = new THREE.BufferGeometry();
    const nv = list.length * 4;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      pos[i * 3] = -q.positions[i * 3]; pos[i * 3 + 1] = q.positions[i * 3 + 2]; pos[i * 3 + 2] = q.positions[i * 3 + 1];
      nor[i * 3 + 1] = 1;
    }
    const colors = new Float32Array(nv * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(q.uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geo.setIndex(new THREE.BufferAttribute(q.indices, 1));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      map: texture, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    root.add(mesh);
    geos.push(geo); mats.push(mat);
    for (const quad of q.quads) {
      const def = data.LAMPS[quad.placement.index];
      all.push({ lamp: def.name, def, pl: quad.placement, vertex: quad.vertex, states: quad.states, tinted, geo, lit: -1, idx: -1 });
    }
  }
  makePart(withCell, atlasTex, false);
  makePart(without, kit.textures.glow, true);

  function write(entry, lit, idx) {
    const col = entry.geo.attributes.color;
    const uv = entry.geo.attributes.uv;
    const def = entry.def;
    let r, g, b, a;
    const gain = def.shape === 'decal' ? DECAL_GAIN : LIT_GAIN;
    if (lit) {
      if (entry.tinted) { const c = srgbHexToLinear(def.colors[Math.min(idx, def.colors.length - 1)].lit); r = c[0] * gain; g = c[1] * gain; b = c[2] * gain; } else { r = g = b = gain; }
      a = 1;
    } else if (entry.pl.dim) {
      if (entry.tinted) { const c = srgbHexToLinear(def.colors[Math.min(idx, def.colors.length - 1)].unlit); r = c[0] * DIM_GAIN; g = c[1] * DIM_GAIN; b = c[2] * DIM_GAIN; } else { const t = dimTint(def, idx, DIM_GAIN); r = t[0]; g = t[1]; b = t[2]; }
      a = 1;
    } else { r = g = b = 0; a = 0; }
    for (let k = 0; k < 4; k++) col.setXYZW(entry.vertex + k, r, g, b, a);
    col.needsUpdate = true;
    if (entry.states.length > 1 && idx !== entry.idx) {
      const s = entry.states[Math.min(idx, entry.states.length - 1)];
      for (let k = 0; k < 4; k++) uv.setXY(entry.vertex + k, s[k * 2], s[k * 2 + 1]);
      uv.needsUpdate = true;
    }
  }

  let version = -1;
  return {
    root,
    count: all.length,
    placements,
    /**
     * Apply a LampsView ({version, lit, onIdx}); cheap when nothing changed.
     * @param {import('../types.js').LampsView} view
     */
    update(view) {
      if (!view || !view.lit) return;
      if (view.version === version) return;
      version = view.version;
      for (const e of all) {
        const lit = view.lit[e.lamp] ? 1 : 0;
        const idx = view.onIdx ? (view.onIdx[e.lamp] | 0) : 0;
        if (lit !== e.lit || idx !== e.idx) { write(e, lit === 1, idx); e.lit = lit; e.idx = idx; }
      }
    },
    /** Force a rewrite on the next update (after a quality change etc.). */
    invalidate() { version = -1; for (const e of all) { e.lit = -1; } },
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); if (atlasTex) atlasTex.dispose(); },
  };
}
