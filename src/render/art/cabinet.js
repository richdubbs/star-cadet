/**
 * src/render/art/cabinet.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: additive ArtPack member `cabinet` (ARCHITECTURE.md 9.2 rules: original procedural art, only the allowed 2D-context subset, all randomness
 * from `rand`). paintCabinet(data, createCanvas, rand, quality) -> Record<CABINET_KEYS, CanvasLike>, the textures of the arcade cabinet around the table
 * (src/render/cabinet.js; panel shapes from mapping.js CABINET / CABINET_SIDE):
 *   sideL, sideR  the trapezoid side panels read from outside (u = along the cabinet, v = up; the bottom edge is sloped: the panel is deeper at the
 *                 back). L: back at u = 0; R: front at u = 0. Same composition (logo reads the same way), mirrored geometry; stripes follow the
 *                 sloped bottom edge and continue round the front corner at the same heights.
 *   front         the front face under the lockdown bar (neon stripes, INSERT COIN / START / LAUNCH lettering; the coin door is a separate part)
 *   rear, boxRear the back faces of the body and of the backbox (inset service door with vents and a rating plate)
 *   boxSide       backbox side panels (portrait): vertical logo, stripes along both edges
 *   backglass     the backlit glass of the backbox (landscape): space scene + STAR CADET logo + tagline band, backlight vignette and sheen
 *   speaker       the speaker panel under the backglass (two round grilles with dust caps at the ends, the bezel of the dot-matrix display)
 *   coinDoor      the coin door (two coin entries with lit price inserts, lock, coin return flaps)
 *   carpet        the arcade floor (tileable both ways); mottle = low-frequency light/dark blotches that break up its repeat (tileable)
 *   inside        the inner faces of the cabinet walls above the playfield (tileable along u)
 * ASSUMPTIONS: sizes per quality in CABINET_SIZES; lettering uses the original vector font (font.js), never fillText.
 */
import { TAU, rr, ri, rgba, linear, radial, radial2, glowDisc, disc, ring, line, rrectPath, starPath, smoothOpenPath, polyFill, mix } from './draw.js';
import { drawLetters, textWidth } from './font.js';
import { mulberry32 } from './rng.js';
import { CABINET, CABINET_SIDE } from './mapping.js';

/** Canvas sizes [w, h] per quality. */
export const CABINET_SIZES = Object.freeze({
  normal: Object.freeze({
    sideL: [1536, 504], sideR: [1536, 504], front: [1024, 476], rear: [768, 548], boxRear: [512, 620], boxSide: [256, 704], backglass: [1024, 800],
    speaker: [1024, 384], coinDoor: [1024, 896], carpet: [512, 512], mottle: [256, 256], inside: [512, 128],
  }),
  high: Object.freeze({
    sideL: [2048, 672], sideR: [2048, 672], front: [1536, 714], rear: [1024, 732], boxRear: [512, 620], boxSide: [320, 880], backglass: [1280, 1000],
    speaker: [1536, 576], coinDoor: [1024, 896], carpet: [512, 512], mottle: [256, 256], inside: [512, 128],
  }),
  low: Object.freeze({
    sideL: [1024, 336], sideR: [1024, 336], front: [512, 238], rear: [384, 274], boxRear: [256, 310], boxSide: [192, 528], backglass: [768, 600],
    speaker: [512, 192], coinDoor: [512, 448], carpet: [256, 256], mottle: [128, 128], inside: [256, 64],
  }),
});
export const CABINET_KEYS = Object.freeze(Object.keys(CABINET_SIZES.normal));

/** Heights (table units above the body's bottom edge) of the three neon pinstripes that run round the body. */
export const STRIPE_HEIGHTS = Object.freeze([0.45, 0.76, 1.07]);

const NEON = Object.freeze({ pink: '#ff3fa4', cyan: '#29d4ff', yellow: '#ffd23f', violet: '#9b5cff', green: '#4dff88', orange: '#ff8a2a' });
const STRIPE_COLORS = Object.freeze([NEON.cyan, NEON.violet, NEON.pink]);

function make(createCanvas, size) {
  const [w, h] = size;
  const canvas = createCanvas(w, h);
  return { canvas, ctx: canvas.getContext('2d'), w, h };
}

/** Stars: many 1-2 px dots + a few sparkles, inside (x, y, w, h). */
function stars(ctx, rand, x, y, w, h, n, sparkles, scale = 1) {
  const cols = ['#ffffff', '#cfe8ff', '#ffe8f8', '#d8d0ff', '#fff2c8'];
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rgba(cols[ri(rand, 0, cols.length - 1)], rr(rand, 0.25, 0.95));
    const s = (rand() < 0.88 ? 1 : 2) * scale;
    ctx.fillRect(Math.floor(rr(rand, x, x + w)), Math.floor(rr(rand, y, y + h)), s, s);
  }
  for (let i = 0; i < sparkles; i++) {
    const sx = rr(rand, x + 6, x + w - 6), sy = rr(rand, y + 6, y + h - 6), r = rr(rand, 3, 7) * scale;
    glowDisc(ctx, sx, sy, r * 1.6, '#b8d4ff', 0.35);
    line(ctx, sx - r, sy, sx + r, sy, 0.9 * scale, rgba('#ffffff', 0.9));
    line(ctx, sx, sy - r, sx, sy + r, 0.9 * scale, rgba('#ffffff', 0.9));
  }
}

/** Soft nebula clouds (overlapping glows). */
function nebula(ctx, rand, blobs) {
  for (const [x, y, r, c, a] of blobs) {
    glowDisc(ctx, x, y, r, c, a);
    for (let i = 0; i < 4; i++) glowDisc(ctx, x + rr(rand, -r, r) * 0.6, y + rr(rand, -r, r) * 0.4, r * rr(rand, 0.3, 0.6), c, a * 0.6);
  }
}

/** Banded gas giant with a ring (back half of the ring behind the body, front half over it). */
function ringedPlanet(ctx, rand, cx, cy, r, tilt, colors, ringScale = 1.55) {
  const ringHalf = (from, to, alpha) => {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(tilt);
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (ringScale + k * 0.14), r * (0.32 + k * 0.03), 0, from, to);
      ctx.strokeStyle = rgba(colors.ring, alpha - k * 0.13);
      ctx.lineWidth = r * 0.065;
      ctx.stroke();
    }
    ctx.restore();
  };
  glowDisc(ctx, cx, cy, r * 1.6, colors.glow, 0.3);
  ringHalf(Math.PI, TAU, 0.5);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = radial2(ctx, cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05, [[0, colors.hi], [0.45, colors.mid], [1, colors.dark]]);
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  ctx.translate(cx, cy); ctx.rotate(tilt);
  for (let i = 0; i < 9; i++) {
    const y = rr(rand, -r, r);
    ctx.fillStyle = rgba(rand() < 0.5 ? colors.band : colors.hi, rr(rand, 0.1, 0.28));
    ctx.fillRect(-r * 1.2, y, r * 2.4, rr(rand, r * 0.04, r * 0.14));
  }
  ctx.rotate(-tilt); ctx.translate(-cx, -cy);
  ctx.fillStyle = linear(ctx, cx - r, cy - r, cx + r, cy + r, [[0.45, rgba('#000000', 0)], [1, rgba('#000000', 0.7)]]);
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  ctx.restore();
  ringHalf(0, Math.PI, 0.78);
}

/** Small rocky moon. */
function moon(ctx, rand, cx, cy, r, base) {
  glowDisc(ctx, cx, cy, r * 1.7, base, 0.25);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = radial2(ctx, cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05, [[0, mix(base, '#ffffff', 0.55)], [0.5, base], [1, mix(base, '#000000', 0.75)]]);
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  for (let i = 0; i < 12; i++) {
    const a = rr(rand, 0, TAU), d = Math.sqrt(rand()) * r * 0.85;
    disc(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr(rand, r * 0.05, r * 0.16), rgba('#000000', rr(rand, 0.12, 0.3)));
  }
  ctx.restore();
}

/** Original rocket (nose towards local +x) with a flame trail towards -x; size = body length; mirror = flip left/right. */
function rocket(ctx, x, y, angle, size, rand, mirror = false) {
  const L = size, R = size * 0.16;
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.rotate(angle);
  for (let i = 0; i < 3; i++) {
    const fl = L * (1.6 - i * 0.4), fw = R * (1.25 - i * 0.3);
    ctx.beginPath();
    ctx.moveTo(-L * 0.42, -fw);
    ctx.quadraticCurveTo(-L * 0.42 - fl * 0.55, -fw * 0.6, -L * 0.42 - fl, 0);
    ctx.quadraticCurveTo(-L * 0.42 - fl * 0.55, fw * 0.6, -L * 0.42, fw);
    ctx.closePath();
    ctx.fillStyle = linear(ctx, -L * 0.42, 0, -L * 0.42 - fl, 0, [[0, ['#fff6c8', '#ffd040', '#ff7020'][i]], [0.6, rgba(['#ffb030', '#ff6a10', '#d02a10'][i], 0.7)], [1, rgba('#c01010', 0)]]);
    ctx.fill();
  }
  glowDisc(ctx, -L * 0.5, 0, R * 2.6, '#ffb040', 0.55);
  polyFill(ctx, [[-L * 0.22, -R * 0.8], [-L * 0.45, -R * 2.1], [-L * 0.48, -R * 0.6]], '#c41a2a');
  polyFill(ctx, [[-L * 0.22, R * 0.8], [-L * 0.45, R * 2.1], [-L * 0.48, R * 0.6]], '#a01020');
  ctx.beginPath();
  ctx.moveTo(-L * 0.45, -R);
  ctx.lineTo(L * 0.12, -R);
  ctx.quadraticCurveTo(L * 0.42, -R * 0.75, L * 0.55, 0);
  ctx.quadraticCurveTo(L * 0.42, R * 0.75, L * 0.12, R);
  ctx.lineTo(-L * 0.45, R);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, -R, 0, R, [[0, '#ffffff'], [0.45, '#d8dce8'], [1, '#7a8098']]);
  ctx.fill();
  ctx.strokeStyle = rgba('#1a1430', 0.8);
  ctx.lineWidth = Math.max(1, size * 0.012);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(L * 0.3, -R * 0.93);
  ctx.quadraticCurveTo(L * 0.45, -R * 0.65, L * 0.55, 0);
  ctx.quadraticCurveTo(L * 0.45, R * 0.65, L * 0.3, R * 0.93);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, -R, 0, R, [[0, '#ff6a6a'], [0.5, '#d0202a'], [1, '#701018']]);
  ctx.fill();
  ctx.fillStyle = rgba('#c41a2a', 0.85);
  ctx.fillRect(-L * 0.3, -R, L * 0.05, 2 * R);
  disc(ctx, L * 0.08, 0, R * 0.48, '#20304a');
  disc(ctx, L * 0.08, 0, R * 0.36, radial2(ctx, L * 0.05, -R * 0.12, 0, L * 0.08, 0, R * 0.36, [[0, '#d8f8ff'], [0.4, '#40c8ff'], [1, '#1050a0']]));
  ring(ctx, L * 0.08, 0, R * 0.48, Math.max(1, size * 0.015), '#e8ecf4');
  for (let i = 0; i < 5; i++) {
    const yy = rr(rand, -R * 2.6, R * 2.6);
    line(ctx, -L * rr(rand, 0.9, 1.3), yy, -L * rr(rand, 1.6, 2.4), yy, Math.max(1, size * 0.012), rgba('#bfe0ff', rr(rand, 0.25, 0.5)));
  }
  ctx.restore();
}

/** Glowing neon title: a wide soft halo stroke, a dark outline, the face and a highlight. */
function neonWord(ctx, text, size, face, glow, opts = {}) {
  drawLetters(ctx, text, size, { align: 'center', tracking: opts.tracking ?? 0.32, weight: 0.5, slant: opts.slant ?? 0, fill: rgba(glow, 0.22) });
  drawLetters(ctx, text, size, { align: 'center', tracking: opts.tracking ?? 0.32, weight: 0.36, slant: opts.slant ?? 0, fill: rgba(glow, 0.35) });
  drawLetters(ctx, text, size, {
    align: 'center', tracking: opts.tracking ?? 0.32, weight: opts.weight ?? 0.24, slant: opts.slant ?? 0, fill: face,
    outline: { color: opts.outline ?? '#1c0a44', width: size * 0.035 },
    shadow: { color: opts.shadow ?? '#5a2aa8', dx: size * 0.05, dy: size * 0.06 },
    highlight: { color: '#ffffff', dx: -size * 0.02, dy: -size * 0.025, weight: 0.32 },
  });
}

/** Small glowing label (two strokes: halo + face). */
function label(ctx, text, x, y, size, color, tracking = 0.45) {
  ctx.save();
  ctx.translate(x, y);
  drawLetters(ctx, text, size, { align: 'center', tracking, weight: 0.42, fill: rgba(color, 0.25) });
  drawLetters(ctx, text, size, { align: 'center', tracking, weight: 0.2, fill: color, shadow: { color: '#000000', dx: size * 0.06, dy: size * 0.08 } });
  ctx.restore();
}

/** One glowing pinstripe along the polyline y = f(x) (canvas px), full width. */
function stripeAlong(ctx, w, f, width, color) {
  const band = (half, fill) => {
    ctx.beginPath();
    ctx.moveTo(0, f(0) - half); ctx.lineTo(w, f(w) - half); ctx.lineTo(w, f(w) + half); ctx.lineTo(0, f(0) + half);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  band(width * 1.6, rgba(color, 0.25));
  band(width / 2, color);
}

// ---- side panels (trapezoids) ------------------------------------------------------------------------------------------------------------
/** @param {boolean} flip false = left panel (back at u 0), true = right panel (front at u 0) */
function paintSide(createCanvas, rand, size, flip) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  const S = CABINET_SIDE;
  const pxPerUnit = h / S.height;
  const back = (t) => (flip ? 1 - t : t) * w;                          // canvas x of a position t (0 = back end, 1 = front end)
  const bottom = (x) => h * (1 - S.shallowV * (flip ? 1 - x / w : x / w)); // canvas y of the sloped bottom edge
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#1c0e40'], [0.5, '#100830'], [1, '#07040f']]);
  ctx.fillRect(0, 0, w, h);
  nebula(ctx, rand, [[back(0.2), h * 0.45, h * 0.55, '#5a2a9a', 0.34], [back(0.62), h * 0.55, h * 0.5, '#8a2070', 0.24], [back(0.45), h * 0.18, h * 0.45, '#1a5a8a', 0.26], [back(0.88), h * 0.3, h * 0.38, '#3a2ab0', 0.26]]);
  stars(ctx, rand, 0, 0, w, h * 0.85, Math.round(w * h / 1300), 16, w / 1536);
  // the deep back end carries the big planet; a small moon up high; the rocket flies towards the front
  ringedPlanet(ctx, rand, back(0.115), h * 0.5, h * 0.24, flip ? 0.25 : -0.25, { hi: '#ffd0a0', mid: '#e0702a', dark: '#4a1408', band: '#8a2a10', ring: '#ffe0b0', glow: '#ff8a40' }, 1.2);
  moon(ctx, rand, back(0.33), h * 0.15, h * 0.055, '#4cc070');
  rocket(ctx, back(0.93), h * 0.34, -0.3, h * 0.26, rand, flip);
  ctx.save();
  ctx.translate(back(0.46), h * 0.37);
  neonWord(ctx, 'STAR CADET', h * 0.15, '#eedcff', '#a868ff', { slant: -0.12 });
  ctx.translate(0, h * 0.18);
  drawLetters(ctx, '3D PINBALL', h * 0.06, { align: 'center', tracking: 0.55, weight: 0.24, fill: NEON.cyan, shadow: { color: '#0a3a5a', dx: 2, dy: 2 } });
  ctx.restore();
  // darker lower band and the neon pinstripes, parallel to the sloped bottom edge
  const bandTop = (x) => bottom(x) - h * 0.2;
  ctx.beginPath();
  ctx.moveTo(0, bandTop(0)); ctx.lineTo(w, bandTop(w)); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, h * (1 - S.shallowV) - h * 0.2, 0, h, [[0, rgba('#000000', 0)], [0.35, rgba('#000000', 0.5)], [1, rgba('#000000', 0.75)]]);
  ctx.fill();
  STRIPE_HEIGHTS.forEach((hh, i) => stripeAlong(ctx, w, (x) => bottom(x) - hh * pxPerUnit, Math.max(2, h * 0.008), STRIPE_COLORS[i]));
  // chevrons pointing to the front, above the stripes
  for (let i = 0; i < 8; i++) {
    const t = 0.3 + i * 0.065, x = back(t), y = bottom(x) - h * 0.15, s = h * 0.03, d = flip ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(x - d * s, y - s); ctx.lineTo(x, y); ctx.lineTo(x - d * s, y + s);
    ctx.strokeStyle = rgba(NEON.yellow, 0.25 + 0.07 * i);
    ctx.lineWidth = Math.max(2, h * 0.01);
    ctx.stroke();
  }
  // top edge (under the side rail)
  ctx.fillStyle = '#05040a';
  ctx.fillRect(0, 0, w, Math.round(h * 0.022));
  return canvas;
}

// ---- front and rear faces ------------------------------------------------------------------------------------------------------------------
function paintFront(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  const k = w / 1024, pxPerUnit = h / CABINET.frontDepth;
  const ux = (x) => ((x + CABINET.xOut) / (2 * CABINET.xOut)) * w;       // canvas x of a table x (Three axes)
  const vy = (y) => ((CABINET.yTop - y) / CABINET.frontDepth) * h;       // canvas y of a height
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#1e1042'], [0.55, '#110930'], [1, '#08050f']]);
  ctx.fillRect(0, 0, w, h);
  nebula(ctx, rand, [[w * 0.12, h * 0.6, h * 0.5, '#5a2a9a', 0.3], [w * 0.88, h * 0.55, h * 0.5, '#1a5a8a', 0.28], [w * 0.5, h * 0.4, h * 0.6, '#8a2070', 0.16]]);
  stars(ctx, rand, 0, h * 0.12, w, h * 0.7, Math.round(w * h / 1100), 8, k);
  ringedPlanet(ctx, rand, w * 0.1, h * 0.7, h * 0.11, -0.3, { hi: '#d8c0ff', mid: '#7a4ad0', dark: '#1a0840', band: '#4a2a90', ring: '#c8b8ff', glow: '#8a60ff' }, 1.4);
  ringedPlanet(ctx, rand, w * 0.8, h * 0.72, h * 0.06, 0.35, { hi: '#c8f4ff', mid: '#3aa8d8', dark: '#0a2a48', band: '#1a6a9a', ring: '#a8e8ff', glow: '#40c0ff' }, 1.5);
  // neon stripes under the lockdown bar
  for (const [y, c] of [[0.075, NEON.cyan], [0.11, NEON.violet]]) stripeAlong(ctx, w, () => h * y, Math.max(2, h * 0.009), c);
  // lettering: above the coin door, under the start button, under the shooter
  label(ctx, 'INSERT COIN', w * 0.5, vy(1.05), h * 0.055, NEON.cyan);
  label(ctx, 'START', ux(-6.1), vy(-0.15), h * 0.045, NEON.yellow, 0.4);
  label(ctx, 'LAUNCH', ux(7.005), vy(-1.6), h * 0.045, NEON.pink, 0.4);
  // arrow under LAUNCH pointing at the knob
  const ax = ux(7.005), ay = vy(-2.2);
  polyFill(ctx, [[ax - 10 * k, ay], [ax + 10 * k, ay], [ax, ay - 14 * k]], rgba(NEON.pink, 0.85));
  // pinstripes at the heights of the side panels' stripes (they meet at the front corners)
  STRIPE_HEIGHTS.forEach((hh, i) => stripeAlong(ctx, w, () => h - hh * pxPerUnit, Math.max(2, h * 0.009), STRIPE_COLORS[i]));
  return canvas;
}

function paintRear(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  const k = w / 768;
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#1a1730'], [1, '#0c0b16']]);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = rgba(rand() < 0.5 ? '#ffffff' : '#000000', rr(rand, 0.015, 0.04));
    ctx.fillRect(0, rr(rand, 0, h), w, 1);
  }
  // service door
  const dx = w * 0.1, dy = h * 0.1, dw = w * 0.8, dh = h * 0.7;
  ctx.beginPath(); rrectPath(ctx, dx, dy, dw, dh, 10 * k);
  ctx.fillStyle = linear(ctx, 0, dy, 0, dy + dh, [[0, '#2a2744'], [1, '#191628']]);
  ctx.fill();
  ctx.strokeStyle = rgba('#000000', 0.7); ctx.lineWidth = 4 * k; ctx.stroke();
  ctx.strokeStyle = rgba('#ffffff', 0.12); ctx.lineWidth = 2 * k;
  ctx.beginPath(); rrectPath(ctx, dx + 4 * k, dy + 4 * k, dw - 8 * k, dh - 8 * k, 8 * k); ctx.stroke();
  // vent slots
  for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
    const sx = dx + dw * 0.1 + col * dw * 0.135, sy = dy + dh * 0.1 + row * dh * 0.075;
    ctx.beginPath(); rrectPath(ctx, sx, sy, dw * 0.11, dh * 0.035, dh * 0.017);
    ctx.fillStyle = '#05050a'; ctx.fill();
  }
  // fan behind a round grille
  const fx = dx + dw * 0.22, fy = dy + dh * 0.68, fr = Math.min(dw, dh) * 0.17;
  disc(ctx, fx, fy, fr, '#050508');
  ctx.strokeStyle = '#3a3a48'; ctx.lineWidth = 2.5 * k;
  for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(fx, fy, fr * i / 4.4, 0, TAU); ctx.stroke(); }
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; line(ctx, fx - Math.cos(a) * fr, fy - Math.sin(a) * fr, fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, 2.5 * k, '#3a3a48'); }
  ring(ctx, fx, fy, fr, 4 * k, '#6a6e7a');
  // rating plate
  const px = dx + dw * 0.52, py = dy + dh * 0.62, pw = dw * 0.4, ph = dh * 0.26;
  ctx.beginPath(); rrectPath(ctx, px, py, pw, ph, 4 * k);
  ctx.fillStyle = linear(ctx, px, py, px + pw, py + ph, [[0, '#e4e6ee'], [1, '#9a9eaa']]);
  ctx.fill();
  ctx.save();
  ctx.translate(px + pw / 2, py + ph * 0.28);
  drawLetters(ctx, 'STAR CADET', ph * 0.2, { align: 'center', tracking: 0.3, weight: 0.22, fill: '#1a1a2a' });
  ctx.translate(0, ph * 0.3);
  drawLetters(ctx, 'MODEL SC-3D', ph * 0.13, { align: 'center', tracking: 0.3, weight: 0.2, fill: '#3a3a4a' });
  ctx.translate(0, ph * 0.22);
  drawLetters(ctx, '120V 60HZ 4A', ph * 0.13, { align: 'center', tracking: 0.3, weight: 0.2, fill: '#3a3a4a' });
  ctx.restore();
  for (const [x, y] of [[dx + 14 * k, dy + 14 * k], [dx + dw - 14 * k, dy + 14 * k], [dx + 14 * k, dy + dh - 14 * k], [dx + dw - 14 * k, dy + dh - 14 * k]]) {
    disc(ctx, x, y, 5 * k, radial2(ctx, x - 1.5 * k, y - 1.5 * k, 0, x, y, 5 * k, [[0, '#d8d8e0'], [1, '#4a4a54']]));
  }
  return canvas;
}

function paintBoxSide(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#1c0e40'], [0.6, '#0e0628'], [1, '#06030e']]);
  ctx.fillRect(0, 0, w, h);
  nebula(ctx, rand, [[w * 0.5, h * 0.3, w * 0.9, '#5a2a9a', 0.3], [w * 0.4, h * 0.75, w * 0.8, '#1a5a8a', 0.22]]);
  stars(ctx, rand, 0, 0, w, h, Math.round(w * h / 1100), 5, w / 256);
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-Math.PI / 2);
  neonWord(ctx, 'STAR CADET', w * 0.28, '#eedcff', '#a868ff', { tracking: 0.28 });
  ctx.restore();
  // stripes along both long edges (the panel is used on both sides of the backbox)
  for (const [x, c] of [[0.05, NEON.cyan], [0.1, NEON.violet], [0.9, NEON.violet], [0.95, NEON.cyan]]) {
    ctx.fillStyle = rgba(c, 0.25);
    ctx.fillRect(w * x - 4, 0, 8, h);
    ctx.fillStyle = c;
    ctx.fillRect(w * x - 1.5, 0, 3, h);
  }
  return canvas;
}

// ---- backglass ---------------------------------------------------------------------------------------------------------------------
function paintBackglass(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  const k = w / 1024;
  ctx.fillStyle = radial(ctx, w * 0.5, h * 1.05, 0, h * 1.1, [[0, '#3a1470'], [0.45, '#140834'], [1, '#020108']]);
  ctx.fillRect(0, 0, w, h);
  nebula(ctx, rand, [[w * 0.2, h * 0.32, h * 0.38, '#6a2ab0', 0.35], [w * 0.82, h * 0.22, h * 0.3, '#1a7aa0', 0.3], [w * 0.58, h * 0.8, h * 0.4, '#a0207a', 0.25], [w * 0.4, h * 0.1, h * 0.25, '#2a3ac0', 0.25]]);
  stars(ctx, rand, 0, 0, w, h, Math.round(w * h / 800), 34, k);
  ringedPlanet(ctx, rand, w * 0.875, h * 0.73, h * 0.17, -0.3, { hi: '#ffd8a8', mid: '#e8682a', dark: '#3a0e06', band: '#8a2a10', ring: '#ffe4b8', glow: '#ff8a40' }, 1.25);
  moon(ctx, rand, w * 0.11, h * 0.17, h * 0.065, '#4cc070');
  moon(ctx, rand, w * 0.93, h * 0.12, h * 0.03, '#8a8cff');
  rocket(ctx, w * 0.13, h * 0.72, -0.5, h * 0.24, rand);
  ctx.save();
  ctx.translate(w * 0.5, h * 0.12);
  drawLetters(ctx, 'PINBALL', h * 0.055, { align: 'center', tracking: 0.6, weight: 0.24, fill: '#9c84ff', shadow: { color: '#241670', dx: 2 * k, dy: 2 * k }, highlight: { color: '#e0d8ff', dx: -k, dy: -k, weight: 0.3 } });
  ctx.restore();
  ctx.save();
  ctx.translate(w * 0.5, h * 0.3);
  neonWord(ctx, 'STAR', h * 0.17, '#ecdcff', '#a868ff');
  ctx.translate(0, h * 0.22);
  neonWord(ctx, 'CADET', h * 0.17, '#dcc8ff', '#a868ff');
  ctx.restore();
  // tagline on a dark band
  ctx.fillStyle = linear(ctx, 0, h * 0.86, 0, h, [[0, rgba('#000000', 0)], [0.25, rgba('#000000', 0.55)], [1, rgba('#000000', 0.6)]]);
  ctx.fillRect(0, h * 0.86, w, h * 0.14);
  const tag = 'LAUNCH  -  RE-ENTRY  -  HYPERSPACE';
  const tagSize = Math.min(h * 0.04, (w * 0.86) / textWidth(tag, 1, 0.3));   // fits inside the frame
  ctx.save();
  ctx.translate(w * 0.5, h * 0.93);
  drawLetters(ctx, tag, tagSize, { align: 'center', tracking: 0.3, weight: 0.4, fill: rgba(NEON.cyan, 0.4) });
  drawLetters(ctx, tag, tagSize, { align: 'center', tracking: 0.3, weight: 0.22, fill: '#b8fbff', shadow: { color: '#06283c', dx: k, dy: k } });
  ctx.restore();
  // backlight: hot in the middle, falling off to the corners, and a faint diagonal sheen on the glass
  ctx.fillStyle = radial(ctx, w * 0.5, h * 0.45, h * 0.2, w * 0.62, [[0, rgba('#000000', 0)], [1, rgba('#000000', 0.32)]]);
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w * 0.28, h * 0.2);
  ctx.rotate(-0.6);
  ctx.fillStyle = linear(ctx, -w * 0.08, 0, w * 0.08, 0, [[0, rgba('#ffffff', 0)], [0.5, rgba('#ffffff', 0.07)], [1, rgba('#ffffff', 0)]]);
  ctx.fillRect(-w * 0.08, -h, w * 0.16, h * 2);
  ctx.restore();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 10 * k;
  ctx.strokeRect(5 * k, 5 * k, w - 10 * k, h - 10 * k);
  ctx.strokeStyle = rgba('#c8ccd8', 0.8);
  ctx.lineWidth = 2 * k;
  ctx.strokeRect(14 * k, 14 * k, w - 28 * k, h - 28 * k);
  return canvas;
}

// ---- speaker panel -----------------------------------------------------------------------------------------------------------------
function paintSpeaker(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  const k = h / 384;
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#26262e'], [0.5, '#16161c'], [1, '#0c0c10']]);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = rgba(rand() < 0.5 ? '#ffffff' : '#000000', rr(rand, 0.02, 0.06));
    ctx.fillRect(0, rr(rand, 0, h), w, 1);
  }
  for (const cx of [w * 0.11, w * 0.89]) {
    const cy = h * 0.5, r = h * 0.26;
    glowDisc(ctx, cx, cy, r * 1.3, NEON.violet, 0.3);
    disc(ctx, cx, cy, r, '#0a0a0e');
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.96, 0, TAU);
    ctx.clip();
    const step = Math.max(4, 7 * k);
    ctx.fillStyle = '#4a4a58';
    ctx.beginPath();
    for (let y = cy - r; y <= cy + r; y += step) {
      const odd = Math.round((y - cy) / step) & 1;
      for (let x = cx - r + (odd ? step / 2 : 0); x <= cx + r; x += step) { ctx.moveTo(x + step * 0.24, y); ctx.arc(x, y, step * 0.24, 0, TAU); }
    }
    ctx.fill();
    // cone shading + highlight, dust cap
    ctx.fillStyle = radial2(ctx, cx - r * 0.35, cy - r * 0.35, 0, cx, cy, r, [[0, rgba('#ffffff', 0.14)], [0.5, rgba('#000000', 0.1)], [1, rgba('#000000', 0.55)]]);
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
    disc(ctx, cx, cy, r * 0.3, radial2(ctx, cx - r * 0.1, cy - r * 0.1, 0, cx, cy, r * 0.3, [[0, '#5a5a66'], [0.7, '#202028'], [1, '#101016']]));
    ring(ctx, cx, cy, r, 6 * k, '#a8aebc');
    ring(ctx, cx, cy, r + 6 * k, 2.5 * k, rgba(NEON.violet, 0.95));
    ring(ctx, cx, cy, r - 5 * k, 1.5 * k, rgba('#ffffff', 0.3));
  }
  // bezel of the dot-matrix display (the display itself is a separate, lit mesh: 9.6 x 2.4 units on an 18 x 6.7 panel)
  const bx = w * 0.215, by = h * 0.22, bw = w * 0.57, bh = h * 0.56;
  ctx.beginPath();
  rrectPath(ctx, bx, by, bw, bh, 12 * k);
  ctx.fillStyle = '#030304';
  ctx.fill();
  ctx.strokeStyle = '#6a6e7a';
  ctx.lineWidth = 4 * k;
  ctx.stroke();
  for (const [x, y] of [[0.02, 0.08], [0.98, 0.08], [0.02, 0.92], [0.98, 0.92]]) {
    disc(ctx, w * x, h * y, 6 * k, radial2(ctx, w * x - 2 * k, h * y - 2 * k, 0, w * x, h * y, 6 * k, [[0, '#e0e0e8'], [1, '#50525a']]));
    line(ctx, w * x - 4 * k, h * y, w * x + 4 * k, h * y, 1.5 * k, '#303038');
  }
  return canvas;
}

// ---- coin door ---------------------------------------------------------------------------------------------------------------------
function paintCoinDoor(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  const k = w / 1024;
  ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#6e727e'], [0.5, '#464a54'], [1, '#2a2c34']]);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = rgba(rand() < 0.5 ? '#ffffff' : '#000000', rr(rand, 0.02, 0.06));
    ctx.fillRect(0, rr(rand, 0, h), w, 1.5 * k);
  }
  const t = 26 * k;
  ctx.fillStyle = rgba('#ffffff', 0.2); ctx.fillRect(0, 0, w, t); ctx.fillRect(0, 0, t, h);
  ctx.fillStyle = rgba('#000000', 0.4); ctx.fillRect(0, h - t, w, t); ctx.fillRect(w - t, 0, t, h);
  ctx.strokeStyle = rgba('#000000', 0.6); ctx.lineWidth = 3 * k; ctx.strokeRect(t + 10 * k, t + 10 * k, w - 2 * t - 20 * k, h - 2 * t - 20 * k);
  for (const cx of [w * 0.29, w * 0.71]) {
    const pw = w * 0.27, ph = h * 0.42, px = cx - pw / 2, py = h * 0.09;
    ctx.beginPath(); rrectPath(ctx, px, py, pw, ph, 14 * k);
    ctx.fillStyle = linear(ctx, px, py, px + pw, py + ph, [[0, '#f4f6fc'], [0.5, '#aeb2be'], [1, '#6a6e7a']]);
    ctx.fill();
    ctx.strokeStyle = '#2a2c34'; ctx.lineWidth = 3 * k; ctx.stroke();
    // price insert: deep red, lit from behind
    const ix = px + pw * 0.14, iy = py + ph * 0.1, iw = pw * 0.72, ih = ph * 0.42;
    ctx.beginPath(); rrectPath(ctx, ix, iy, iw, ih, 10 * k);
    ctx.fillStyle = linear(ctx, 0, iy, 0, iy + ih, [[0, '#d0180e'], [0.55, '#a00c08'], [1, '#6a0505']]);
    ctx.fill();
    ctx.fillStyle = radial(ctx, cx, iy + ih * 0.5, 0, iw * 0.55, [[0, rgba('#ff7050', 0.55)], [1, rgba('#ff7050', 0)]]);
    ctx.fill();
    ctx.save(); ctx.translate(cx, iy + ih * 0.53);
    drawLetters(ctx, '25', ih * 0.58, { align: 'center', tracking: 0.25, weight: 0.26, fill: '#fff6ea', outline: { color: '#4a0303', width: 2 * k }, shadow: { color: '#3a0202', dx: 2 * k, dy: 2 * k } });
    ctx.restore();
    ctx.fillStyle = '#08080a';
    ctx.fillRect(cx - 6 * k, py + ph * 0.6, 12 * k, ph * 0.3);
    ctx.strokeStyle = rgba('#ffffff', 0.45); ctx.lineWidth = 2 * k; ctx.strokeRect(cx - 8 * k, py + ph * 0.6 - 2 * k, 16 * k, ph * 0.3 + 4 * k);
  }
  const lx = w * 0.5, ly = h * 0.6;
  disc(ctx, lx, ly, 28 * k, radial2(ctx, lx - 8 * k, ly - 8 * k, 0, lx, ly, 28 * k, [[0, '#f8f8fc'], [0.6, '#9a9ea8'], [1, '#4a4c54']]));
  ctx.fillStyle = '#18181c'; ctx.fillRect(lx - 4 * k, ly - 14 * k, 8 * k, 28 * k);
  // coin returns: metal flaps with a highlight
  for (const cx of [w * 0.29, w * 0.71]) {
    const rw = w * 0.2, rh = h * 0.16, rx = cx - rw / 2, ry = h * 0.7;
    ctx.beginPath(); rrectPath(ctx, rx, ry, rw, rh, 10 * k);
    ctx.fillStyle = '#121216'; ctx.fill();
    ctx.strokeStyle = '#9a9ea8'; ctx.lineWidth = 5 * k; ctx.stroke();
    const fx = rx + 10 * k, fy = ry + 10 * k, fw = rw - 20 * k, fh = rh * 0.55;
    ctx.beginPath(); rrectPath(ctx, fx, fy, fw, fh, 6 * k);
    ctx.fillStyle = linear(ctx, 0, fy, 0, fy + fh, [[0, '#d8dce6'], [0.4, '#8a8e9a'], [1, '#4a4c56']]);
    ctx.fill();
    line(ctx, fx + 8 * k, fy + 5 * k, fx + fw - 8 * k, fy + 5 * k, 2 * k, rgba('#ffffff', 0.7));
  }
  for (const [x, y] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) disc(ctx, w * x, h * y, 8 * k, '#c8ccd4');
  return canvas;
}

// ---- floor -----------------------------------------------------------------------------------------------------------------------------
function paintCarpet(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  const k = w / 512;
  ctx.fillStyle = '#07060d';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 60; i++) {
    ctx.fillStyle = rgba(rand() < 0.5 ? '#2a2440' : '#000000', rr(rand, 0.2, 0.5));
    ctx.fillRect(Math.floor(rr(rand, 0, w)), Math.floor(rr(rand, 0, h)), 1, 1);
  }
  const cols = [NEON.pink, NEON.cyan, NEON.yellow, NEON.violet, NEON.green, NEON.orange];
  const shapes = [];
  for (let i = 0; i < 30; i++) shapes.push({ kind: ri(rand, 0, 4), x: rr(rand, 0, w), y: rr(rand, 0, h), s: rr(rand, 10, 26) * k, a: rr(rand, 0, TAU), c: cols[ri(rand, 0, cols.length - 1)] });
  const drawShape = (sh, ox, oy) => {
    const x = sh.x + ox, y = sh.y + oy, s = sh.s;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(sh.a);
    ctx.strokeStyle = rgba(sh.c, 0.8); ctx.fillStyle = rgba(sh.c, 0.8); ctx.lineWidth = 3 * k;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (sh.kind === 0) {
      ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, s * 1.2, s * 0.32, 0, 0, TAU); ctx.stroke();
    } else if (sh.kind === 1) {
      ctx.beginPath(); starPath(ctx, 0, 0, s * 0.8, s * 0.35, 5); ctx.fill();
    } else if (sh.kind === 2) {
      ctx.beginPath(); smoothOpenPath(ctx, [[-s * 1.4, 0], [-s * 0.7, -s * 0.5], [0, 0], [s * 0.7, s * 0.5], [s * 1.4, 0]]); ctx.stroke();
    } else if (sh.kind === 3) {
      ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(s * 0.7, s * 0.5); ctx.lineTo(-s * 0.7, s * 0.5); ctx.closePath(); ctx.stroke();
    } else {
      for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc((j - 1.5) * s * 0.45, Math.sin(j) * s * 0.3, s * 0.13, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  };
  for (const sh of shapes) for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    if (sh.x + ox < -60 * k || sh.x + ox > w + 60 * k || sh.y + oy < -60 * k || sh.y + oy > h + 60 * k) continue;
    drawShape(sh, ox, oy);
  }
  return canvas;
}

/** Tileable low-frequency blotches: black with soft alpha (RENDER lays it over the carpet so its repeat does not show). */
function paintMottle(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 22; i++) {
    const x = rr(rand, 0, w), y = rr(rand, 0, h), r = rr(rand, w * 0.12, w * 0.3), a = rr(rand, 0.25, 0.6);
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
      glowDisc(ctx, x + ox, y + oy, r, '#000000', a);
    }
  }
  return canvas;
}

// ---- inner walls above the playfield (tileable along u) -----------------------------------------------------------------------------
function paintInside(createCanvas, rand, size) {
  const { canvas, ctx, w, h } = make(createCanvas, size);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#262048'], [0.55, '#15122e'], [1, '#0b0a1a']]);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 500; i++) {
    ctx.fillStyle = rgba('#ffffff', rr(rand, 0.15, 0.6));
    ctx.fillRect(Math.floor(rr(rand, 0, w)), Math.floor(rr(rand, h * 0.3, h)), 1, 1);
  }
  ctx.fillStyle = rgba('#8c6cf0', 0.3);
  ctx.fillRect(0, h * 0.18 - 3, w, 6);
  ctx.fillStyle = '#8c6cf0';
  ctx.fillRect(0, h * 0.18 - 1, w, 2);
  ctx.fillStyle = rgba(NEON.cyan, 0.5);
  ctx.fillRect(0, h * 0.24, w, 1);
  return canvas;
}

/**
 * @param {import('../../types.js').DataModule} data
 * @param {(w:number,h:number)=>any} createCanvas
 * @param {import('../../types.js').Rand01} rand
 * @param {'high'|'normal'|'low'} [quality='normal']
 * @returns {Record<string, any>} the canvases of CABINET_KEYS
 */
export function paintCabinet(data, createCanvas, rand, quality = 'normal') {
  const S = CABINET_SIZES[quality] || CABINET_SIZES.normal;
  // every texture gets its own random stream (derived from `rand` once), so changing one painter never shifts another
  const seeds = {};
  for (const key of CABINET_KEYS) seeds[key] = Math.floor(rand() * 0x7fffffff) >>> 0;
  const sub = (key) => mulberry32(seeds[key]);
  return {
    sideL: paintSide(createCanvas, sub('sideL'), S.sideL, false),
    sideR: paintSide(createCanvas, sub('sideL'), S.sideR, true),        // same stream: the same stars and clouds, mirrored geometry
    front: paintFront(createCanvas, sub('front'), S.front),
    rear: paintRear(createCanvas, sub('rear'), S.rear),
    boxRear: paintRear(createCanvas, sub('boxRear'), S.boxRear),
    boxSide: paintBoxSide(createCanvas, sub('boxSide'), S.boxSide),
    backglass: paintBackglass(createCanvas, sub('backglass'), S.backglass),
    speaker: paintSpeaker(createCanvas, sub('speaker'), S.speaker),
    coinDoor: paintCoinDoor(createCanvas, sub('coinDoor'), S.coinDoor),
    carpet: paintCarpet(createCanvas, sub('carpet'), S.carpet),
    mottle: paintMottle(createCanvas, sub('mottle'), S.mottle),
    inside: paintInside(createCanvas, sub('inside'), S.inside),
  };
}
