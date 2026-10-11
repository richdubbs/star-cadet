/**
 * src/render/art/decals.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2 (floor content); SPEC 6.8 (look of the table), ui.md L5 (painted-art inventory A1-A28)
 * The painted playfield decals of ArtPack.floor, all drawn in T-frame units (the caller installed tableSpace().enter()):
 * central emblem (gravity-well disc + rank rings area), copper plunger lane / orbit / hyperspace chute, inlane slopes, the spiked star under
 * the flippers, red rocket, red patch + starfighter, asteroids, blue-X streaks, pits of kickouts/sinks/black hole, drop-target housings, bumper
 * bases (phase "under"), then aprons, slingshot triangles, slot plates (phase "over", painted on top of the baked wall shadows).
 * ORIGINAL artwork: nothing here is a copy of the game's bitmaps; shapes follow the composition notes of SPEC 6.8 only.
 */
import {
  TAU, rr, rgba, linear, radial, radial2, glowDisc, disc, ring, line, polyFill, polyStroke, polyPath, smoothClosedPath, resample, centroid, pointInPoly,
} from './draw.js';
import { drawLetters, screenAt } from './font.js';
import { PALETTE } from './palette.js';

/** Centre of the central emblem (SPEC 6.8 / App. A ring parametrisation: outer ring centre (0.007, 6.039)). */
export const EMBLEM = Object.freeze({ x: 0.01, y: 6.035 });

/** Hand-placed centre lines of the copper lanes (T-frame), verified against the wall geometry (see tests). */
export const LANES = Object.freeze({
  orbit: Object.freeze({
    width: 0.92,
    pts: [[-7.02, 13.3], [-7.02, 4.8], [-7.0, -3.0], [-6.95, -5.3], [-6.85, -6.4], [-6.55, -7.5], [-5.95, -8.7], [-5.38, -9.5], [-4.6, -10.3], [-3.8, -10.95]],
  }),
  hyperspace: Object.freeze({
    width: 0.74,
    pts: [[-5.3, -3.6], [-5.4, -4.5], [-5.45, -5.6], [-5.3, -6.5], [-5.0, -7.3], [-4.55, -8.1], [-4.0, -8.8], [-3.5, -9.3]],
  }),
  fuel: Object.freeze({
    width: 0.9,
    pts: [[6.95, -2.3], [7.0, -3.4], [7.0, -4.7], [6.95, -5.8]],
  }),
});

const mirrorPts = (pts) => pts.map(([x, y]) => [-x, y]);

// ------------------------------------------------------------------------------------------------------------------------------------
// helpers
function wavyClosed(ctx, pts, amp, rand, stepLen = 0.2) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(d / stepLen));
    const nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const o = k === 0 ? 0 : amp * Math.sin(k * 2.1 + i) * (0.55 + 0.45 * rand());
      out.push([a[0] + (b[0] - a[0]) * t + nx * o, a[1] + (b[1] - a[1]) * t + ny * o]);
    }
  }
  ctx.beginPath();
  polyPath(ctx, out, true);
  return out;
}

function mottle(ctx, rand, cx, cy, radius, colors, count, size) {
  for (let i = 0; i < count; i++) {
    const a = rr(rand, 0, TAU), d = Math.sqrt(rand()) * radius;
    disc(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr(rand, size * 0.4, size), rgba(colors[i % colors.length], rr(rand, 0.18, 0.42)));
  }
}

/** Polygon scaled about its vertex centroid. */
export function scalePoly(pts, f) {
  const c = centroid(pts);
  return pts.map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f]);
}

function local(ctx, x, y, ang, fn) {
  ctx.save();
  ctx.translate(x, y);
  if (ang) ctx.rotate(ang);
  fn();
  ctx.restore();
}

// ------------------------------------------------------------------------------------------------------------------------------------
function paintEmblem(ctx, rand) {
  const { x: cx, y: cy } = EMBLEM;
  glowDisc(ctx, cx, cy, 4.4, '#2a6f9a', 0.26);
  // outer teal-grey web zone r 2.8..3.5
  disc(ctx, cx, cy, 3.5, radial(ctx, cx, cy, 2.4, 3.5, [[0, '#161f45'], [0.7, '#20295a'], [0.92, '#2b3566'], [1, '#141b3c']]));
  ring(ctx, cx, cy, 3.44, 0.05, rgba(PALETTE.vein, 0.9));
  ring(ctx, cx, cy, 3.14, 0.03, rgba(PALETTE.webTeal, 0.95));
  ring(ctx, cx, cy, 2.86, 0.045, rgba(PALETTE.vein, 0.85));
  ctx.lineCap = 'round';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU;
    const r0 = 3.2, r1 = i % 4 === 0 ? 3.37 : i % 2 === 0 ? 3.31 : 3.27;
    line(ctx, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 0.016, rgba(PALETTE.vein, 0.7));
  }
  // dark-blue lamp zone r 2.2..2.8 (outer ring lamps sit at r 2.5)
  ring(ctx, cx, cy, 2.5, 0.6, '#0b1342');
  ring(ctx, cx, cy, 2.8, 0.03, rgba('#2f55b8', 0.8));
  ring(ctx, cx, cy, 2.2, 0.03, rgba('#2f55b8', 0.8));
  // brown-grey rim r 1.38..2.14 (middle ring lamps sit at r 1.656)
  disc(ctx, cx, cy, 2.14, radial(ctx, cx, cy, 1.3, 2.14, [[0, '#3b2019'], [0.6, '#34201a'], [0.85, PALETTE.rimBrown], [1, '#1b0d0b']]));
  ring(ctx, cx, cy, 2.12, 0.03, rgba('#7a5a50', 0.6));
  ring(ctx, cx, cy, 1.41, 0.04, rgba('#8a6a60', 0.55));
  // cyan glow disc r 1.32 with dark crack veins
  disc(ctx, cx, cy, 1.32, radial2(ctx, cx - 0.25, cy - 0.3, 0.05, cx, cy, 1.32,
    [[0, '#c8f8ff'], [0.25, '#76d0e4'], [0.65, PALETTE.ringCyan], [1, '#1d5675']]));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 1.31, 0, TAU);
  ctx.clip();
  ctx.strokeStyle = rgba('#0d3550', 0.7);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + rr(rand, -0.12, 0.12);
    let x = cx + Math.cos(a) * 0.4, y = cy + Math.sin(a) * 0.4, ca = a;
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      ca += rr(rand, -0.45, 0.45);
      x += Math.cos(ca) * 0.2;
      y += Math.sin(ca) * 0.2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = rgba('#e0ffff', 0.38);
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  ctx.arc(cx, cy, 1.12, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  // dark-red centre dot (the kickout hole) r 0.3 at (0, 6)
  disc(ctx, 0, 6, 0.43, 'rgba(15,3,3,0.85)');
  disc(ctx, 0, 6, 0.32, radial2(ctx, -0.08, 5.92, 0.02, 0, 6, 0.32, [[0, '#b02a24'], [0.6, PALETTE.gravityDot], [1, '#4a0a0a']]));
}

// ------------------------------------------------------------------------------------------------------------------------------------
function laneDirs(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  });
}

function copperLane(ctx, lane, opts = {}) {
  const { pts, width } = lane;
  const dark = opts.dark === true;
  polyStroke(ctx, pts, width + 0.27, '#7a1614');
  polyStroke(ctx, pts, width + 0.17, '#8f939c');
  polyStroke(ctx, pts, width + 0.06, '#34201a');
  polyStroke(ctx, pts, width, dark ? '#5a3a2e' : PALETTE.copper);
  polyStroke(ctx, pts, width * 0.78, dark ? '#432a22' : PALETTE.copperDark);
  polyStroke(ctx, pts, width * 0.2, rgba(PALETTE.copperLight, dark ? 0.55 : 0.8));
  polyStroke(ctx, pts, width * 0.05, rgba('#f0d09a', 0.45));
  // olive-yellow and blue rectangular light segments across the lane
  const fine = resample(pts, Math.max(4, Math.round(lanePathLength(pts) / 0.75)));
  const dirs = laneDirs(fine);
  fine.forEach((p, i) => {
    if (i === 0 || i === fine.length - 1) return;
    local(ctx, p[0], p[1], dirs[i], () => {
      ctx.fillStyle = rgba(i % 2 === 0 ? '#8a8818' : '#243aa8', 0.8);
      ctx.fillRect(-0.09, -width * 0.36, 0.18, width * 0.72);
      ctx.strokeStyle = rgba('#000000', 0.45);
      ctx.lineWidth = 0.014;
      ctx.strokeRect(-0.09, -width * 0.36, 0.18, width * 0.72);
    });
  });
}

function lanePathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

function paintLanes(ctx) {
  copperLane(ctx, LANES.orbit);
  copperLane(ctx, LANES.fuel, { dark: true });
  copperLane(ctx, LANES.hyperspace, { dark: true });
  // hyperspace chute: three red-outlined windows between the bars
  const dirs = laneDirs(LANES.hyperspace.pts);
  for (const i of [2, 4, 6]) {
    const p = LANES.hyperspace.pts[i];
    local(ctx, p[0], p[1], dirs[i], () => {
      ctx.fillStyle = 'rgba(8,9,20,0.9)';
      ctx.fillRect(-0.22, -0.2, 0.44, 0.4);
      ctx.strokeStyle = rgba(PALETTE.railRed, 0.9);
      ctx.lineWidth = 0.03;
      ctx.strokeRect(-0.22, -0.2, 0.44, 0.4);
    });
  }
  // hazard-stripe band across the launch lane just below the one-way gate (the "launch tube" entrance)
  hazardBand(ctx, -7.52, 5.0, 1.02, 0.4, -Math.PI / 4);
}

/** Yellow/black diagonal hazard band, clipped to the rectangle x0..x0+w (T-frame x increases to the screen LEFT) y0..y0+h. */
function hazardBand(ctx, x0, y0, w, h, ang) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.fillStyle = PALETTE.hazardBlack;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = PALETTE.hazardYellow;
  ctx.lineWidth = 0.17;
  ctx.lineCap = 'butt';
  const c = Math.cos(ang), s = Math.sin(ang);
  const span = w + h;
  ctx.beginPath();
  for (let k = -span; k < span * 1.2; k += 0.34) {
    const px = x0 + k, py = y0;
    ctx.moveTo(px - c * span, py - s * span);
    ctx.lineTo(px + c * span, py + s * span);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = rgba('#000000', 0.7);
  ctx.lineWidth = 0.03;
  ctx.strokeRect(x0, y0, w, h);
}

// ------------------------------------------------------------------------------------------------------------------------------------
const INLANE_L = [[4.33, 8.0], [5.24, 8.0], [5.24, 8.45], [6.33, 9.04], [2.57, 11.7], [2.7, 10.9], [2.9, 10.36], [4.2, 9.5], [4.33, 9.3]];
const INLANE_R = mirrorPts([[4.33, 8.0], [5.22, 8.0], [5.22, 9.71], [5.37, 9.67], [2.5, 11.72], [2.7, 10.9], [2.9, 10.36], [4.2, 9.5], [4.33, 9.3]]);

function paintInlane(ctx, rand, poly, wire, comet, ship) {
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, poly, true);
  ctx.fillStyle = linear(ctx, poly[0][0], poly[0][1], poly[4][0], poly[4][1], [[0, '#a56e4a'], [0.5, '#8a5a40'], [1, '#6a4030']]);
  ctx.fill();
  ctx.clip();
  // brushed streaks
  ctx.strokeStyle = rgba('#d8a878', 0.14);
  ctx.lineWidth = 0.015;
  ctx.beginPath();
  for (let i = 0; i < 26; i++) {
    const k = rr(rand, 0, 1);
    ctx.moveTo(poly[0][0] + (poly[4][0] - poly[0][0]) * k + 1.2, poly[0][1] + (poly[4][1] - poly[0][1]) * k - 1.2);
    ctx.lineTo(poly[0][0] + (poly[4][0] - poly[0][0]) * k - 1.2, poly[0][1] + (poly[4][1] - poly[0][1]) * k + 1.2);
  }
  ctx.stroke();
  ctx.restore();
  polyFill(ctx, poly, null, rgba(PALETTE.railRed, 0.85), 0.07);
  // teal wire inlay
  polyStroke(ctx, wire, 0.07, rgba('#0e2c34', 0.8));
  polyStroke(ctx, wire, 0.035, rgba('#44b0b8', 0.9));
  wire.forEach((p) => disc(ctx, p[0], p[1], 0.05, '#7ad6d6'));
  // comet: grey head, green -> olive -> red tail
  const [hx, hy] = comet.head, [tx, ty] = comet.tail;
  polyStroke(ctx, [[hx, hy], [tx, ty]], 0.2, linear(ctx, hx, hy, tx, ty, [[0, rgba('#5fd070', 0.95)], [0.5, rgba('#a0a030', 0.7)], [1, rgba('#b03020', 0)]]), 'round');
  disc(ctx, hx, hy, 0.12, radial(ctx, hx - 0.03, hy - 0.03, 0, 0.12, [[0, '#e0e2e8'], [1, '#7a7e88']]));
  // ship silhouette
  local(ctx, ship.x, ship.y, ship.a, () => {
    const pts = [[0.3, 0], [-0.2, 0.2], [-0.1, 0], [-0.2, -0.2]];
    polyFill(ctx, pts, '#8a8e98', rgba(PALETTE.outlineBlue, 0.9), 0.025);
    line(ctx, -0.02, 0, 0.16, 0, 0.03, '#5a3a8a');
  });
}

function paintInlanes(ctx, rand) {
  paintInlane(ctx, rand, INLANE_L, [[4.85, 8.6], [4.7, 9.4], [3.7, 10.35], [3.0, 11.0]],
    { head: [3.65, 10.63], tail: [4.5, 9.6] }, { x: 4.9, y: 9.35, a: 2.1 });
  paintInlane(ctx, rand, INLANE_R, [[-4.85, 8.6], [-4.7, 9.4], [-3.7, 10.35], [-3.0, 11.0]],
    { head: [-3.26, 10.72], tail: [-4.1, 9.7] }, { x: -4.9, y: 9.35, a: 1.05 });
}

// ------------------------------------------------------------------------------------------------------------------------------------
const STAR_HALF = [
  [0, 10.1], [0.38, 10.95], [0.78, 10.35], [1.12, 11.05], [1.5, 8.5], [2.0, 10.9], [3.4, 11.2], [5.4, 12.4], [6.2, 13.1], [6.0, 13.8],
  [3.0, 13.9], [1.2, 14.2], [0, 14.3],
];

function paintStar(ctx, px) {
  // full outline: right half (T +x), then the mirrored left half back to the top
  const full = [];
  for (const p of STAR_HALF) full.push(p);
  for (let i = STAR_HALF.length - 2; i >= 1; i--) full.push([-STAR_HALF[i][0], STAR_HALF[i][1]]);
  ctx.save();
  ctx.shadowColor = 'rgba(5,4,20,0.75)';
  ctx.shadowBlur = 0.3 * px;
  ctx.beginPath();
  polyPath(ctx, full, true);
  ctx.fillStyle = PALETTE.spikeViolet2;
  ctx.fill();
  ctx.restore();
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, full, true);
  ctx.clip();
  ctx.fillStyle = radial(ctx, 0, 12.2, 0.2, 5.4, [[0, '#8a72a8'], [0.45, PALETTE.spikeViolet], [1, '#4e3470']]);
  ctx.fillRect(-7, 8, 14, 7);
  // faceted spikes: each spike is split along its axis into a lit and a shaded half
  const facet = (tip, bl, br, lit, shade) => {
    const mid = [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2];
    polyFill(ctx, [tip, bl, mid], lit);
    polyFill(ctx, [tip, mid, br], shade);
  };
  for (const sg of [1, -1]) {
    // tall pale spike (tip +-1.5, 8.5)
    facet([sg * 1.5, 8.5], [sg * 2.05, 11.0], [sg * 1.1, 11.1], sg > 0 ? '#c4b0dc' : '#a690c4', sg > 0 ? '#8e76ac' : '#a690c4');
    // small blue-violet side spike
    facet([sg * 0.78, 10.35], [sg * 1.12, 11.1], [sg * 0.38, 11.0], sg > 0 ? '#7a62d0' : '#5941ad', '#4a34a0');
  }
  facet([0, 10.1], [0.4, 11.0], [-0.4, 11.0], '#7a62d0', '#4a34a0');
  // dark recess around the olive centre lamp (lite1) and the post hole
  ctx.fillStyle = radial(ctx, 0, 12.7, 0.1, 1.5, [[0, rgba('#1c0c2c', 0.85)], [1, rgba('#1c0c2c', 0)]]);
  ctx.fillRect(-2, 11, 4, 3);
  ctx.restore();
  ctx.lineJoin = 'round';
  polyFill(ctx, full, null, PALETTE.starOutline, 0.09);
  polyFill(ctx, full, null, rgba('#b8a0d8', 0.3), 0.02);
  for (const sg of [1, -1]) {
    line(ctx, sg * 3.2, 11.45, sg * 5.6, 12.75, 0.03, rgba('#2a1038', 0.5));
    line(ctx, sg * 3.1, 12.5, sg * 5.0, 13.3, 0.025, rgba('#d0b8f0', 0.25));
  }
  // black post hole below the centre lamp (0, 13.2)
  disc(ctx, 0, 13.25, 0.32, 'rgba(4,2,10,0.9)');
  ring(ctx, 0, 13.25, 0.36, 0.04, rgba('#b8a0d8', 0.4));
}

// ------------------------------------------------------------------------------------------------------------------------------------
function paintRocket(ctx, rand, px) {
  const tail = [-1.33, 1.31], nose = [-4.8, -2.3];
  const L = Math.hypot(nose[0] - tail[0], nose[1] - tail[1]);
  const a = Math.atan2(nose[1] - tail[1], nose[0] - tail[0]);
  const W = 0.8;
  const body = [[0, 0.42], [0.14, 0], [0, -0.42], [0.66, -0.4], [0.66, -1.0], [1.0, 0], [0.66, 1.0], [0.66, 0.4]].map(([u, v]) => [u * L, v * W]);
  local(ctx, tail[0], tail[1], a, () => {
    ctx.save();
    ctx.shadowColor = 'rgba(3,4,15,0.7)';
    ctx.shadowBlur = 0.25 * px;
    ctx.beginPath();
    polyPath(ctx, body, true);
    ctx.fillStyle = PALETTE.rocketRed;
    ctx.fill();
    ctx.restore();
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.beginPath();
    polyPath(ctx, body, true);
    ctx.clip();
    ctx.fillStyle = linear(ctx, 0, -W, 0, W, [[0, '#7e1c1a'], [0.5, '#b2322a'], [1, '#6e1614']]);
    ctx.fillRect(0, -W, L, 2 * W);
    mottle(ctx, rand, L * 0.5, 0, L * 0.5, ['#c25a4a', '#5a1010', '#d88a7a'], 40, 0.22);
    ctx.restore();
    // dark-blue triangle lamps' static art along the axis
    for (const u of [0.26, 0.43, 0.6]) {
      polyFill(ctx, [[(u + 0.05) * L, 0], [(u - 0.04) * L, 0.16], [(u - 0.04) * L, -0.16]], '#0a1570', rgba('#000000', 0.5), 0.02);
    }
    wavyClosed(ctx, body, 0.035, rand);
    ctx.strokeStyle = rgba('#9fd8ff', 0.5);
    ctx.lineWidth = 0.1;
    ctx.stroke();
    ctx.strokeStyle = rgba(PALETTE.outlineBlue, 1);
    ctx.lineWidth = 0.045;
    ctx.stroke();
  });
}

function paintPatchAndFighter(ctx, rand, px) {
  // red mottled patch
  const cx = 1.3, cy = -0.85;
  const blob = [];
  for (let i = 0; i < 11; i++) {
    const t = (i / 11) * TAU;
    const r = rr(rand, 0.72, 1.05);
    blob.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r * 0.95]);
  }
  ctx.save();
  ctx.shadowColor = 'rgba(3,4,15,0.7)';
  ctx.shadowBlur = 0.25 * px;
  ctx.beginPath();
  smoothClosedPath(ctx, blob);
  ctx.fillStyle = '#9e2923';
  ctx.fill();
  ctx.restore();
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.beginPath();
  smoothClosedPath(ctx, blob);
  ctx.clip();
  mottle(ctx, rand, cx, cy, 1.1, [PALETTE.patchRed, '#7a1a16', '#c4584a', PALETTE.rocketRed], 60, 0.24);
  ctx.restore();
  ctx.beginPath();
  smoothClosedPath(ctx, blob);
  ctx.strokeStyle = rgba(PALETTE.outlineBlue, 0.95);
  ctx.lineWidth = 0.05;
  ctx.stroke();
  // two green beams from the fighter to the patch
  const fx = 3.08, fy = -4.67;
  const dx = cx - fx, dy = cy - fy, dl = Math.hypot(dx, dy);
  const nx = -dy / dl, ny = dx / dl;
  for (const o of [-0.16, 0.16]) {
    polyStroke(ctx, [[fx + dx * 0.12 + nx * o, fy + dy * 0.12 + ny * o], [cx - dx * 0.07 + nx * o * 0.5, cy - dy * 0.07 + ny * o * 0.5]], 0.09, rgba('#38e068', 0.25));
    polyStroke(ctx, [[fx + dx * 0.12 + nx * o, fy + dy * 0.12 + ny * o], [cx - dx * 0.07 + nx * o * 0.5, cy - dy * 0.07 + ny * o * 0.5]], 0.028, rgba('#9dffb8', 0.9));
  }
  // grey delta-wing starfighter pointing at the patch
  const ang = Math.atan2(dy, dx);
  local(ctx, fx, fy, ang, () => {
    const hull = [[0.62, 0], [0.1, 0.18], [-0.34, 0.55], [-0.28, 0.1], [-0.4, 0], [-0.28, -0.1], [-0.34, -0.55], [0.1, -0.18]];
    ctx.save();
    ctx.shadowColor = 'rgba(2,3,12,0.8)';
    ctx.shadowBlur = 0.12 * px;
    polyFill(ctx, hull, '#9a9ea8');
    ctx.restore();
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    polyFill(ctx, [[0.52, 0], [0.1, 0.12], [-0.2, 0], [0.1, -0.12]], '#c8ccd6');
    polyFill(ctx, [[-0.3, 0.5], [-0.12, 0.16], [-0.26, 0.12]], rgba('#6a3aaa', 0.9));
    polyFill(ctx, [[-0.3, -0.5], [-0.12, -0.16], [-0.26, -0.12]], rgba('#6a3aaa', 0.9));
    polyFill(ctx, hull, null, rgba(PALETTE.outlineBlue, 0.95), 0.025);
    disc(ctx, 0.12, 0, 0.05, '#2a6a9a');
  });
}

function paintAsteroids(ctx, rand, px) {
  const cx = -2.1, cy = -3.2;
  const rocks = [[0, 0, 0.62], [-0.85, 0.45, 0.42], [0.7, 0.55, 0.38], [-0.55, -0.7, 0.34], [0.55, -0.62, 0.28]];
  rocks.forEach(([dx, dy, r], idx) => {
    const x = cx + dx, y = cy + dy;
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * TAU;
      pts.push([x + Math.cos(t) * r * rr(rand, 0.82, 1.06), y + Math.sin(t) * r * rr(rand, 0.82, 1.06)]);
    }
    ctx.save();
    ctx.shadowColor = 'rgba(2,3,12,0.75)';
    ctx.shadowBlur = 0.18 * px;
    ctx.beginPath();
    smoothClosedPath(ctx, pts);
    ctx.fillStyle = PALETTE.rockGrey;
    ctx.fill();
    ctx.restore();
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.beginPath();
    smoothClosedPath(ctx, pts);
    ctx.clip();
    disc(ctx, x - r * 0.3, y - r * 0.35, r * 0.95, radial(ctx, x - r * 0.3, y - r * 0.35, 0, r * 0.95, [[0, rgba('#a8a6a2', 0.8)], [1, rgba('#1a1a1c', 0.1)]]));
    for (let k = 0; k < 4; k++) {
      const a = rr(rand, 0, TAU), d = rr(rand, 0, r * 0.65), cr = rr(rand, 0.06, 0.13) * (r / 0.6 + 0.4);
      disc(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, cr, rgba('#2c2b2a', 0.55));
      ring(ctx, x + Math.cos(a) * d - cr * 0.18, y + Math.sin(a) * d - cr * 0.18, cr, 0.015, rgba('#c8c6c2', 0.35));
    }
    ctx.restore();
    ctx.beginPath();
    smoothClosedPath(ctx, pts);
    ctx.strokeStyle = rgba(PALETTE.outlineBlue, 0.85);
    ctx.lineWidth = 0.035;
    ctx.stroke();
    if (idx === 1 || idx === 2) disc(ctx, x + 0.04, y + 0.06, 0.09, '#0c1c8a');
  });
}

function paintBlueXStreaks(ctx) {
  const streak = (x0, y0, x1, y1, w) => {
    polyStroke(ctx, [[x0, y0], [x1, y1]], w * 3, linear(ctx, x0, y0, x1, y1, [[0, rgba('#6a50e0', 0.28)], [1, rgba('#6a50e0', 0)]]));
    polyStroke(ctx, [[x0, y0], [x1, y1]], w, linear(ctx, x0, y0, x1, y1, [[0, rgba('#bca8ff', 0.7)], [1, rgba('#bca8ff', 0)]]));
  };
  streak(3.72, 5.94, 2.85, 10.4, 0.035);
  streak(-0.7, 3.4, -3.35, 8.7, 0.03);
}

// ------------------------------------------------------------------------------------------------------------------------------------
/** Dark hole with a coloured / steel rim (kickouts, sinks, black hole, ramp hole). */
export function paintPit(ctx, x, y, r, rimColor, glow) {
  if (glow) glowDisc(ctx, x, y, r * 2.3, glow, 0.35);
  disc(ctx, x, y, r * 1.22, 'rgba(8,8,16,0.9)');
  disc(ctx, x, y, r, radial(ctx, x, y, 0, r, [[0, '#000000'], [0.7, '#05060c'], [1, '#14162a']]));
  ring(ctx, x, y, r * 1.12, r * 0.22, rimColor);
  ring(ctx, x - r * 0.06, y - r * 0.06, r * 1.2, r * 0.05, rgba('#ffffff', 0.35));
}

function paintPits(ctx, data) {
  const k2 = data.KICKOUTS.find((k) => k.name === 'a_kout2');
  const k3 = data.KICKOUTS.find((k) => k.name === 'a_kout3');
  if (k2) paintPit(ctx, k2.c[0], k2.c[1], 0.42, '#7a86b8', '#3a6aff');
  if (k3) paintPit(ctx, k3.c[0], k3.c[1], 0.42, '#b4b8c4', null);
  const colors = { red: '#c0302a', green: '#2aa040', yellow: '#c8b828' };
  for (const s of data.SINKS) {
    const mx = (s.line[0][0] + s.line[1][0]) / 2, my = (s.line[0][1] + s.line[1][1]) / 2;
    if (s.color) paintPit(ctx, mx, my, 0.4, colors[s.color], colors[s.color]);
    else paintPit(ctx, mx, my, 0.36, '#7c8090', null);
  }
  // the hidden-tube mouth at the bottom of the right orbit: dark arch with a hazard lip
  ctx.fillStyle = 'rgba(4,4,12,0.92)';
  ctx.fillRect(-6.4, -1.03, 1.02, 0.5);
  hazardBand(ctx, -6.4, -1.12, 1.02, 0.14, -Math.PI / 4);
  // drain mouth below the flippers
  ctx.fillStyle = 'rgba(2,2,8,0.95)';
  ctx.fillRect(-1.2, 13.55, 2.4, 1.6);
  hazardBand(ctx, -1.2, 13.55, 2.4, 0.2, -Math.PI / 4);
}

function paintHousings(ctx, data) {
  for (const t of data.POPUP_TARGETS) {
    const big = t.poly.map(([x, y]) => [x, y]);
    ctx.lineJoin = 'round';
    polyFill(ctx, big, '#07080d', rgba('#07080d', 1), 0.22);
    polyFill(ctx, big, null, rgba('#4a4e60', 0.9), 0.04);
  }
}

function paintBumperBases(ctx, data) {
  for (const b of data.BUMPERS) {
    if (b.kind !== 'attack') continue;
    glowDisc(ctx, b.c[0], b.c[1], 1.5, '#000000', 0.5);
    ring(ctx, b.c[0], b.c[1], 0.86, 0.07, rgba(PALETTE.targetFrame, 0.9));
    ring(ctx, b.c[0], b.c[1], 0.95, 0.025, rgba('#000000', 0.5));
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------
/** Painted decals that go UNDER the baked wall shadows. */
/** @param {number} px canvas pixels per table unit (shadowBlur is in pixels, not table units) */
export function paintDecalsUnder(ctx, rand, data, px) {
  paintEmblem(ctx, rand);
  paintLanes(ctx);
  paintStar(ctx, px);
  paintInlanes(ctx, rand);
  paintBlueXStreaks(ctx);
  paintRocket(ctx, rand, px);
  paintPatchAndFighter(ctx, rand, px);
  paintAsteroids(ctx, rand, px);
  paintHousings(ctx, data);
  paintPits(ctx, data);
  paintBumperBases(ctx, data);
}

function wallPts(data, name) {
  const w = data.WALLS.find((x) => x.name === name);
  return w ? w.pts : null;
}

/** Grey slot plate (rollover lane) with a white border and a dark slot; glyph = small direction triangle. */
export function slotPlate(ctx, poly, glyph) {
  ctx.lineJoin = 'round';
  polyFill(ctx, poly, linear(ctx, poly[0][0], poly[0][1], poly[2][0], poly[2][1], [[0, '#555a68'], [1, '#33374a']]), rgba('#c8ccd8', 0.7), 0.035);
  const slot = scalePoly(poly, 0.62);
  polyFill(ctx, slot, '#10121a', rgba('#000000', 0.8), 0.02);
  if (glyph) {
    const c = centroid(slot);
    const s = Math.min(0.14, Math.sqrt(Math.abs(areaOf(slot))) * 0.2);
    polyFill(ctx, [[c[0], c[1] + s], [c[0] - s, c[1] - s * 0.8], [c[0] + s, c[1] - s * 0.8]], rgba('#8a90a4', 0.65));
  }
}

function areaOf(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Painted decals ON TOP of the baked shadows: aprons, slingshot triangles, slot plates, kickback plates. */
export function paintDecalsOver(ctx, data) {
  // aprons (black triangles with red outlines and white studs) and the slingshot triangles
  for (const [name, text, tx] of [['wall_285', 'STAR', 5.75], ['wall_291', 'CADET', -4.98], ['wall_288', null, 0], ['wall_301', null, 0]]) {
    const pts = wallPts(data, name);
    if (!pts) continue;
    const isApron = text !== null;
    ctx.lineJoin = 'round';
    polyFill(ctx, pts, isApron ? PALETTE.apron : '#07080f', rgba('#b01e1e', 0.95), 0.07);
    if (isApron) {
      pts.forEach((p, i) => { if (i % 2 === 0) disc(ctx, p[0] + (p[0] > 0 ? -0.1 : 0.1), p[1] + (p[1] > 12 ? -0.1 : 0.1), 0.05, PALETTE.studWhite); });
      screenAt(ctx, tx, 13.05, 0, () => {
        drawLetters(ctx, text, 0.46, { weight: 0.17, tracking: 0.34, slant: 0.28, fill: PALETTE.apronText });
      });
    }
  }
  // slingshot rubber faces
  for (const name of ['v_rebo1', 'v_rebo2']) {
    const pts = wallPts(data, name);
    if (pts) polyFill(ctx, pts, rgba(PALETTE.railRed, 0.9));
  }
  // slot plates under the rollover lamps
  for (const r of data.ROLLOVERS) {
    if (r.name === 'a_roll9') {
      polyFill(ctx, scalePoly(r.entry, 1.22), '#3b3f4c', rgba('#c8ccd8', 0.7), 0.04);
      polyFill(ctx, scalePoly(r.entry, 0.8), '#12141b', rgba('#000000', 0.8), 0.02);
    } else {
      slotPlate(ctx, scalePoly(r.entry, 1.08), !/^a_roll1(79|8[0-4])$/.test(r.name));
    }
  }
  // kickback plates: the open part of each kickback line (between the wall islands), a grey plate with a red arrow stripe
  const islands = data.WALLS.filter((w) => w.solid === 'island' && w.mask === 1);
  for (const k of data.KICKBACKS) {
    const [a, b] = k.line;
    const y = (a[1] + b[1]) / 2;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 80; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / 80;
      if (islands.some((w) => pointInPoly(x, y - 0.2, w.pts))) continue;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (!(hi > lo)) continue;
    const x0 = lo + 0.04, w = hi - lo - 0.08;
    ctx.fillStyle = linear(ctx, 0, y - 0.15, 0, y + 0.15, [[0, '#6a6f80'], [1, '#3f4352']]);
    ctx.fillRect(x0, y - 0.15, w, 0.3);
    ctx.strokeStyle = rgba('#d8dce8', 0.75);
    ctx.lineWidth = 0.03;
    ctx.strokeRect(x0, y - 0.15, w, 0.3);
    ctx.fillStyle = rgba(PALETTE.railRed, 0.85);
    ctx.fillRect(x0 + 0.04, y - 0.03, w - 0.08, 0.06);
  }
}
