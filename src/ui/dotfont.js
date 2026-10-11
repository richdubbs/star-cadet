/**
 * src/ui/dotfont.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.3; SPEC 6.3
 * GLYPHS: own 5x7 dot-matrix bitmaps for every ASCII 32..126 ('#' = lit dot, '.' = off; 7 rows of 5 chars), drawn by hand in the classic
 *         public-domain 5x7 style (no game bitmaps, no font files).
 * glyphFor(ch): the 7 rows for the first character of `ch` ('?' glyph for anything outside ASCII 32..126, null for a non-string/empty).
 * drawDotText(ctx, text, rect, opts): word-wraps `text` (wrapText) into the cols x rows lattice of cells and draws every lit dot as a small
 *         violet-blue LED (mid #7858e8, highlight #98c8f8 at the upper left, shade #282858 at the lower right). Unlit dots are invisible.
 *         Cell geometry: the 5x7 matrix is scaled into one cell (15x22 px for the digits, 11x22 px for the text boxes) with a one-dot gap
 *         column / row, so the dot pitch is cellW-gap over 5 columns and cellH-gap over 7 rows. Blank text draws nothing at all.
 *         With `opts.maxCols` a message that does not fit its cols x rows box (e.g. "Extra Ball Available\n250000" in the 2-row info box) is laid
 *         out on up to maxCols columns instead, i.e. with proportionally narrower cells, so its last line is not cut off (fitText).
 * Pure: touches only the 2D-context subset allowed by ARCHITECTURE.md 9.2 (save, restore, beginPath, moveTo, ellipse, fill, fillStyle), so it
 * runs unchanged against tests/helpers/fake_canvas.mjs. All drawing is deterministic (no randomness).
 *
 * ASSUMPTIONS: glyphs are centred inside their cell; alignment ('left' | 'right' | 'center') applies per line, in whole cells.
 */
import { fitText } from './textlayout.js';

/** One glyph per row-string "xxxxx xxxxx ..." (7 groups of 5). Parsed once below. */
const SOURCE = {
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '"': '.#.#. .#.#. .#.#. ..... ..... ..... .....',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '$': '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '%': '##... ##..# ...#. ..#.. .#... #..## ...##',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  '\'': '..#.. ..#.. .#... ..... ..... ..... .....',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '*': '..... ..#.. #.#.# .###. #.#.# ..#.. .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  '-': '..... ..... ..... ##### ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  '/': '..... ....# ...#. ..#.. .#... #.... .....',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '.###. #...# ....# ..##. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  ';': '..... .##.. .##.. ..... .##.. ..#.. .#...',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '@': '.###. #...# ....# .##.# #.#.# #.#.# .###.',
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '###.. #..#. #...# #...# #...# #..#. ###..',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# ##.## #...#',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# #...# .#.#. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '[': '.###. .#... .#... .#... .#... .#... .###.',
  '\\': '..... #.... .#... ..#.. ...#. ....# .....',
  ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
  '^': '..#.. .#.#. #...# ..... ..... ..... .....',
  _: '..... ..... ..... ..... ..... ..... #####',
  '`': '.#... ..#.. ...#. ..... ..... ..... .....',
  a: '..... ..... .###. ....# .#### #...# .####',
  b: '#.... #.... #.##. ##..# #...# #...# ####.',
  c: '..... ..... .###. #.... #.... #...# .###.',
  d: '....# ....# .##.# #..## #...# #...# .####',
  e: '..... ..... .###. #...# ##### #.... .###.',
  f: '..##. .#..# .#... ###.. .#... .#... .#...',
  g: '..... .#### #...# #...# .#### ....# .###.',
  h: '#.... #.... #.##. ##..# #...# #...# #...#',
  i: '..#.. ..... .##.. ..#.. ..#.. ..#.. .###.',
  j: '...#. ..... ..##. ...#. ...#. #..#. .##..',
  k: '#.... #.... #..#. #.#.. ##... #.#.. #..#.',
  l: '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  m: '..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#',
  n: '..... ..... #.##. ##..# #...# #...# #...#',
  o: '..... ..... .###. #...# #...# #...# .###.',
  p: '..... ####. #...# #...# ####. #.... #....',
  q: '..... .##.# #..## #...# .#### ....# ....#',
  r: '..... ..... #.##. ##..# #.... #.... #....',
  s: '..... ..... .#### #.... .###. ....# ####.',
  t: '.#... .#... ###.. .#... .#... .#..# ..##.',
  u: '..... ..... #...# #...# #...# #..## .##.#',
  v: '..... ..... #...# #...# #...# .#.#. ..#..',
  w: '..... ..... #...# #...# #.#.# #.#.# .#.#.',
  x: '..... ..... #...# .#.#. ..#.. .#.#. #...#',
  y: '..... #...# #...# #...# .#### ....# .###.',
  z: '..... ..... ##### ...#. ..#.. .#... #####',
  '{': '...#. ..#.. ..#.. .#... ..#.. ..#.. ...#.',
  '|': '..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  '}': '.#... ..#.. ..#.. ...#. ..#.. ..#.. .#...',
  '~': '..... ..... .#... #.#.# ...#. ..... .....',
};

/** @type {Record<string, string[]>} char -> 7 rows of 5 chars ('#' = dot) */
export const GLYPHS = Object.freeze(Object.fromEntries(
  Object.entries(SOURCE).map(([ch, rows]) => [ch, Object.freeze(rows.split(' '))]),
));

/** Colours of SPEC 6.3 (also PANEL.colors in the data barrel). */
const DOT_MID = '#7858e8';
const DOT_HI = '#98c8f8';
const DOT_SHADE = '#282858';
const TAU = Math.PI * 2;

/**
 * @param {string} ch  only the first character is looked at
 * @returns {readonly string[]|null} 7 rows of 5 chars
 */
export function glyphFor(ch) {
  if (typeof ch !== 'string' || ch.length === 0) return null;
  return GLYPHS[ch[0]] || GLYPHS['?'];
}

/**
 * Draw `text` as LED dots.
 * @param {any} ctx  2D context (CanvasLike subset)
 * @param {string} text  message ('\n' = line break; word-wrapped to cols x rows)
 * @param {{x:number, y:number, w?:number, h?:number}} rect  top-left of the lattice in canvas px
 * @param {{cellW?:number, cellH?:number, cols?:number, rows?:number, align?:'left'|'right'|'center', maxCols?:number,
 *          colors?:{mid?:string, hi?:string, shade?:string}}} [opts]   `maxCols` > `cols` lets a message that does not fit be drawn with narrower cells (fitText)
 * @returns {number} number of lit dots drawn (0 for blank text)
 */
export function drawDotText(ctx, text, rect, opts = {}) {
  const baseCellW = opts.cellW || 11;
  const cellH = opts.cellH || 22;
  const cols = opts.cols || Math.max(1, Math.floor((rect.w || baseCellW) / baseCellW));
  const rows = opts.rows || Math.max(1, Math.floor((rect.h || cellH) / cellH));
  const align = opts.align || 'left';
  const fit = fitText(text, cols, rows, opts.maxCols || cols);
  const lines = fit.lines;
  if (lines.length === 0) return 0;
  const usedCols = fit.cols;                                   // > cols when the message was condensed so that it fits the box
  const cellW = usedCols === cols ? baseCellW : (baseCellW * cols) / usedCols;

  const gapX = Math.max(1, Math.round(cellW * 0.12));
  const gapY = Math.max(1, Math.round(cellH * 0.05));
  const pitchX = (cellW - gapX) / 5;
  const pitchY = (cellH - gapY) / 7;
  const rx = pitchX * 0.44;
  const ry = pitchY * 0.44;
  const colors = opts.colors || {};

  /** @type {number[]} flat [cx, cy, ...] centres of every lit dot */
  const dots = [];
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    const startCol = align === 'right' ? usedCols - line.length : align === 'center' ? Math.floor((usedCols - line.length) / 2) : 0;
    const y0 = rect.y + r * cellH + gapY / 2;
    for (let c = 0; c < line.length; c++) {
      const glyph = glyphFor(line[c]);
      if (!glyph) continue;
      const x0 = rect.x + (startCol + c) * cellW + gapX / 2;
      for (let gy = 0; gy < 7; gy++) {
        const row = glyph[gy];
        for (let gx = 0; gx < 5; gx++) {
          if (row[gx] === '#') dots.push(x0 + (gx + 0.5) * pitchX, y0 + (gy + 0.5) * pitchY);
        }
      }
    }
  }
  if (dots.length === 0) return 0;

  ctx.save();
  // shade layer (lower right), then the mid-tone body (slightly up-left), then a small highlight at the upper left of each dot
  paintLayer(ctx, dots, colors.shade || DOT_SHADE, 0.12 * pitchX, 0.14 * pitchY, rx, ry);
  paintLayer(ctx, dots, colors.mid || DOT_MID, -0.04 * pitchX, -0.05 * pitchY, rx * 0.88, ry * 0.88);
  paintLayer(ctx, dots, colors.hi || DOT_HI, -0.16 * pitchX, -0.2 * pitchY, rx * 0.36, ry * 0.36);
  ctx.restore();
  return dots.length / 2;
}

/** One filled path holding an ellipse per dot (a single fill call per colour layer). */
function paintLayer(ctx, dots, color, dx, dy, rx, ry) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < dots.length; i += 2) {
    const cx = dots[i] + dx;
    const cy = dots[i + 1] + dy;
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  }
  ctx.fill();
}
