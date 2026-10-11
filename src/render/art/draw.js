/**
 * src/render/art/draw.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2 (canvas 2D subset only), 14 (conventions)
 * Shared, pure drawing helpers for the ART painters (floor, deck, lamps, misc, panel). Everything here only calls members of the
 * allowed canvas-2D subset (save/restore/translate/scale/rotate/setTransform, paths, fill/stroke/clip, fillRect, gradients, ...), never
 * touches window/document and never calls Math.random: all randomness comes from the Rand01 handed in by the caller.
 *
 * Table space.  `tableSpace(patch)` returns the helper that maps the T-frame (SPEC 1.1: +x = screen-LEFT, +y = toward the player) to the
 * pixels of a CanvasPatch exactly like src/render/art/mapping.js (px = (xMax-x)*sx, py = (y-yMin)*sy).  `enter(ctx)` installs the
 * transform so you can draw directly in T-frame units (a ctx.rotate(a) inside is then a T-frame CCW rotation by `a`, seen from above);
 * text and other handed things use `screenAt` (see font.js) which flips x back so local x = screen right, local y = screen down.
 */

export const TAU = Math.PI * 2;

/** @param {string} c '#rgb' | '#rrggbb' @returns {[number, number, number]} */
export function parseColor(c) {
  let h = String(c).trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) throw new TypeError('art.draw: bad colour ' + c);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const h2 = (v) => {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  return (n < 16 ? '0' : '') + n.toString(16);
};
/** @returns {string} '#rrggbb' */
export function rgb(r, g, b) { return '#' + h2(r) + h2(g) + h2(b); }
/** CSS rgba() string of a hex colour with alpha a (0..1, rounded to 3 decimals so output is stable). */
export function rgba(c, a) {
  const [r, g, b] = parseColor(c);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000 + ')';
}
/** Linear mix of two hex colours, t = 0 -> a, 1 -> b. */
export function mix(a, b, t) {
  const A = parseColor(a), B = parseColor(b);
  return rgb(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function lighten(c, t) { return mix(c, '#ffffff', t); }
export function darken(c, t) { return mix(c, '#000000', t); }

// ---- randomness helpers (all take the caller's Rand01) -----------------------------------------------------------------------------
/** uniform float in [a, b) */
export function rr(rand, a, b) { return a + (b - a) * rand(); }
/** uniform integer in [a, b] */
export function ri(rand, a, b) { return Math.floor(a + (b - a + 1) * rand()); }
/** random element */
export function pick(rand, arr) { return arr[Math.floor(rand() * arr.length) % arr.length]; }
/** standard normal (Box-Muller, consumes two numbers) */
export function gauss(rand) {
  const u = 1 - rand(), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

// ---- gradients ---------------------------------------------------------------------------------------------------------------------
/** @param {Array<[number,string]>} stops */
function applyStops(g, stops) { for (const [o, c] of stops) g.addColorStop(o, c); return g; }
export function radial(ctx, x, y, r0, r1, stops) { return applyStops(ctx.createRadialGradient(x, y, r0, x, y, r1), stops); }
export function radial2(ctx, x0, y0, r0, x1, y1, r1, stops) { return applyStops(ctx.createRadialGradient(x0, y0, r0, x1, y1, r1), stops); }
export function linear(ctx, x0, y0, x1, y1, stops) { return applyStops(ctx.createLinearGradient(x0, y0, x1, y1), stops); }

// ---- paths -------------------------------------------------------------------------------------------------------------------------
/** Adds a polygon sub-path (no beginPath). */
export function polyPath(ctx, pts, close = true) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}
/** Adds a smooth closed blob through the midpoints of the polygon's edges (quadratic corners). */
export function smoothClosedPath(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}
/** Smooth open curve through the given points (quadratic through midpoints; ends are exact). */
export function smoothOpenPath(ctx, pts) {
  const n = pts.length;
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (n === 2) { ctx.lineTo(pts[1][0], pts[1][1]); return; }
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], i === n - 2 ? pts[n - 1][0] : mx, i === n - 2 ? pts[n - 1][1] : my);
  }
}
/** Rounded rectangle sub-path (quadratic corners), x,y = top-left. */
export function rrectPath(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}
/** Star polygon sub-path with n points. */
export function starPath(ctx, cx, cy, rOuter, rInner, n, rot = -Math.PI / 2) {
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const r = i % 2 === 0 ? rOuter : rInner;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
/** Regular polygon sub-path. */
export function ngonPath(ctx, cx, cy, r, n, rot = -Math.PI / 2) {
  for (let i = 0; i < n; i++) {
    const a = rot + (i * TAU) / n;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ---- convenience painters ---------------------------------------------------------------------------------------------------------
/** Soft round glow: radial alpha falloff from `alpha` at the centre to 0 at r. */
export function glowDisc(ctx, x, y, r, color, alpha, inner = 0) {
  ctx.fillStyle = radial(ctx, x, y, inner, r, [[0, rgba(color, alpha)], [0.45, rgba(color, alpha * 0.4)], [1, rgba(color, 0)]]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
/** Disc fill. */
export function disc(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
/** Ring stroke. */
export function ring(ctx, x, y, r, width, stroke) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
}
/** Straight line stroke. */
export function line(ctx, x0, y0, x1, y1, width, stroke, cap = 'round') {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}
/** Fill and optionally stroke a polygon (own beginPath). */
export function polyFill(ctx, pts, fill, stroke = null, width = 1) {
  ctx.beginPath();
  polyPath(ctx, pts, true);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke(); }
}
/** Polyline stroke through points (own beginPath). */
export function polyStroke(ctx, pts, width, stroke, cap = 'round', join = 'round') {
  ctx.beginPath();
  polyPath(ctx, pts, false);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.lineJoin = join;
  ctx.stroke();
}
/** Resets the shadow state (call after drawing with shadowBlur). */
export function noShadow(ctx) {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

// ---- geometry helpers (pure numbers) -----------------------------------------------------------------------------------------------
/** Even-odd point in polygon. */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Centroid of the vertex list. */
export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
/** Resamples a polyline to n points evenly spaced by arc length (t = 0..1). */
export function resample(pts, n) {
  const seg = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = seg[seg.length - 1];
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const d = (total * i) / (n - 1);
    while (k < seg.length - 2 && seg[k + 1] < d) k++;
    const span = seg[k + 1] - seg[k] || 1;
    const t = (d - seg[k]) / span;
    out.push([pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t]);
  }
  return out;
}

// ---- table space -------------------------------------------------------------------------------------------------------------------
/**
 * @param {{rect:{xMin:number,xMax:number,yMin:number,yMax:number}, width:number, height:number}} patch
 * @returns {{sx:number, sy:number, px:(x:number)=>number, py:(y:number)=>number, enter:(ctx:any)=>void, leave:(ctx:any)=>void}}
 */
export function tableSpace(patch) {
  const r = patch.rect;
  const sx = patch.width / (r.xMax - r.xMin);
  const sy = patch.height / (r.yMax - r.yMin);
  return {
    sx,
    sy,
    px: (x) => (r.xMax - x) * sx,
    py: (y) => (y - r.yMin) * sy,
    /** save() + install the T-frame -> pixel transform (draw in table units afterwards). */
    enter(ctx) {
      ctx.save();
      ctx.setTransform(-sx, 0, 0, sy, r.xMax * sx, -r.yMin * sy);
    },
    leave(ctx) { ctx.restore(); },
  };
}
