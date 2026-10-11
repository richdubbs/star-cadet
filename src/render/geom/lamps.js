/**
 * src/render/geom/lamps.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 "Lamp overlays" (additive pure module; no three import)
 * Placement and quad data of the 139 lamp overlays (one quad per lamp that has a position; lite192 has none).
 *
 *   placeLamps(data)                       -> LampPlacement[]   position / height / size / rotation of every overlay, with the "lift" rules below
 *   buildLampQuads(placements, cellFor)    -> {positions, uvs, indices, quads}   one MeshData-like buffer set; 4 vertices per lamp
 *   srgbHexToLinear(hex) / dimTint(def, i) colour helpers for vertex colours (linear RGB 0..1)
 *
 * Quad orientation (T-frame): the atlas cell is the sprite seen from ABOVE by the player, so image-right = T -x and image-up = T -y; the quad is
 * rotated by LampDef.rot (CCW in the T-frame). Vertex order BL, BR, TR, TL (CCW seen from +z). UV of a cell {u0,v0,u1,v1} uses the flipY
 * convention of patchUV (v1 = top edge).
 *
 * Lift rules (ASSUMPTIONS, the unlit inset of such a lamp is painted into the floor where it would be hidden by geometry):
 *   - a floor lamp (z < 1) whose quad lies (>= 7 of 9 sample points) inside a mask-1 island wall is lifted straight up onto that wall's top (+0.012);
 *     the four slingshot decals/arrows (lite84/85/300/322) are forced onto their slingshot body;
 *   - a floor lamp whose centre lies inside the ramp footprint is lifted onto the ramp surface, and one inside DECK_FLOOR_POLY onto the deck
 *     (1.078); these two keep their SCREEN position by sliding along the original camera ray (SPEC 8: p' = c + (p - c)(21 - z')/(21 - z)).
 *   - `dim` = the lamp needs its own dim "unlit" sprite because the floor art under it is hidden (lifted onto a wall that is not textured with the floor).
 */
import { pointInPolygon } from './extrude.js';
import { getDeckField } from './deck.js';

const CAM_FOOT = [0, 13.5];
const CAM_H = 21.0;

/** Slide a T-frame point along the original camera ray from height zFrom to zTo (screen position preserved). @returns {[number, number]} */
export function shiftAlongCameraRay(x, y, zFrom, zTo) {
  const k = (CAM_H - zTo) / (CAM_H - zFrom);
  return [CAM_FOOT[0] + (x - CAM_FOOT[0]) * k, CAM_FOOT[1] + (y - CAM_FOOT[1]) * k];
}

/** sRGB channel 0..1 -> linear. */
export function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

/** '#rrggbb' -> linear RGB [0..1] x3. */
export function srgbHexToLinear(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16) || 0;
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/**
 * Multiplicative tint turning the LIT sprite into a dim "unlit" look: unlit colour / lit colour per channel (linear), scaled by `gain`.
 * @param {{colors:{unlit:string,lit:string}[]}} def @param {number} idx @param {number} [gain=1] @returns {[number, number, number]}
 */
export function dimTint(def, idx, gain = 1) {
  const c = def.colors[Math.max(0, Math.min(def.colors.length - 1, idx))];
  const u = srgbHexToLinear(c.unlit), l = srgbHexToLinear(c.lit);
  return [Math.min(1, (u[0] / Math.max(l[0], 0.08)) * gain), Math.min(1, (u[1] / Math.max(l[1], 0.08)) * gain), Math.min(1, (u[2] / Math.max(l[2], 0.08)) * gain)];
}

/**
 * @typedef {Object} LampPlacement
 * @property {string} name @property {number} index  index into LAMPS
 * @property {number} x @property {number} y @property {number} z   overlay centre (T-frame), z = overlay height
 * @property {number} w @property {number} h @property {number} rot  quad size and CCW rotation
 * @property {number} nStates @property {boolean} lifted @property {'wall'|'ramp'|'deck'|null} liftedOnto @property {boolean} dim
 */

/** Island walls the overlays may be lifted onto: mask 1, with a visual top. Slingshot bodies are drawn with the floor art on top (no dim sprite needed). */
const FLOOR_TEXTURED_TOPS = new Set(['wall_288', 'wall_301']);
/** Slingshot decals are bigger than the body polygon but belong on it. */
const FORCE_LIFT = { lite84: 'wall_288', lite85: 'wall_301', lite300: 'wall_288', lite322: 'wall_301' };
/** A lamp is lifted onto an island wall when at least this many of 9 sample points of its quad are inside the wall polygon. */
const MIN_INSIDE = 7;

/**
 * @param {import('../../types.js').DataModule} data
 * @returns {LampPlacement[]}
 */
export function placeLamps(data) {
  const field = getDeckField(data);
  const islands = data.WALLS.filter((w) => w.solid === 'island' && w.mask === 1 && w.top && w.name !== 'wall_102')
    .map((w) => ({ name: w.name, pts: w.pts, top: w.top }));
  const footprint = data.RAMP_FOOTPRINT_POLY;
  const deckPoly = data.DECK_FLOOR_POLY;
  /** @type {LampPlacement[]} */
  const out = [];
  data.LAMPS.forEach((def, index) => {
    if (!def.pos) return;
    let [x, y] = def.pos;
    let z = def.z;
    const w = def.size[0], h = def.size[1], rot = def.rot || 0;
    let lifted = false, liftedOnto = null, dim = false;
    if (z < 1) {
      // 9 sample points of the (rotated) quad
      const c = Math.cos(rot), s = Math.sin(rot);
      const ux = -c, uy = -s, vx = s, vy = -c;
      let wallTop = -1, wallName = null;
      const forced = FORCE_LIFT[def.name];
      for (const isl of islands) {
        let inside = 0;
        for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const px = x + (a * w * ux) / 2 + (b * h * vx) / 2, py = y + (a * w * uy) / 2 + (b * h * vy) / 2;
          if (pointInPolygon(px, py, isl.pts)) inside++;
        }
        const ok = forced ? isl.name === forced : inside >= MIN_INSIDE;
        if (ok && isl.top > wallTop) { wallTop = isl.top; wallName = isl.name; }
      }
      if (wallTop > z) { z = wallTop + 0.012; lifted = true; liftedOnto = 'wall'; dim = !FLOOR_TEXTURED_TOPS.has(wallName); }
      if (pointInPolygon(x, y, footprint)) {
        const zz = field.heightAt(x, y) + 0.012;
        if (zz > z) { [x, y] = shiftAlongCameraRay(x, y, def.z, zz); z = zz; lifted = true; liftedOnto = 'ramp'; dim = true; }
      } else if (pointInPolygon(x, y, deckPoly)) {
        const zz = 1.078;
        if (zz > z) { [x, y] = shiftAlongCameraRay(x, y, def.z, zz); z = zz; lifted = true; liftedOnto = 'deck'; dim = true; }
      }
    }
    out.push({ name: def.name, index, x, y, z, w, h, rot, nStates: def.nStates, lifted, liftedOnto, dim });
  });
  return out;
}

/**
 * Quad buffers for a list of placements. `cellFor(name, state)` returns the atlas cell {u0,v0,u1,v1} or null (then the full 0..1 square is used).
 * Per lamp, `states[k]` is the 8-float UV array of state k (3-image lamps have 3).
 * @param {LampPlacement[]} placements
 * @param {(name:string, state:number, nStates:number)=>({u0:number,v0:number,u1:number,v1:number}|null)} cellFor
 * @returns {{positions:Float32Array, uvs:Float32Array, indices:Uint32Array, quads:{placement:LampPlacement, vertex:number, states:Float32Array[]}[]}}
 */
export function buildLampQuads(placements, cellFor) {
  const n = placements.length;
  const positions = new Float32Array(n * 12), uvs = new Float32Array(n * 8), indices = new Uint32Array(n * 6);
  const quads = [];
  placements.forEach((pl, i) => {
    const c = Math.cos(pl.rot), s = Math.sin(pl.rot);
    const ux = -c, uy = -s, vx = s, vy = -c;                       // image-right and image-up as T-frame directions
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];          // BL BR TR TL in (u, v) sign space
    for (let k = 0; k < 4; k++) {
      const [a, b] = corners[k];
      const o = i * 12 + k * 3;
      positions[o] = pl.x + (a * pl.w * ux) / 2 + (b * pl.h * vx) / 2;
      positions[o + 1] = pl.y + (a * pl.w * uy) / 2 + (b * pl.h * vy) / 2;
      positions[o + 2] = pl.z;
    }
    const states = [];
    for (let st = 0; st < pl.nStates; st++) {
      const cell = cellFor(pl.name, st, pl.nStates);
      const u0 = cell ? cell.u0 : 0, v0 = cell ? cell.v0 : 0, u1 = cell ? cell.u1 : 1, v1 = cell ? cell.v1 : 1;
      states.push(Float32Array.of(u0, v0, u1, v0, u1, v1, u0, v1));
    }
    uvs.set(states[0], i * 8);
    const b = i * 4;
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    quads.push({ placement: pl, vertex: b, states });
  });
  return { positions, uvs, indices, quads };
}
