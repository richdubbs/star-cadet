/**
 * src/render/art/misc.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.3 (exact keys and sizes); SPEC 6.8 (colours), 3.6/3.7 (what the textures are used for)
 * paintMisc(data, createCanvas, rand) -> Record<string, CanvasLike>: the 13 small textures RENDER maps onto the 3D parts:
 *   ballEnv 512x256 (equirectangular studio for the chrome ball: horizontally seamless), metalSide 256x256 (tileable brushed dark metal),
 *   wallTop 128x128 (silver top, red stripe on both long edges: v = across the wall), rubber 128x128, postBand 64x64 (u wraps around the post),
 *   bumperDrum 256x128 (u wraps, seamless), bumperStar 256x256 (WHITE seven-point star ring on transparent, tinted by RENDER), bumperCap 128x128,
 *   targetYellow 128x64, flagPanel 128x64, flipperBody 256x64 (long axis = u, pivot end at u = 0), rampSide 128x128, plungerRod 64x256
 *   (long axis = v).  All original procedural art; all randomness from `rand`.
 * ASSUMPTIONS: tileable textures are periodic by construction (strokes that cross an edge are drawn twice); bumperStar uses
 * globalCompositeOperation 'destination-out' to cut the hole; no key beyond the contract is produced.
 */
import { TAU, rr, rgba, linear, radial, radial2, glowDisc, disc, line, rrectPath, starPath } from './draw.js';
import { PALETTE } from './palette.js';

function make(createCanvas, w, h) {
  const canvas = createCanvas(w, h);
  return { canvas, ctx: canvas.getContext('2d'), w, h };
}

/** Runs fn(dx) at dx = 0 and at the wrapped offsets so shapes crossing the vertical edges are seamless. */
function wrapX(w, x0, x1, fn) {
  fn(0);
  if (x0 < 0) fn(w);
  if (x1 > w) fn(-w);
}

function paintBallEnv(createCanvas, rand) {
  const { canvas, ctx, w, h } = make(createCanvas, 512, 256);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#04050c'], [0.28, '#0e1630'], [0.44, '#2e4878'], [0.5, '#c8d4f0'], [0.56, '#26335a'], [0.72, '#0c1226'], [1, '#05060f']]);
  ctx.fillRect(0, 0, w, h);
  // faint stars in the dark parts
  ctx.fillStyle = rgba('#ffffff', 0.7);
  ctx.beginPath();
  for (let i = 0; i < 260; i++) {
    const y = rr(rand, 0, h * 0.4);
    ctx.rect(rr(rand, 0, w), y, 1.2, 1.2);
  }
  ctx.fill();
  // coloured accents (table colours reflected in the ball): violet, cyan, orange, red
  const blobs = [[70, 168, 90, '#6a40d0', 0.55], [190, 156, 70, '#2aa0d0', 0.5], [330, 170, 100, '#d06020', 0.4], [440, 150, 80, '#c02030', 0.45], [500, 170, 60, '#6a40d0', 0.45]];
  for (const [x, y, r, c, a] of blobs) wrapX(w, x - r, x + r, (dx) => glowDisc(ctx, x + dx, y, r, c, a));
  // soft boxes (large rectangular lights) in the upper hemisphere
  const boxes = [[40, 40, 96, 36], [190, 28, 120, 28], [350, 48, 80, 40], [470, 34, 90, 30]];
  for (const [x, y, bw, bh] of boxes) {
    wrapX(w, x, x + bw, (dx) => {
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.8)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      rrectPath(ctx, x + dx, y, bw, bh, 6);
      ctx.fillStyle = linear(ctx, 0, y, 0, y + bh, [[0, '#ffffff'], [1, '#c8d8ff']]);
      ctx.fill();
      ctx.restore();
    });
  }
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  // horizon strip lights
  ctx.fillStyle = linear(ctx, 0, 118, 0, 140, [[0, rgba('#ffffff', 0)], [0.5, rgba('#e8f0ff', 0.55)], [1, rgba('#ffffff', 0)]]);
  ctx.fillRect(0, 118, w, 22);
  ctx.fillStyle = rgba('#ffffff', 0.85);
  ctx.fillRect(0, 126, w, 2);
  return canvas;
}

function paintMetalSide(createCanvas, rand) {
  const { canvas, ctx, w, h } = make(createCanvas, 256, 256);
  ctx.fillStyle = '#434343';
  ctx.fillRect(0, 0, w, h);
  // brushed lines: full-width horizontal strokes (periodic in x by construction; each stays inside the tile vertically)
  for (let i = 0; i < 300; i++) {
    const y = rr(rand, 0.5, h - 0.5);
    ctx.strokeStyle = rand() < 0.5 ? rgba('#6a6a6a', rr(rand, 0.06, 0.28)) : rgba('#202020', rr(rand, 0.08, 0.3));
    ctx.lineWidth = rr(rand, 0.5, 1.4);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // short brighter scratches (wrapped)
  for (let i = 0; i < 40; i++) {
    const x = rr(rand, 0, w), y = rr(rand, 2, h - 2), len = rr(rand, 12, 60);
    ctx.strokeStyle = rgba('#8a8a8a', rr(rand, 0.12, 0.3));
    ctx.lineWidth = 0.8;
    wrapX(w, x, x + len, (dx) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y);
      ctx.lineTo(x + len + dx, y);
      ctx.stroke();
    });
  }
  // very faint tonal mottling
  for (let i = 0; i < 24; i++) {
    const x = rr(rand, 0, w), y = rr(rand, 0, h), r = rr(rand, 16, 40);
    wrapX(w, x - r, x + r, (dx) => glowDisc(ctx, x + dx, y, r, rand() < 0.5 ? '#585858' : '#303030', 0.12));
  }
  return canvas;
}

function paintWallTop(createCanvas, rand) {
  const { canvas, ctx, w, h } = make(createCanvas, 128, 128);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#7a0c0e'], [0.14, PALETTE.railRed], [0.2, '#8a8e98'], [0.34, '#e4e7ee'], [0.5, '#c4c8d2'], [0.66, '#e4e7ee'], [0.8, '#8a8e98'], [0.86, PALETTE.railRed], [1, '#7a0c0e']]);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    const y = rr(rand, 26, 102);
    ctx.strokeStyle = rgba(rand() < 0.5 ? '#ffffff' : '#707480', rr(rand, 0.05, 0.2));
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // red-stripe highlights
  ctx.fillStyle = rgba('#ff6a6a', 0.35);
  ctx.fillRect(0, 6, w, 2);
  ctx.fillRect(0, h - 10, w, 2);
  // white rivets along the silver
  for (const x of [16, 64, 112]) {
    disc(ctx, x, 64, 3.2, radial(ctx, x - 1, 63, 0, 3.4, [[0, '#ffffff'], [1, '#9a9eaa']]));
  }
  return canvas;
}

function paintRubber(createCanvas, rand) {
  const { canvas, ctx, w, h } = make(createCanvas, 128, 128);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#8a1010'], [0.3, '#d22a2a'], [0.55, '#b81818'], [1, '#6e0c0c']]);
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba('#400000', 0.18);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let x = 8; x < w; x += 16) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  ctx.stroke();
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = rgba(rand() < 0.5 ? '#ff7070' : '#300000', rr(rand, 0.05, 0.16));
    ctx.fillRect(rr(rand, 0, w), rr(rand, 0, h), rr(rand, 1, 3), rr(rand, 1, 3));
  }
  ctx.fillStyle = rgba('#ffa0a0', 0.4);
  ctx.fillRect(0, 22, w, 4);
  return canvas;
}

function paintPostBand(createCanvas) {
  const { canvas, ctx, w, h } = make(createCanvas, 64, 64);
  ctx.fillStyle = linear(ctx, 0, 0, w, 0, [[0, '#7a0e10'], [0.28, '#e03434'], [0.5, '#c41315'], [1, '#6a0a0c']]);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = rgba('#ffffff', 0.5);
  ctx.fillRect(w * 0.24, 0, 5, h);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, rgba('#000000', 0.25)], [0.2, rgba('#000000', 0)], [0.8, rgba('#000000', 0)], [1, rgba('#000000', 0.35)]]);
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

function paintBumperDrum(createCanvas) {
  const { canvas, ctx, w, h } = make(createCanvas, 256, 128);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#f6efe8'], [0.5, PALETTE.bumperWhite], [1, '#bdb0a6']]);
  ctx.fillRect(0, 0, w, h);
  // periodic facet shading around the drum (3 full periods across u => seamless)
  for (let x = 0; x < w; x += 4) {
    const a = 0.1 * Math.sin((x / w) * TAU * 3);
    ctx.fillStyle = a >= 0 ? rgba('#ffffff', a) : rgba('#6a5a50', -a);
    ctx.fillRect(x, 0, 4, h);
  }
  ctx.fillStyle = rgba('#8a8078', 0.55);
  ctx.fillRect(0, 9, w, 3);
  ctx.fillRect(0, h - 12, w, 3);
  ctx.fillStyle = rgba('#ffffff', 0.5);
  ctx.fillRect(0, 13, w, 1.5);
  return canvas;
}

function paintBumperStar(createCanvas) {
  const { canvas, ctx } = make(createCanvas, 256, 256);
  const c = 128;
  // seven-point star plate
  ctx.beginPath();
  starPath(ctx, c, c, 122, 80, 7, -Math.PI / 2);
  ctx.fillStyle = radial(ctx, c, c, 50, 122, [[0, '#d4d4d4'], [0.7, '#f2f2f2'], [1, '#ffffff']]);
  ctx.fill();
  // facets: alternate tips slightly darker so the plate reads as pressed metal
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 7;
    const al = a - Math.PI / 7;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 122, c + Math.sin(a) * 122);
    ctx.lineTo(c + Math.cos(al) * 80, c + Math.sin(al) * 80);
    ctx.lineTo(c, c);
    ctx.closePath();
    ctx.fillStyle = rgba('#808080', 0.16);
    ctx.fill();
    line(ctx, c + Math.cos(a) * 118, c + Math.sin(a) * 118, c + Math.cos(a) * 60, c + Math.sin(a) * 60, 1.5, rgba('#909090', 0.5));
  }
  ctx.beginPath();
  starPath(ctx, c, c, 122, 80, 7, -Math.PI / 2);
  ctx.strokeStyle = rgba('#7a7a7a', 0.8);
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // hole for the cap
  ctx.globalCompositeOperation = 'destination-out';
  disc(ctx, c, c, 50, '#000000');
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = rgba('#606060', 0.9);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, 52, 0, TAU);
  ctx.stroke();
  return canvas;
}

function paintBumperCap(createCanvas) {
  const { canvas, ctx, w, h } = make(createCanvas, 128, 128);
  ctx.fillStyle = '#05103a';
  ctx.fillRect(0, 0, w, h);
  disc(ctx, 64, 64, 62, radial2(ctx, 50, 46, 4, 64, 64, 62, [[0, '#3a52d8'], [0.4, '#1a2ea8'], [0.75, PALETTE.bumperCap], [1, '#060f46']]));
  ctx.strokeStyle = rgba('#5a72f0', 0.55);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = rgba('#ffffff', 0.55);
  ctx.beginPath();
  ctx.ellipse(46, 40, 16, 8, -0.6, 0, TAU);
  ctx.fill();
  return canvas;
}

function paintTargetYellow(createCanvas) {
  const { canvas, ctx, w, h } = make(createCanvas, 128, 64);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#d2b684'], [1, '#8f7448']]);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = linear(ctx, 0, 6, 0, h - 6, [[0, '#ffffa8'], [0.45, PALETTE.targetYellow], [1, '#d0cc2c']]);
  ctx.beginPath();
  rrectPath(ctx, 8, 6, w - 16, h - 12, 5);
  ctx.fill();
  ctx.strokeStyle = rgba('#5a4420', 0.7);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = rgba('#ffffff', 0.6);
  ctx.fillRect(14, 10, w - 28, 3);
  ctx.fillStyle = rgba('#d8c08a', 0.9);
  ctx.fillRect(0, 0, w, 3);
  return canvas;
}

function paintFlagPanel(createCanvas) {
  const { canvas, ctx, w, h } = make(createCanvas, 128, 64);
  ctx.fillStyle = linear(ctx, 0, 0, w, 0, [[0, '#8da0ac'], [0.15, '#f4ecd2'], [0.5, '#fff8e2'], [0.85, '#f0e6c8'], [1, '#6c8494']]);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = rgba('#36566c', 0.35);
  ctx.fillRect(0, 0, w, 5);
  ctx.fillRect(0, h - 5, w, 5);
  ctx.fillStyle = rgba('#36566c', 0.5);
  ctx.fillRect(w / 2 - 1, 8, 2, h - 16);
  ctx.strokeStyle = rgba('#36566c', 0.7);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  return canvas;
}

function paintFlipperBody(createCanvas) {
  const { canvas, ctx, w, h } = make(createCanvas, 256, 64);
  // red-pink rim
  ctx.fillStyle = PALETTE.flipperRim;
  ctx.fillRect(0, 0, w, h);
  // tapered light-grey top (thick pivot end at u = 0, narrow tip at u = 1)
  ctx.beginPath();
  ctx.moveTo(6, 7);
  ctx.lineTo(w - 6, 15);
  ctx.lineTo(w - 6, h - 15);
  ctx.lineTo(6, h - 7);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#f0f1f4'], [0.5, PALETTE.flipperBody], [1, '#8f939c']]);
  ctx.fill();
  ctx.strokeStyle = rgba('#a02828', 0.8);
  ctx.lineWidth = 2;
  ctx.stroke();
  // centre highlight streak and pivot cap
  ctx.fillStyle = rgba('#ffffff', 0.55);
  ctx.fillRect(34, 20, 190, 3);
  disc(ctx, 30, h / 2, 12, radial(ctx, 27, h / 2 - 3, 0, 14, [[0, '#ffffff'], [0.6, '#b4b8c2'], [1, '#6a6e78']]));
  ctx.strokeStyle = rgba('#505460', 0.8);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(30, h / 2, 12, 0, TAU);
  ctx.stroke();
  return canvas;
}

function paintRampSide(createCanvas, rand) {
  const { canvas, ctx, w, h } = make(createCanvas, 128, 128);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#2e2050'], [0.3, '#241840'], [0.6, '#150e28'], [1, '#0c0818']]);
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba('#6a5aa0', 0.28);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = -h; x < w + h; x += 24) { ctx.moveTo(x, h); ctx.lineTo(x + h / 2, h / 2); ctx.lineTo(x + h, h); }
  ctx.stroke();
  ctx.fillStyle = rgba('#b8a8e8', 0.18);
  ctx.fillRect(0, 22, w, 4);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rgba('#8070c0', rr(rand, 0.05, 0.18));
    ctx.fillRect(rr(rand, 0, w), rr(rand, 0, h), 1.5, 1.5);
  }
  return canvas;
}

function paintPlungerRod(createCanvas) {
  const { canvas, ctx, w, h } = make(createCanvas, 64, 256);
  ctx.fillStyle = linear(ctx, 0, 0, w, 0, [[0, '#2a2c34'], [0.14, '#8a8e9a'], [0.3, '#ffffff'], [0.42, '#b0b4be'], [0.62, '#5a5e6a'], [0.8, '#9a9eaa'], [0.92, '#585c68'], [1, '#22242c']]);
  ctx.fillRect(0, 0, w, h);
  // machined grooves
  for (const y of [20, 60, 100, 200]) {
    ctx.fillStyle = rgba('#000000', 0.35);
    ctx.fillRect(0, y, w, 3);
    ctx.fillStyle = rgba('#ffffff', 0.35);
    ctx.fillRect(0, y + 3, w, 1.5);
  }
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, rgba('#000000', 0.25)], [0.08, rgba('#000000', 0)], [0.92, rgba('#000000', 0)], [1, rgba('#000000', 0.3)]]);
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

/**
 * @param {import('../../types.js').DataModule} _data
 * @param {(w:number,h:number)=>any} createCanvas
 * @param {import('../../types.js').Rand01} rand
 * @returns {Record<string, any>} canvases keyed as in ARCHITECTURE.md 9.3
 */
export function paintMisc(_data, createCanvas, rand) {
  return {
    ballEnv: paintBallEnv(createCanvas, rand),
    metalSide: paintMetalSide(createCanvas, rand),
    wallTop: paintWallTop(createCanvas, rand),
    rubber: paintRubber(createCanvas, rand),
    postBand: paintPostBand(createCanvas),
    bumperDrum: paintBumperDrum(createCanvas),
    bumperStar: paintBumperStar(createCanvas),
    bumperCap: paintBumperCap(createCanvas),
    targetYellow: paintTargetYellow(createCanvas),
    flagPanel: paintFlagPanel(createCanvas),
    flipperBody: paintFlipperBody(createCanvas),
    rampSide: paintRampSide(createCanvas, rand),
    plungerRod: paintPlungerRod(createCanvas),
  };
}
