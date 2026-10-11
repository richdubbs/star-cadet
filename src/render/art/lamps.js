/**
 * src/render/art/lamps.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2 (lampAtlas, drawLampShape), 3.6 (LampDef), A15 (145 cells); SPEC 6.8, Appendix A colour families
 * drawLampShape(ctx, def, state, pxPerUnitX, pxPerUnitY) paints ONE lamp: the dim unlit inset (floor/deck textures) or the lit sprite (atlas).
 * The same function is used for both, so inset and overlay align.  buildLampAtlas() paints the 145 lit sprites.
 *
 * CONVENTIONS (what RENDER must know; also repeated in the hand-off note):
 *  - The current origin of ctx is the lamp centre; (ppuX, ppuY) = canvas pixels per table unit along T-x / T-y.  The drawing is done in a
 *    MIRRORED T-frame (scale(-ppuX, ppuY)) so that a canvas painted this way "looks like the table seen from above" exactly like the
 *    floor/deck patches: local T +x = canvas LEFT, local T +y = canvas DOWN.
 *  - state 'unlit' (floor / deck insets): the shape is rotated by LampDef.rot (T-frame CCW) around the centre.
 *  - state 'lit' (atlas cell): the shape is drawn UN-ROTATED in the quad-local frame; RENDER rotates the quad by LampDef.rot (ARCHITECTURE 9.1),
 *    which reproduces the inset's orientation.  Cell -> quad texture mapping: mapping.js lampCellUV (local +x = cell left, local +y = cell bottom).
 *  - The shape fills SHAPE_FRAC of the quad `LampDef.size`; the remaining margin holds the glow (alpha falls to 0 at the quad edge).
 *  - Arrows / triangles point toward local T +x (so `rot` = atan2(dy, dx) of the tip, as DATA defines it); bars have their long axis on local x.
 * ASSUMPTIONS: cell -> the lit sprite is alpha-keyed (transparent background); shape names are those of LampDef.shape; lamps of group
 * worm_hole_lights are drawn as rim rings (they sit on the sink housings); lite77 carries the word TILT; lite84/85 are the slingshot lightning
 * decals; tier D / C lamps are painted a little dimmer in the textures because their exact location is a guess (SPEC App. A).
 */
import { TAU, rgba, lighten, darken, radial, rrectPath, starPath, polyPath } from './draw.js';
import { drawLetters } from './font.js';

/** Fraction of the quad (LampDef.size) covered by the lamp shape itself. */
export const SHAPE_FRAC = 0.74;
/** Atlas columns (ARCHITECTURE 9.2). */
export const ATLAS_COLS = 12;

/** Keys of the atlas cells in atlas order: LAMP_NAMES order, lite2/3/4 expanded to name#0..#2, lamps without a position skipped. */
export function lampKeys(data) {
  const keys = [];
  for (const def of data.LAMPS) {
    if (!def.pos) continue;
    if (def.nStates > 1) for (let i = 0; i < def.nStates; i++) keys.push(def.name + '#' + i);
    else keys.push(def.name);
  }
  return keys;
}

/** Which texture carries the unlit inset of a lamp: deck lamps (z >= 1) go to ArtPack.deck, all others to ArtPack.floor. */
export function lampPatchKey(def) { return def.z >= 1 ? 'deck' : 'floor'; }

/**
 * Table-space bounding box (T-frame) of a positioned lamp: frac = 1 gives the whole overlay quad (conservative bound of the inset), frac =
 * SHAPE_FRAC the lamp shape itself.  Takes LampDef.rot into account (axis-aligned box of the rotated rectangle).
 * @param {import('../../types.js').LampDef} def  @param {number} [frac]
 * @returns {{cx:number, cy:number, ex:number, ey:number, xMin:number, xMax:number, yMin:number, yMax:number}}
 */
export function lampInsetBounds(def, frac = 1) {
  const cx = def.pos[0], cy = def.pos[1];
  const hw = (def.size[0] / 2) * frac, hh = (def.size[1] / 2) * frac;
  const c = Math.abs(Math.cos(def.rot)), s = Math.abs(Math.sin(def.rot));
  const ex = c * hw + s * hh, ey = s * hw + c * hh;
  return { cx, cy, ex, ey, xMin: cx - ex, xMax: cx + ex, yMin: cy - ey, yMax: cy + ey };
}

function addShapePath(ctx, def, hw, hh) {
  switch (def.shape) {
    case 'arrow':
      polyPath(ctx, [[hw, 0], [-0.1 * hw, hh], [-0.1 * hw, 0.42 * hh], [-hw, 0.42 * hh], [-hw, -0.42 * hh], [-0.1 * hw, -0.42 * hh], [-0.1 * hw, -hh]]);
      break;
    case 'triangle':
      polyPath(ctx, [[hw, 0], [-hw, hh], [-hw, -hh]]);
      break;
    case 'bar': {
      const t = Math.min(hh * 0.62, hw * 0.5);
      rrectPath(ctx, -hw, -t, 2 * hw, 2 * t, t * 0.8);
      break;
    }
    case 'cross': {
      const r = Math.max(hw, hh);
      starPath(ctx, 0, 0, r, r * 0.26, 4, Math.PI / 4);
      break;
    }
    case 'rect':
      rrectPath(ctx, -hw, -hh, 2 * hw, 2 * hh, Math.min(hw, hh) * 0.3);
      break;
    default: // dot, ring
      ctx.ellipse(0, 0, hw, hh, 0, 0, TAU);
  }
}

/** Lightning bolt (decal lamps lite84/85) in normalised coordinates [-1,1]^2 -> local units. */
function addBoltPath(ctx, hw, hh) {
  const pts = [[0.34, -1], [-0.38, -0.12], [0.06, -0.1], [-0.46, 1], [0.34, 0.14], [-0.04, 0.1]];
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0] * hw, p[1] * hh); else ctx.lineTo(p[0] * hw, p[1] * hh);
  });
  ctx.closePath();
}

function isRim(def) { return def.group === 'worm_hole_lights'; }

function paintUnlit(ctx, def, col, hw, hh) {
  const base = col.unlit;
  if (isRim(def)) {
    // wormhole rim: a dark bezel ring in the sink's colour
    const r = Math.min(hw, hh);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = r * 0.62;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.82, hh * 0.82, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = darken(base, 0.1);
    ctx.lineWidth = r * 0.42;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.82, hh * 0.82, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = rgba(lighten(base, 0.5), 0.3);
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.9, hh * 0.9, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    return;
  }
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (def.shape === 'decal') {
    addBoltPath(ctx, hw, hh);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.08;
    ctx.stroke();
    ctx.fillStyle = rgba(base, 0.85);
    ctx.fill();
    ctx.beginPath();
    starPath(ctx, 0, 0, hw * 0.55, hw * 0.2, 8, 0.2);
    ctx.fillStyle = rgba(lighten(base, 0.2), 0.45);
    ctx.fill();
    return;
  }
  addShapePath(ctx, def, hw, hh);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 0.075;
  ctx.stroke();
  const rad = Math.max(hw, hh);
  ctx.fillStyle = radial(ctx, -hw * 0.25, -hh * 0.3, 0, rad * 1.25, [[0, darken(base, 0.2)], [0.6, darken(base, 0.4)], [1, darken(base, 0.62)]]);
  ctx.fill();
  ctx.strokeStyle = rgba(lighten(base, 0.4), 0.16);
  ctx.lineWidth = 0.018;
  ctx.stroke();
  if (def.shape === 'ring') {
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.46, hh * 0.46, 0, 0, TAU);
    ctx.fillStyle = rgba(darken(base, 0.55), 0.55);
    ctx.fill();
  }
  if (def.name === 'lite77') {
    ctx.save();
    ctx.scale(-1, 1);
    drawLetters(ctx, 'TILT', Math.min(hh * 0.62, (hw * 2 * 0.78) / 3.0), { weight: 0.2, tracking: 0.22, fill: rgba(lighten(base, 0.2), 0.7) });
    ctx.restore();
  }
}

function glowQuad(ctx, def, color, alpha) {
  const qw = def.size[0] / 2, qh = def.size[1] / 2;
  ctx.save();
  ctx.scale(1, qh / qw);
  ctx.fillStyle = radial(ctx, 0, 0, 0, qw, [[0, rgba(color, alpha)], [0.35, rgba(color, alpha * 0.55)], [0.7, rgba(color, alpha * 0.16)], [1, rgba(color, 0)]]);
  ctx.fillRect(-qw, -qw, 2 * qw, 2 * qw);
  ctx.restore();
}

function paintLit(ctx, def, col, hw, hh) {
  const lit = col.lit;
  glowQuad(ctx, def, lit, 0.8);
  ctx.lineJoin = 'round';
  const hot = radial(ctx, 0, 0, 0, Math.max(hw, hh) * 1.15, [[0, lighten(lit, 0.78)], [0.45, lit], [1, darken(lit, 0.12)]]);
  if (isRim(def)) {
    const r = Math.min(hw, hh);
    ctx.strokeStyle = lit;
    ctx.lineWidth = r * 0.46;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.82, hh * 0.82, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = rgba(lighten(lit, 0.7), 0.9);
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.82, hh * 0.82, 0, 0, TAU);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  if (def.shape === 'decal') {
    ctx.save();
    ctx.beginPath();
    starPath(ctx, 0, 0, hw * 0.95, hw * 0.28, 8, 0.2);
    ctx.fillStyle = rgba(lit, 0.55);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    addBoltPath(ctx, hw, hh);
    ctx.fillStyle = hot;
    ctx.fill();
    ctx.strokeStyle = rgba('#ffffff', 0.9);
    ctx.lineWidth = 0.05;
    ctx.stroke();
    return;
  }
  addShapePath(ctx, def, hw, hh);
  ctx.fillStyle = hot;
  ctx.fill();
  ctx.strokeStyle = rgba(lighten(lit, 0.6), 0.85);
  ctx.lineWidth = 0.028;
  ctx.stroke();
  if (def.shape === 'ring') {
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.46, hh * 0.46, 0, 0, TAU);
    ctx.fillStyle = rgba(lighten(lit, 0.85), 0.8);
    ctx.fill();
  }
  if (def.name === 'lite77') {
    ctx.save();
    ctx.scale(-1, 1);
    drawLetters(ctx, 'TILT', Math.min(hh * 0.62, (hw * 2 * 0.78) / 3.0), { weight: 0.2, tracking: 0.22, fill: '#fff0e8' });
    ctx.restore();
  }
}

/**
 * Paints one lamp at the current origin (the lamp centre).
 * @param {*} ctx 2D context (canvas subset)
 * @param {import('../../types.js').LampDef} def lamp definition (needs size, shape, rot, colors, group, name)
 * @param {'unlit'|'lit'} state
 * @param {number} pxPerUnitX canvas pixels per table unit along T-x
 * @param {number} pxPerUnitY canvas pixels per table unit along T-y
 * @param {{colorIndex?:number, rotate?:boolean}} [opts] colorIndex picks the ON image of the 3-image lamps; rotate overrides the rule
 *        "rotate by def.rot only in state 'unlit'"
 */
export function drawLampShape(ctx, def, state, pxPerUnitX, pxPerUnitY, opts = {}) {
  if (state !== 'unlit' && state !== 'lit') throw new TypeError('drawLampShape: state must be "unlit" or "lit"');
  if (!def || !def.size || !(def.size[0] > 0) || !(def.size[1] > 0)) return;
  const col = def.colors[opts.colorIndex ?? 0] || def.colors[0];
  const hw = (def.size[0] / 2) * SHAPE_FRAC;
  const hh = (def.size[1] / 2) * SHAPE_FRAC;
  const rotate = opts.rotate ?? state === 'unlit';
  ctx.save();
  ctx.scale(-pxPerUnitX, pxPerUnitY);
  if (rotate && def.rot) ctx.rotate(def.rot);
  if (state === 'unlit') paintUnlit(ctx, def, col, hw, hh); else paintLit(ctx, def, col, hw, hh);
  ctx.restore();
}

/**
 * Paints the dim unlit insets of every positioned lamp that belongs to `which` ('floor' = z < 1, 'deck' = z >= 1) into a patch canvas.
 * @param {*} ctx context of the patch canvas (identity transform)
 * @param {{rect:object, width:number, height:number}} patch
 * @returns {number} number of insets painted
 */
export function paintLampInsets(ctx, patch, defs, which) {
  const r = patch.rect;
  const sx = patch.width / (r.xMax - r.xMin);
  const sy = patch.height / (r.yMax - r.yMin);
  let n = 0;
  for (const def of defs) {
    if (!def.pos || lampPatchKey(def) !== which) continue;
    ctx.save();
    ctx.translate((r.xMax - def.pos[0]) * sx, (def.pos[1] - r.yMin) * sy);
    ctx.globalAlpha = def.tier === 'D' ? 0.62 : def.tier === 'C' ? 0.85 : 1;
    drawLampShape(ctx, def, 'unlit', sx, sy);
    ctx.restore();
    n++;
  }
  return n;
}

/**
 * Builds the lit-sprite atlas (ARCHITECTURE 9.2): uniform square cells, ATLAS_COLS per row, row-major in lampKeys() order.
 * cells[key] = {u0,v0,u1,v1,w,h}: UVs in the flipY convention of patchUV (v = 1 - py/H), inset by half a pixel against bleeding;
 * w,h = cell size in pixels.  Extra fields (additive): cell, cols, rows, keys.
 * @param {import('../../types.js').DataModule} data
 * @param {(w:number,h:number)=>any} createCanvas
 * @param {import('../../types.js').Rand01} _rand unused (kept for the painter signature; the sprites are fully deterministic)
 * @param {number} [cellPx] 128 (64 at quality 'low')
 * @returns {import('../../types.js').LampAtlas}
 */
export function buildLampAtlas(data, createCanvas, _rand, cellPx = 128) {
  const keys = lampKeys(data);
  const cols = ATLAS_COLS;
  const rows = Math.ceil(keys.length / cols);
  const width = cols * cellPx, height = rows * cellPx;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const cells = {};
  const half = 0.5;
  keys.forEach((key, i) => {
    const hash = key.indexOf('#');
    const name = hash < 0 ? key : key.slice(0, hash);
    const colorIndex = hash < 0 ? 0 : Number(key.slice(hash + 1));
    const def = data.LAMP_BY_NAME[name];
    const c = i % cols, r = Math.floor(i / cols);
    const x0 = c * cellPx, y0 = r * cellPx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, cellPx, cellPx);
    ctx.clip();
    ctx.translate(x0 + cellPx / 2, y0 + cellPx / 2);
    drawLampShape(ctx, def, 'lit', cellPx / def.size[0], cellPx / def.size[1], { colorIndex });
    ctx.restore();
    cells[key] = {
      u0: (x0 + half) / width,
      u1: (x0 + cellPx - half) / width,
      v0: 1 - (y0 + cellPx - half) / height,
      v1: 1 - (y0 + half) / height,
      w: cellPx,
      h: cellPx,
    };
  });
  return { canvas, width, height, cells, cell: cellPx, cols, rows, keys };
}
