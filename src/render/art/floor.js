/**
 * src/render/art/floor.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2 (ArtPack.floor); SPEC 6.8, 3.7 step 1, ui.md L5 (painted-art inventory), App. A (lamp insets)
 * paintFloor(data, createCanvas, rand, widthPx) -> CanvasPatch for the whole playfield rect x[-8,8] y[-14,15] (the canvas looks like the
 * table seen from above: x = +8 at the left edge).  Painting order (all in T-frame units through tableSpace()):
 *   base navy -> nebula glows -> star specks -> vein web -> decals UNDER the shadows (decals.js: emblem, copper lanes, spiked star, inlane slopes,
 *   rocket, patch + starfighter, asteroids, target housings, pits, bumper bases) -> baked soft shadows around every mask-1 wall island and under
 *   the deck / hidden-tube cover -> decals OVER the shadows (aprons, slingshot triangles, slot plates, kickback plates) -> lettering (labels.js:
 *   RE-ENTRY, HYPERSPACE, FUEL, MEDAL, MISSION, BOOSTER, SKILL SHOT, LAUNCH, rank names) -> dim unlit insets of every floor lamp (z < 1)
 *   through drawLampShape(..., 'unlit') on top of everything.
 * ASSUMPTIONS: original artwork only (no game bitmaps, no pilot).  The words painted on the table are our own wording (labels.js).  shadowBlur
 * is in canvas pixels (not table units), so shadows are scaled with tableSpace().sx.  Island interiors are painted dark (the real wall meshes of
 * RENDER cover them; the soft halo around them is what shows).
 */
import { FLOOR_RECT, patchHeight } from './mapping.js';
import { TAU, rr, ri, gauss, rgba, linear, radial, glowDisc, tableSpace, noShadow, polyPath } from './draw.js';
import { paintLampInsets } from './lamps.js';
import { paintDecalsUnder, paintDecalsOver, EMBLEM } from './decals.js';
import { paintLabels } from './labels.js';
import { PALETTE } from './palette.js';

function paintBase(ctx, rand) {
  ctx.fillStyle = linear(ctx, 0, -14, 0, 15, [[0, '#15234a'], [0.45, PALETTE.floorNavy], [0.75, PALETTE.floorNavy2], [1, '#1a1c3a']]);
  ctx.fillRect(-8, -14, 16, 29);
  // soft tonal blotches so the navy is not flat
  for (let i = 0; i < 26; i++) {
    const x = rr(rand, -8, 8), y = rr(rand, -14, 15), r = rr(rand, 1.6, 4.2);
    glowDisc(ctx, x, y, r, rand() < 0.5 ? '#28407a' : '#0c1226', rr(rand, 0.14, 0.3));
  }
  // violet haze towards the flippers, teal haze around the emblem
  glowDisc(ctx, 0, 11.5, 6.5, '#3a2a6a', 0.35);
  glowDisc(ctx, EMBLEM.x, EMBLEM.y, 5.2, '#1f5c80', 0.32);
  // gentle vignette towards the cabinet walls
  ctx.fillStyle = radial(ctx, 0, 0.5, 5, 17, [[0, 'rgba(2,3,10,0)'], [1, 'rgba(2,3,10,0.5)']]);
  ctx.fillRect(-8, -14, 16, 29);
}

function paintNebulae(ctx, rand) {
  const spots = [
    [-5.9, -14.0, 3.4, 1], [-6.8, -12.7, 1.5, 0.8], [-6.3, -0.3, 2.7, 1], [7.9, -10.4, 1.9, 0.9],
  ];
  for (const [x, y, r, k] of spots) {
    glowDisc(ctx, x, y, r, PALETTE.nebulaHaze, 0.8 * k);
    glowDisc(ctx, x + rr(rand, -0.2, 0.2), y + rr(rand, -0.2, 0.2), r * 0.55, '#7a3a3a', 0.5 * k);
    glowDisc(ctx, x, y, r * 0.2, PALETTE.nebulaCore, 0.9 * k);
    glowDisc(ctx, x, y, r * 0.07, '#ffffff', 0.9 * k);
  }
}

function paintStars(ctx, rand) {
  const colors = ['#ffffff', '#bcd4ff', '#8fe0ff'];
  const buckets = colors.map((c) => ({ c, a: [[], []] }));
  const n = 3600;
  for (let i = 0; i < n; i++) {
    const b = buckets[ri(rand, 0, 2)];
    const s = rand() < 0.85 ? rr(rand, 0.008, 0.018) : rr(rand, 0.02, 0.034);
    b.a[rand() < 0.45 ? 0 : 1].push([rr(rand, -8, 8), rr(rand, -14, 15), s]);
  }
  for (const b of buckets) {
    b.a.forEach((list, k) => {
      ctx.fillStyle = rgba(b.c, k === 0 ? 0.9 : 0.5);
      ctx.beginPath();
      for (const [x, y, s] of list) ctx.rect(x, y, s, s);
      ctx.fill();
    });
  }
  // a few glints with a small flare cross
  for (let i = 0; i < 34; i++) {
    const x = rr(rand, -7.8, 7.8), y = rr(rand, -13.8, 14.8), r = rr(rand, 0.05, 0.11);
    glowDisc(ctx, x, y, r * 2.4, '#9fc8ff', 0.35);
    ctx.fillStyle = rgba('#ffffff', 0.9);
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.14, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.14, y); ctx.closePath();
    ctx.moveTo(x - r, y); ctx.lineTo(x, y + r * 0.14); ctx.lineTo(x + r, y); ctx.lineTo(x, y - r * 0.14); ctx.closePath();
    ctx.fill();
  }
}

/** Cracked-glass / lightning vein web, densest around the emblem (SPEC 6.8). */
function paintVeins(ctx, rand) {
  const levels = [[], [], []];
  const bolt = (x, y, a, len, depth) => {
    const pts = [[x, y]];
    let cx = x, cy = y, ca = a, left = len;
    while (left > 0) {
      const step = rr(rand, 0.18, 0.34);
      ca += rr(rand, -0.38, 0.38);
      cx += Math.cos(ca) * step;
      cy += Math.sin(ca) * step;
      pts.push([cx, cy]);
      left -= step;
      if (depth < 3 && rand() < 0.15) bolt(cx, cy, ca + (rand() < 0.5 ? -1 : 1) * rr(rand, 0.5, 1.1), left * rr(rand, 0.4, 0.7), depth + 1);
    }
    levels[Math.min(depth, 2)].push(pts);
  };
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + rr(rand, -0.1, 0.1);
    bolt(EMBLEM.x + Math.cos(a) * 3.3, EMBLEM.y + Math.sin(a) * 3.3, a, rr(rand, 2.5, 7), 0);
  }
  for (let i = 0; i < 70; i++) {
    const near = rand() < 0.5;
    const x = near ? EMBLEM.x + gauss(rand) * 4 : rr(rand, -8, 8);
    const y = near ? EMBLEM.y + gauss(rand) * 5 : rr(rand, -14, 15);
    bolt(x, y, rr(rand, 0, TAU), rr(rand, 1.2, 3.8), 1);
  }
  // cracked-glass net: jittered points joined to their nearest neighbours by jagged lines
  const pts = [];
  for (let gx = -8; gx <= 8; gx += 1.5) for (let gy = -14; gy <= 15; gy += 1.5) pts.push([gx + rr(rand, -0.6, 0.6), gy + rr(rand, -0.6, 0.6)]);
  for (let i = 0; i < 70; i++) pts.push([EMBLEM.x + gauss(rand) * 2.6, EMBLEM.y + gauss(rand) * 2.6]);
  const net = [];
  const seen = new Set();
  pts.forEach((p, i) => {
    const near = [];
    for (let j = 0; j < pts.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(pts[j][0] - p[0], pts[j][1] - p[1]);
      if (d < 2.4) near.push([d, j]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const [d, j] of near.slice(0, 2)) {
      const key = i < j ? i + ':' + j : j + ':' + i;
      if (seen.has(key)) continue;
      seen.add(key);
      const q = pts[j];
      const nx = -(q[1] - p[1]) / d, ny = (q[0] - p[0]) / d;
      const line = [p];
      for (let k = 1; k <= 3; k++) {
        const t = k / 4, o = rr(rand, -0.09, 0.09);
        line.push([p[0] + (q[0] - p[0]) * t + nx * o, p[1] + (q[1] - p[1]) * t + ny * o]);
      }
      line.push(q);
      net.push(line);
    }
  });
  const strokeAll = (lists, width, color, alpha) => {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const pl of lists) polyPath(ctx, pl, false);
    ctx.stroke();
  };
  strokeAll(net, 0.014, PALETTE.vein, 0.4);
  strokeAll(levels[0], 0.09, '#5fb0c0', 0.1);
  strokeAll(levels[2], 0.014, PALETTE.vein, 0.5);
  strokeAll(levels[1], 0.022, '#477080', 0.65);
  strokeAll(levels[0], 0.03, '#58909e', 0.85);
}

/** Soft baked shadows: around every wall island (fill is hidden by the real wall mesh) and under the deck / hidden tube cover. */
function paintShadows(ctx, data, T) {
  ctx.save();
  ctx.shadowColor = 'rgba(2,3,12,0.62)';
  ctx.shadowBlur = 0.34 * T.sx;
  ctx.fillStyle = '#080b17';
  for (const w of data.WALLS) {
    if (w.solid === 'shell') continue;
    if (w.mask !== 1) continue; // deck walls (mask 4) sit on the deck texture
    ctx.beginPath();
    polyPath(ctx, w.pts, true);
    ctx.fill();
  }
  ctx.restore();
  noShadow(ctx);
  // under the deck/ramp (shell 103) and the hidden tube cover (shell 106): dim floor
  for (const w of data.WALLS) {
    if (w.solid !== 'shell') continue;
    ctx.save();
    ctx.shadowColor = 'rgba(2,3,12,0.55)';
    ctx.shadowBlur = 0.5 * T.sx;
    ctx.fillStyle = w.name === 'wall_103' ? 'rgba(4,5,16,0.55)' : 'rgba(4,5,16,0.8)';
    ctx.beginPath();
    polyPath(ctx, w.pts, true);
    ctx.fill();
    ctx.restore();
  }
  noShadow(ctx);
}

/**
 * @param {import('../../types.js').DataModule} data
 * @param {(w:number,h:number)=>any} createCanvas
 * @param {import('../../types.js').Rand01} rand
 * @param {number} widthPx
 * @returns {import('../../types.js').CanvasPatch}
 */
export function paintFloor(data, createCanvas, rand, widthPx) {
  const width = widthPx;
  const height = patchHeight(FLOOR_RECT, widthPx);
  const canvas = createCanvas(width, height);
  const patch = { canvas, width, height, rect: { ...FLOOR_RECT } };
  const ctx = canvas.getContext('2d');
  const T = tableSpace(patch);

  T.enter(ctx);
  paintBase(ctx, rand);
  paintNebulae(ctx, rand);
  paintStars(ctx, rand);
  paintVeins(ctx, rand);
  paintDecalsUnder(ctx, rand, data, T.sx);
  paintShadows(ctx, data, T);
  paintDecalsOver(ctx, data);
  paintLabels(ctx, 'floor', data);
  T.leave(ctx);

  paintLampInsets(ctx, patch, data.LAMPS, 'floor');
  return patch;
}

