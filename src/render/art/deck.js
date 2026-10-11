/**
 * src/render/art/deck.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2 (ArtPack.deck); SPEC 3.5.2 (painted look), 6.8, ui.md L5 A6-A8, A22, A26
 * paintDeck(data, createCanvas, rand, widthPx) -> CanvasPatch over the bounding box of shell 103 (rect x[1.04,7.65] y[-2.06,7.94]), the texture of
 * the ONE mesh made of ramp + deck + rails (RENDER maps it with patchUV): dark purple-black side tube everywhere, the deck lilac with a
 * dark red-brown rim (DECK_FLOOR_POLY), the launch ramp as lilac chevron bands that run across the channel (RAMP_FOOTPRINT_POLY, resampled
 * boundaries paired station by station), the pink tongue with its light-blue outline beyond the low mouth, violet glow + base ring of the three
 * launch bumpers, slot plates of the launch lanes, the ramp-hole funnel, the black-hole donut in the ramp bend, soft shadows of the deck walls,
 * the word LAUNCH, and the dim unlit insets of every deck lamp (z >= 1) through drawLampShape(..., 'unlit').
 * ASSUMPTIONS: the deck canvas keeps the same px-per-unit in x and y (height = width * 10 / 6.61).
 */
import { DECK_RECT, patchHeight } from './mapping.js';
import {
  TAU, rr, rgba, linear, radial, glowDisc, ring, polyFill, polyStroke, polyPath, resample, tableSpace, noShadow,
} from './draw.js';
import { paintLampInsets } from './lamps.js';
import { paintPit, slotPlate, scalePoly } from './decals.js';
import { paintLabels } from './labels.js';
import { PALETTE } from './palette.js';

/** Splits the ramp footprint outline into its two long sides, both ordered from the low mouth to the upper mouth. */
export function rampSides(footprint) {
  // DATA order (SPEC 3.5.2): 0..3 = left side going down to the low-mouth end A (idx 3), 4 = low-mouth end B, 5..13 = right side up to the
  // upper-mouth end C (idx 13), 14 = upper-mouth end D, then 15..19 = left side coming back to idx 0.
  const n = footprint.length;
  const right = footprint.slice(4, 14); // low mouth end B ... upper mouth end C
  const left = [];
  for (let i = 3; i >= 0; i--) left.push(footprint[i]); // A, 2, 1, 0 (low mouth end A going up the left side)
  for (let i = n - 1; i >= 14; i--) left.push(footprint[i]); // 19 ... 14 (D at the upper mouth)
  return { left, right };
}

function paintBase(ctx, rand) {
  ctx.fillStyle = PALETTE.rampSide;
  ctx.fillRect(1, -2.1, 6.7, 10.1);
  for (let i = 0; i < 40; i++) glowDisc(ctx, rr(rand, 1, 7.7), rr(rand, -2, 8), rr(rand, 0.4, 1.1), '#3a2a5a', rr(rand, 0.1, 0.25));
}

function paintDeckSurface(ctx, rand, poly) {
  ctx.beginPath();
  polyPath(ctx, poly, true);
  ctx.fillStyle = radial(ctx, 6.1, 3.2, 0.3, 5.2, [[0, '#a088c0'], [0.55, PALETTE.deck], [1, '#7a5e9a']]);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, poly, true);
  ctx.clip();
  for (let i = 0; i < 110; i++) {
    glowDisc(ctx, rr(rand, 4.6, 7.7), rr(rand, -2, 8), rr(rand, 0.18, 0.5), rand() < 0.5 ? '#6a4f8a' : '#b49ad0', rr(rand, 0.1, 0.22));
  }
  // dark red-brown rim: a wide stroke clipped to the inside of the polygon
  ctx.lineJoin = 'round';
  polyStroke(ctx, [...poly, poly[0]], 0.7, PALETTE.deckRim, 'round', 'round');
  polyStroke(ctx, [...poly, poly[0]], 0.34, rgba('#6a3a38', 0.7), 'round', 'round');
  ctx.restore();
  polyStroke(ctx, [...poly, poly[0]], 0.025, rgba('#d8c4ec', 0.35), 'round', 'round');
}

function paintRamp(ctx, footprint) {
  const { left, right } = rampSides(footprint);
  const N = 15;
  const L = resample(left, N), R = resample(right, N);
  const M = L.map((p, i) => [(p[0] + R[i][0]) / 2, (p[1] + R[i][1]) / 2]);
  const dir = (i) => {
    const a = M[Math.max(0, i - 1)], b = M[Math.min(N - 1, i + 1)];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  // channel body
  ctx.beginPath();
  polyPath(ctx, footprint, true);
  ctx.fillStyle = PALETTE.bandMid;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, footprint, true);
  ctx.clip();
  // chevron bands: V pointing along the direction of travel (low mouth -> upper mouth)
  const colors = [PALETTE.bandLight, PALETTE.bandMid, PALETTE.bandDark, PALETTE.bandMid];
  for (let k = 0; k < N - 1; k++) {
    const d0 = dir(k), d1 = dir(k + 1);
    const w0 = Math.hypot(L[k][0] - R[k][0], L[k][1] - R[k][1]) * 0.42;
    const w1 = Math.hypot(L[k + 1][0] - R[k + 1][0], L[k + 1][1] - R[k + 1][1]) * 0.42;
    const a = [M[k][0] + d0[0] * w0, M[k][1] + d0[1] * w0];
    const b = [M[k + 1][0] + d1[0] * w1, M[k + 1][1] + d1[1] * w1];
    ctx.beginPath();
    polyPath(ctx, [L[k], a, R[k], R[k + 1], b, L[k + 1]], true);
    ctx.fillStyle = colors[k % 4];
    ctx.fill();
    polyStroke(ctx, [L[k], a, R[k]], 0.045, rgba('#2c1a44', 0.6), 'round', 'round');
    polyStroke(ctx, [L[k + 1], b, R[k + 1]], 0.02, rgba('#e0d0f4', 0.3), 'round', 'round');
  }
  // soft shading across the channel (tube look): darker along both edges
  ctx.restore();
  for (const side of [left, right]) {
    polyStroke(ctx, side, 0.32, '#1d1431', 'round', 'round');
    polyStroke(ctx, side, 0.1, rgba('#4a3a6a', 0.9), 'round', 'round');
    polyStroke(ctx, side, 0.025, rgba('#c0aee0', 0.5), 'round', 'round');
  }
}

function paintTongue(ctx) {
  const tongue = [[1.556, 0.592], [3.296, 1.232], [3.17, 2.09], [1.04, 1.34]];
  ctx.lineJoin = 'round';
  ctx.beginPath();
  polyPath(ctx, tongue, true);
  ctx.fillStyle = linear(ctx, 2.4, 0.9, 2.1, 1.8, [[0, '#d878d8'], [1, PALETTE.pink]]);
  ctx.fill();
  polyFill(ctx, tongue, null, rgba('#7fb8f0', 0.95), 0.07);
  polyFill(ctx, scalePoly(tongue, 0.8), null, rgba('#f0b0f0', 0.4), 0.025);
}

function paintDeckFixtures(ctx, rand, data) {
  // launch bumpers: violet glow on the lilac platform + a dark base ring
  for (const b of data.BUMPERS) {
    if (b.kind !== 'launch') continue;
    glowDisc(ctx, b.c[0], b.c[1], 1.15, '#8a5cff', 0.45);
    glowDisc(ctx, b.c[0], b.c[1], 0.7, '#000000', 0.45);
    ring(ctx, b.c[0], b.c[1], 0.56, 0.05, rgba('#2a1850', 0.8));
  }
  // slot plates of the three launch lanes
  for (const r of data.ROLLOVERS) {
    if (!/^a_roll11[0-2]$/.test(r.name)) continue;
    slotPlate(ctx, scalePoly(r.entry, 1.08), true);
  }
  // ramp hole funnel (SPEC 2.11) at the tip of the deck
  const h = data.RAMP_HOLE.c;
  glowDisc(ctx, h[0], h[1], 1.0, '#1a0c2c', 0.6);
  paintPit(ctx, h[0], h[1], 0.34, '#c4c8d4', null);
  // black hole in the bend of the ramp (a_kout3): white-grey donut, dark centre
  const k3 = data.KICKOUTS.find((k) => k.name === 'a_kout3');
  if (k3) {
    glowDisc(ctx, k3.c[0], k3.c[1], 0.9, '#000000', 0.55);
    paintPit(ctx, k3.c[0], k3.c[1], 0.42, '#d8dae2', null);
  }
  // sparkles on the lilac
  ctx.fillStyle = rgba('#ffffff', 0.55);
  ctx.beginPath();
  for (let i = 0; i < 60; i++) {
    const x = rr(rand, 4.9, 7.5), y = rr(rand, -1.6, 7.6), s = rr(rand, 0.012, 0.03);
    ctx.rect(x, y, s, s);
  }
  ctx.fill();
}

function paintDeckShadows(ctx, data, T) {
  ctx.save();
  ctx.shadowColor = 'rgba(18,8,40,0.7)';
  ctx.shadowBlur = 0.26 * T.sx;
  ctx.fillStyle = '#1a1030';
  for (const w of data.WALLS) {
    if (w.solid === 'shell' || w.mask !== 4) continue;
    ctx.beginPath();
    polyPath(ctx, w.pts, true);
    ctx.fill();
  }
  for (const p of data.POSTS) {
    if (p.mask !== 4) continue;
    ctx.beginPath();
    ctx.arc(p.c[0], p.c[1], p.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  noShadow(ctx);
}

/**
 * @param {import('../../types.js').DataModule} data
 * @param {(w:number,h:number)=>any} createCanvas
 * @param {import('../../types.js').Rand01} rand
 * @param {number} widthPx
 * @returns {import('../../types.js').CanvasPatch}
 */
export function paintDeck(data, createCanvas, rand, widthPx) {
  const width = widthPx;
  const height = patchHeight(DECK_RECT, widthPx);
  const canvas = createCanvas(width, height);
  const patch = { canvas, width, height, rect: { ...DECK_RECT } };
  const ctx = canvas.getContext('2d');
  const T = tableSpace(patch);

  T.enter(ctx);
  paintBase(ctx, rand);
  paintDeckSurface(ctx, rand, data.DECK_FLOOR_POLY);
  paintRamp(ctx, data.RAMP_FOOTPRINT_POLY);
  paintTongue(ctx);
  paintDeckFixtures(ctx, rand, data);
  paintDeckShadows(ctx, data, T);
  paintLabels(ctx, 'deck', data);
  T.leave(ctx);

  paintLampInsets(ctx, patch, data.LAMPS, 'deck');
  return patch;
}

