/**
 * src/render/art/panel.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2 / 8.3 (ArtPack.panel, 203x394); SPEC 6.2, 6.3 (panel fields, colours, logo composition)
 * paintPanel(data, createCanvas, rand) -> the static scoreboard art: bevelled grey metal bezel (#888888, highlight #b8b8b8, shadow #484848),
 * the black boxes of the score row / info box / mission box (field rect expanded by 4 px; score row = union of player1 and score1 expanded by 5 px)
 * which are LEFT PURE BLACK for the UI dots, the boxed ball digit, and an ORIGINAL logo: black starfield with small white/cyan stars, a small
 * green mottled planet at the lower left, a pale-violet bubble-lettered "STAR CADET", a smaller blue-violet "PINBALL" above it, an original
 * crewless flying saucer (empty dome, no character) with an orange flame on the right edge, and the word BALL in dark red left of the ball digit.
 * No digits or messages are painted (the UI draws them).  Everything is vector (own stroke alphabet from font.js), nothing is copied
 * from the game's bitmaps, and no character/pilot of any kind is drawn.
 * ASSUMPTIONS: field rectangles come from data.PANEL.fields (panel-local px); the logo occupies x 12..191, y 10..170.
 */
import { TAU, rr, ri, rgba, linear, radial2, glowDisc, disc, line, polyFill, smoothClosedPath } from './draw.js';
import { drawLetters } from './font.js';
import { PALETTE } from './palette.js';

export const PANEL_W = 203;
export const PANEL_H = 394;
/** The logo picture rectangle (panel-local px). */
export const LOGO_RECT = Object.freeze({ x: 12, y: 10, w: 179, h: 160 });

/**
 * The black boxes the UI draws its dots into (panel-local px): rects derived from data.PANEL.fields.
 * @returns {{score:{x:number,y:number,w:number,h:number}, info:object, mission:object, ball:object}}
 */
export function panelBoxes(data) {
  const f = data.PANEL.fields;
  const grow = (r, g) => ({ x: r.x - g, y: r.y - g, w: r.w + 2 * g, h: r.h + 2 * g });
  const left = Math.min(f.player1.x, f.score1.x), right = Math.max(f.player1.x + f.player1.w, f.score1.x + f.score1.w);
  const top = Math.min(f.player1.y, f.score1.y), bottom = Math.max(f.player1.y + f.player1.h, f.score1.y + f.score1.h);
  return {
    score: grow({ x: left, y: top, w: right - left, h: bottom - top }, 5),
    info: grow(f.info, 4),
    mission: grow(f.mission, 4),
    ball: grow(f.ball1, 3),
  };
}

function bevelRect(ctx, x, y, w, h, hi, lo, t = 2, inverted = false) {
  const a = inverted ? lo : hi, b = inverted ? hi : lo;
  ctx.fillStyle = a;
  ctx.fillRect(x, y, w, t);
  ctx.fillRect(x, y, t, h);
  ctx.fillStyle = b;
  ctx.fillRect(x, y + h - t, w, t);
  ctx.fillRect(x + w - t, y, t, h);
  // mitred corners
  ctx.fillStyle = a;
  ctx.fillRect(x + w - t, y, t, t);
  ctx.fillRect(x, y + h - t, t, t);
}

function paintBezel(ctx, rand) {
  const C = PALETTE;
  ctx.fillStyle = linear(ctx, 0, 0, PANEL_W, PANEL_H, [[0, '#9a9a9a'], [0.5, C.panelBezel], [1, '#767676']]);
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = rgba(rand() < 0.5 ? '#ffffff' : '#000000', rr(rand, 0.02, 0.07));
    ctx.fillRect(0, rr(rand, 0, PANEL_H), PANEL_W, 1);
  }
  bevelRect(ctx, 0, 0, PANEL_W, PANEL_H, C.panelHi, C.panelLo, 3);
  bevelRect(ctx, 5, 5, PANEL_W - 10, PANEL_H - 10, C.panelHi, C.panelLo, 1, true);
  for (const [x, y] of [[10, 5], [193, 5], [10, 389], [193, 389]]) {
    disc(ctx, x, y, 2.6, radial2(ctx, x - 0.8, y - 0.8, 0, x, y, 3, [[0, '#d8d8d8'], [1, '#606060']]));
    line(ctx, x - 1.6, y + 0.8, x + 1.6, y - 0.8, 0.8, rgba('#303030', 0.8), 'butt');
  }
}

function blackBox(ctx, r) {
  const C = PALETTE;
  bevelRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, C.panelHi, C.panelLo, 1, true);
  ctx.fillStyle = '#000000';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // thin grey inner border (inside the 4 px margin, never touching the field rect itself)
  ctx.strokeStyle = '#5a5a5a';
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

// ---- the logo ------------------------------------------------------------------------------------------------------------------
function bubble(ctx, text, size, o) {
  drawLetters(ctx, text, size, {
    align: 'center', tracking: o.tracking ?? 0.34, weight: o.weight ?? 0.26, slant: 0,
    fill: o.face,
    outline: { color: o.outline, width: o.outlineW ?? 1.6 },
    shadow: { color: o.shadow, dx: o.sdx ?? 2, dy: o.sdy ?? 2.4 },
    highlight: { color: o.hi, dx: -0.9, dy: -1.1, weight: 0.3 },
    ...(o.extra || {}),
  });
}

function starfield(ctx, rand, r) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  glowDisc(ctx, 60, 150, 60, '#103a2a', 0.35);
  glowDisc(ctx, 150, 40, 70, '#2a1a6a', 0.35);
  const cols = ['#ffffff', '#bfe8ff', '#8fe0ff', '#e0d8ff'];
  for (let i = 0; i < 150; i++) {
    const x = rr(rand, r.x + 2, r.x + r.w - 2), y = rr(rand, r.y + 2, r.y + r.h - 2);
    ctx.fillStyle = rgba(cols[ri(rand, 0, cols.length - 1)], rr(rand, 0.35, 0.95));
    const s = rand() < 0.85 ? 1 : 2;
    ctx.fillRect(Math.floor(x), Math.floor(y), s, s);
  }
  for (let i = 0; i < 9; i++) {
    const x = rr(rand, r.x + 8, r.x + r.w - 8), y = rr(rand, r.y + 6, r.y + r.h - 6);
    glowDisc(ctx, x, y, 5, '#9fc8ff', 0.4);
    line(ctx, x - 3.5, y, x + 3.5, y, 0.7, rgba('#ffffff', 0.85));
    line(ctx, x, y - 3.5, x, y + 3.5, 0.7, rgba('#ffffff', 0.85));
  }
}

function planet(ctx, rand, cx, cy, r) {
  glowDisc(ctx, cx, cy, r * 1.7, '#5aff9a', 0.22);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = radial2(ctx, cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05, [[0, '#9af09a'], [0.35, '#4cc060'], [0.75, '#1f7a3a'], [1, '#0c3a1e']]);
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  for (let i = 0; i < 16; i++) {
    const a = rr(rand, 0, TAU), d = Math.sqrt(rand()) * r * 0.95;
    disc(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr(rand, 1.5, 4.5), rgba(rand() < 0.5 ? '#0f4a28' : '#c8f8a8', rr(rand, 0.18, 0.4)));
  }
  ctx.fillStyle = linear(ctx, cx - r, cy, cx + r, cy, [[0.4, rgba('#000000', 0)], [1, rgba('#000000', 0.55)]]);
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.strokeStyle = rgba('#b8ffd0', 0.45);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.5, Math.PI * 0.95, Math.PI * 1.55);
  ctx.stroke();
}

/** Original crewless flying saucer with an empty glass dome (flying to the left, orange flame trailing on the right). */
function saucer(ctx, cx, cy) {
  // flame on the right edge
  const flame = [[cx + 28, cy + 2], [cx + 38, cy - 3], [cx + 52, cy + 4], [cx + 38, cy + 11]];
  ctx.save();
  ctx.beginPath();
  smoothClosedPath(ctx, flame);
  ctx.fillStyle = linear(ctx, cx + 28, cy, cx + 52, cy, [[0, '#ffe070'], [0.5, '#ff8a20'], [1, rgba('#d02a10', 0.2)]]);
  ctx.fill();
  ctx.restore();
  polyFill(ctx, [[cx + 28, cy + 4], [cx + 38, cy + 2], [cx + 42, cy + 5], [cx + 36, cy + 8]], rgba('#fff4b0', 0.9));
  // underside + body
  ctx.beginPath();
  ctx.ellipse(cx, cy + 12, 17, 5, 0, 0, TAU);
  ctx.fillStyle = '#5a6088';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + 6, 31, 9, 0, 0, TAU);
  ctx.fillStyle = linear(ctx, 0, cy - 3, 0, cy + 15, [[0, '#f0f2fa'], [0.5, '#b0b6cc'], [1, '#6a7094']]);
  ctx.fill();
  ctx.strokeStyle = rgba('#2a2e50', 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();
  // row of lights
  const lc = ['#ffe060', '#60e0ff', '#ff6080', '#60ff90', '#ffe060'];
  lc.forEach((c, i) => {
    const x = cx - 20 + i * 10;
    glowDisc(ctx, x, cy + 8, 4, c, 0.5);
    disc(ctx, x, cy + 8, 1.7, c);
  });
  // dome
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - 20, cy - 20, 40, 21);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(cx - 1, cy + 1, 14, 15, 0, 0, TAU);
  ctx.fillStyle = rgba('#a8e8ff', 0.5);
  ctx.fill();
  ctx.restore();
  // empty glass dome with a soft inner glow (no occupant)
  glowDisc(ctx, cx - 1, cy - 3, 9, '#c8f4ff', 0.35);
  // dome outline + highlight + antenna
  ctx.strokeStyle = rgba('#ffffff', 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx - 1, cy + 1, 14, 15, 0, Math.PI, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba('#ffffff', 0.7);
  ctx.beginPath();
  ctx.arc(cx - 1, cy + 1, 11, Math.PI * 1.15, Math.PI * 1.4);
  ctx.stroke();
  line(ctx, cx - 1, cy - 14, cx - 1, cy - 19, 0.8, '#e8e8f0');
  disc(ctx, cx - 1, cy - 20, 1.5, '#ff4040');
}

function paintLogo(ctx, rand) {
  const r = LOGO_RECT;
  bevelRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, PALETTE.panelHi, PALETTE.panelLo, 1, true);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  starfield(ctx, rand, r);
  planet(ctx, rand, 34, 148, 15);
  saucer(ctx, 138, 33);
  // small blue-violet word above the title
  ctx.save();
  ctx.translate(22, 26);
  drawLetters(ctx, 'PINBALL', 9.5, {
    align: 'left', tracking: 0.3, weight: 0.24, fill: PALETTE.logoSmall, shadow: { color: '#241670', dx: 1, dy: 1.4 }, highlight: { color: '#c8b8ff', dx: -0.4, dy: -0.5, weight: 0.3 },
  });
  ctx.restore();
  ctx.restore();
}

function paintTitle(ctx) {
  const o = { face: PALETTE.logoFace, outline: '#3a2a70', shadow: PALETTE.logoShadow, hi: '#f4e8ff', outlineW: 1.8 };
  ctx.save();
  ctx.beginPath();
  ctx.rect(LOGO_RECT.x, LOGO_RECT.y, LOGO_RECT.w, LOGO_RECT.h);
  ctx.clip();
  ctx.save();
  ctx.translate(101, 72);
  bubble(ctx, 'STAR', 31, o);
  ctx.restore();
  ctx.save();
  ctx.translate(101, 110);
  bubble(ctx, 'CADET', 31, { ...o, face: PALETTE.logoFace2 });
  ctx.restore();
  ctx.restore();
}

function paintBallLabel(ctx, data) {
  const b = data.PANEL.fields.ball1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(LOGO_RECT.x, LOGO_RECT.y, LOGO_RECT.w, LOGO_RECT.h);
  ctx.clip();
  ctx.translate(b.x - 8, b.y + b.h / 2);
  drawLetters(ctx, 'BALL', 14, {
    align: 'right', tracking: 0.3, weight: 0.24, fill: PALETTE.ballText, outline: { color: '#2a0404', width: 1 }, shadow: { color: PALETTE.ballTextDark, dx: 1, dy: 1.3 },
    highlight: { color: '#f06060', dx: -0.4, dy: -0.5, weight: 0.3 },
  });
  ctx.restore();
}

/**
 * @param {import('../../types.js').DataModule} data
 * @param {(w:number,h:number)=>any} createCanvas
 * @param {import('../../types.js').Rand01} rand
 * @returns {any} a 203x394 canvas
 */
export function paintPanel(data, createCanvas, rand) {
  const canvas = createCanvas(PANEL_W, PANEL_H);
  const ctx = canvas.getContext('2d');
  paintBezel(ctx, rand);
  paintLogo(ctx, rand);
  paintTitle(ctx);
  paintBallLabel(ctx, data);
  const boxes = panelBoxes(data);
  blackBox(ctx, boxes.ball);
  blackBox(ctx, boxes.score);
  blackBox(ctx, boxes.info);
  blackBox(ctx, boxes.mission);
  // divider between the player digit and the score digits
  const f = data.PANEL.fields;
  const dx = Math.round((f.player1.x + f.player1.w + f.score1.x) / 2);
  ctx.fillStyle = '#2c2c2c';
  ctx.fillRect(dx, boxes.score.y + 3, 1, boxes.score.h - 6);
  return canvas;
}

