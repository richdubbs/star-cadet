/**
 * src/render/art/font.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2 (original lettering; no font files, no fillText so the look is identical everywhere)
 * An ORIGINAL vector "stroke" alphabet (chamfered, techno look) used for every painted word of the table: STAR CADET, HYPERSPACE, LAUNCH,
 * RE-ENTRY, FUEL, MEDAL, MISSION, BOOSTER, rank names, the panel logo.  Each glyph is a list of polylines on a grid 6 units tall (cap height)
 * and `w` units wide; the strokes are drawn with round caps/joins so a thick stroke reads as bubble lettering and a thin one as a
 * stencil.  Pure: only path/stroke calls of the allowed canvas subset.
 *
 * Local frame of every function here: x = reading direction (screen right), y = screen down, origin = the anchor point.  To use it
 * inside table space (where x is mirrored) call `screenAt(ctx, x, y, angle, fn)` which installs that frame at a T-frame point.
 */
/** Cap height of the glyph grid. */
const CAP = 6;

/** @type {Record<string, {w:number, strokes:number[][][]}>} */
export const GLYPHS = Object.freeze({
  A: { w: 4, strokes: [[[0, 6], [0, 1.6], [1.6, 0], [2.4, 0], [4, 1.6], [4, 6]], [[0, 3.6], [4, 3.6]]] },
  B: { w: 4, strokes: [[[0, 0], [0, 6]], [[0, 0], [2.8, 0], [3.8, 0.9], [3.8, 2.3], [2.8, 3.1], [0, 3.1]], [[2.8, 3.1], [4, 3.9], [4, 5.1], [3, 6], [0, 6]]] },
  C: { w: 4, strokes: [[[4, 1.4], [2.8, 0], [1.2, 0], [0, 1.4], [0, 4.6], [1.2, 6], [2.8, 6], [4, 4.6]]] },
  D: { w: 4, strokes: [[[0, 0], [0, 6], [2.4, 6], [4, 4.4], [4, 1.6], [2.4, 0], [0, 0]]] },
  E: { w: 4, strokes: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3.2, 3]]] },
  F: { w: 4, strokes: [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3.2, 3]]] },
  G: { w: 4, strokes: [[[4, 1.4], [2.8, 0], [1.2, 0], [0, 1.4], [0, 4.6], [1.2, 6], [2.8, 6], [4, 4.6], [4, 3.2], [2.2, 3.2]]] },
  H: { w: 4, strokes: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]] },
  I: { w: 2, strokes: [[[0, 0], [2, 0]], [[1, 0], [1, 6]], [[0, 6], [2, 6]]] },
  J: { w: 4, strokes: [[[4, 0], [4, 4.6], [2.8, 6], [1.2, 6], [0, 4.6]]] },
  K: { w: 4, strokes: [[[0, 0], [0, 6]], [[4, 0], [0.6, 3.2]], [[1.4, 2.5], [4, 6]]] },
  L: { w: 4, strokes: [[[0, 0], [0, 6], [4, 6]]] },
  M: { w: 4, strokes: [[[0, 6], [0, 0], [2, 3.2], [4, 0], [4, 6]]] },
  N: { w: 4, strokes: [[[0, 6], [0, 0], [4, 6], [4, 0]]] },
  O: { w: 4, strokes: [[[1.2, 0], [2.8, 0], [4, 1.4], [4, 4.6], [2.8, 6], [1.2, 6], [0, 4.6], [0, 1.4], [1.2, 0]]] },
  P: { w: 4, strokes: [[[0, 6], [0, 0], [2.9, 0], [4, 1], [4, 2.4], [2.9, 3.4], [0, 3.4]]] },
  Q: { w: 4, strokes: [[[1.2, 0], [2.8, 0], [4, 1.4], [4, 4.6], [2.8, 6], [1.2, 6], [0, 4.6], [0, 1.4], [1.2, 0]], [[2.4, 4.3], [4, 6.3]]] },
  R: { w: 4, strokes: [[[0, 6], [0, 0], [2.9, 0], [4, 1], [4, 2.4], [2.9, 3.4], [0, 3.4]], [[2, 3.4], [4, 6]]] },
  S: { w: 4, strokes: [[[4, 1.2], [2.8, 0], [1.2, 0], [0, 1.2], [0, 2.3], [1.2, 3], [2.8, 3], [4, 3.7], [4, 4.8], [2.8, 6], [1.2, 6], [0, 4.8]]] },
  T: { w: 4, strokes: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]] },
  U: { w: 4, strokes: [[[0, 0], [0, 4.6], [1.2, 6], [2.8, 6], [4, 4.6], [4, 0]]] },
  V: { w: 4, strokes: [[[0, 0], [2, 6], [4, 0]]] },
  W: { w: 5, strokes: [[[0, 0], [1.2, 6], [2.5, 2.6], [3.8, 6], [5, 0]]] },
  X: { w: 4, strokes: [[[0, 0], [4, 6]], [[4, 0], [0, 6]]] },
  Y: { w: 4, strokes: [[[0, 0], [2, 3.2], [4, 0]], [[2, 3.2], [2, 6]]] },
  Z: { w: 4, strokes: [[[0, 0], [4, 0], [0, 6], [4, 6]]] },
  0: { w: 4, strokes: [[[1.2, 0], [2.8, 0], [4, 1.4], [4, 4.6], [2.8, 6], [1.2, 6], [0, 4.6], [0, 1.4], [1.2, 0]], [[1, 4.8], [3, 1.2]]] },
  1: { w: 4, strokes: [[[0.6, 1.4], [2, 0], [2, 6]], [[0.6, 6], [3.4, 6]]] },
  2: { w: 4, strokes: [[[0, 1.3], [1.2, 0], [2.8, 0], [4, 1.3], [4, 2.5], [0, 6], [4, 6]]] },
  3: { w: 4, strokes: [[[0, 0.9], [1.1, 0], [2.9, 0], [4, 1], [4, 2.2], [2.9, 3], [1.6, 3]], [[2.9, 3], [4, 3.8], [4, 5], [2.9, 6], [1.1, 6], [0, 5.1]]] },
  4: { w: 4, strokes: [[[3, 6], [3, 0], [0, 4.2], [4, 4.2]]] },
  5: { w: 4, strokes: [[[4, 0], [0, 0], [0, 2.8], [2.8, 2.8], [4, 3.8], [4, 5], [2.8, 6], [1.2, 6], [0, 5]]] },
  6: { w: 4, strokes: [[[4, 1], [2.8, 0], [1.2, 0], [0, 1.4], [0, 4.6], [1.2, 6], [2.8, 6], [4, 4.8], [4, 3.9], [2.8, 2.9], [0, 2.9]]] },
  7: { w: 4, strokes: [[[0, 0], [4, 0], [1.6, 6]]] },
  8: { w: 4, strokes: [[[1.2, 0], [2.8, 0], [4, 1], [4, 2.2], [2.8, 3], [1.2, 3], [0, 2.2], [0, 1], [1.2, 0]], [[1.2, 3], [0, 3.8], [0, 5], [1.2, 6], [2.8, 6], [4, 5], [4, 3.8], [2.8, 3]]] },
  9: { w: 4, strokes: [[[0, 5], [1.2, 6], [2.8, 6], [4, 4.6], [4, 1.4], [2.8, 0], [1.2, 0], [0, 1.2], [0, 2.1], [1.2, 3.1], [4, 3.1]]] },
  '-': { w: 3, strokes: [[[0.4, 3], [2.6, 3]]] },
  '.': { w: 1, strokes: [[[0.5, 5.9], [0.5, 6]]] },
  ':': { w: 1, strokes: [[[0.5, 1.9], [0.5, 2]], [[0.5, 5.9], [0.5, 6]]] },
  '!': { w: 1, strokes: [[[0.5, 0], [0.5, 4]], [[0.5, 5.9], [0.5, 6]]] },
  '?': { w: 4, strokes: [[[0, 1.2], [1.2, 0], [2.8, 0], [4, 1.2], [4, 2.4], [2, 3.6], [2, 4.4]], [[2, 5.9], [2, 6]]] },
  '/': { w: 3, strokes: [[[0, 6], [3, 0]]] },
  "'": { w: 1, strokes: [[[0.5, 0], [0.5, 1.6]]] },
  '+': { w: 4, strokes: [[[0.2, 3], [3.8, 3]], [[2, 1.2], [2, 4.8]]] },
  ' ': { w: 2.2, strokes: [] },
});

/** Glyph for a character (lower case maps to upper case, unknown characters to '?'). */
export function glyphOf(ch) {
  const c = ch.length === 1 ? ch.toUpperCase() : ch;
  return GLYPHS[c] || GLYPHS['?'];
}

/** Width of a string at cap height `size` with the given tracking (fraction of `size` between glyphs). */
export function textWidth(text, size, tracking = 0.3) {
  const k = size / CAP;
  let w = 0;
  let n = 0;
  for (const ch of text) { w += glyphOf(ch).w * k; n++; }
  return n > 1 ? w + (n - 1) * tracking * size : w;
}

function buildPath(ctx, text, size, o, x0, y0, dx, dy) {
  const k = size / CAP;
  let cursor = x0;
  ctx.beginPath();
  for (const ch of text) {
    const g = glyphOf(ch);
    for (const s of g.strokes) {
      for (let i = 0; i < s.length; i++) {
        const px = cursor + (s[i][0] + o.slant * (3 - s[i][1])) * k + dx;
        const py = y0 + s[i][1] * k + dy;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    }
    cursor += g.w * k + o.tracking * size;
  }
}

/**
 * Draws `text` in the local screen frame (x right, y down) at the origin.
 * @param {*} ctx
 * @param {string} text
 * @param {number} size cap height in current units
 * @param {{align?:'left'|'center'|'right', valign?:'top'|'middle'|'bottom', tracking?:number, weight?:number, slant?:number,
 *   fill?:string|object, outline?:{color:string,width:number}, shadow?:{color:string,dx:number,dy:number}, highlight?:{color:string,dx:number,dy:number,weight?:number}}} [opts]
 */
export function drawLetters(ctx, text, size, opts = {}) {
  const o = { align: 'center', valign: 'middle', tracking: 0.3, weight: 0.2, slant: 0, fill: '#ffffff', ...opts };
  const total = textWidth(text, size, o.tracking);
  const x0 = o.align === 'left' ? 0 : o.align === 'right' ? -total : -total / 2;
  const y0 = o.valign === 'top' ? 0 : o.valign === 'bottom' ? -size : -size / 2;
  const w = o.weight * size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.outline) {
    buildPath(ctx, text, size, o, x0, y0, 0, 0);
    ctx.strokeStyle = o.outline.color;
    ctx.lineWidth = w + 2 * o.outline.width;
    ctx.stroke();
  }
  if (o.shadow) {
    buildPath(ctx, text, size, o, x0, y0, o.shadow.dx, o.shadow.dy);
    ctx.strokeStyle = o.shadow.color;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  buildPath(ctx, text, size, o, x0, y0, 0, 0);
  ctx.strokeStyle = o.fill;
  ctx.lineWidth = w;
  ctx.stroke();
  if (o.highlight) {
    buildPath(ctx, text, size, o, x0, y0, o.highlight.dx, o.highlight.dy);
    ctx.strokeStyle = o.highlight.color;
    ctx.lineWidth = (o.highlight.weight ?? 0.35) * w;
    ctx.stroke();
  }
}

/**
 * Draws text along a circle (screen frame, origin = circle centre).  Letters stand on the circle and face outward when `inside` is
 * false (use on the upper half, reading clockwise) and face inward / upright when `inside` is true (use on the lower half).
 * @param {number} radius baseline radius (distance of the letter centre line from the origin)
 * @param {number} centerAngle canvas angle of the text centre (radians, 0 = +x, clockwise because y is down; -PI/2 = top)
 */
export function drawLettersOnArc(ctx, text, radius, centerAngle, size, opts = {}) {
  const tracking = opts.tracking ?? 0.3;
  const k = size / CAP;
  const chars = Array.from(text);
  const widths = chars.map((ch) => glyphOf(ch).w * k);
  const total = textWidth(text, size, tracking);
  const dir = opts.inside ? -1 : 1;
  let cursor = -total / 2;
  chars.forEach((ch, i) => {
    const mid = cursor + widths[i] / 2;
    cursor += widths[i] + tracking * size;
    const a = centerAngle + (dir * mid) / radius;
    ctx.save();
    ctx.translate(Math.cos(a) * radius, Math.sin(a) * radius);
    ctx.rotate(opts.inside ? a - Math.PI / 2 : a + Math.PI / 2);
    drawLetters(ctx, ch, size, { ...opts, align: 'center', valign: 'middle' });
    ctx.restore();
  });
}

/**
 * Runs fn(ctx) in the local SCREEN frame anchored at the T-frame point (x, y): x right, y down, angle = clockwise screen rotation.
 * Call inside a transform installed by tableSpace().enter(ctx).
 */
export function screenAt(ctx, x, y, angle, fn) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  if (angle) ctx.rotate(angle);
  fn(ctx);
  ctx.restore();
}

/** Total angle subtended by a string on a circle of the given radius (radians). */
export function arcSpan(text, radius, size, tracking = 0.3) { return textWidth(text, size, tracking) / radius; }
