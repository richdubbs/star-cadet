/**
 * src/render/dmd.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: additive (the cabinet's dot-matrix display). Pure 2D-canvas drawing on an injected canvas factory; no three, no DOM at import time,
 * Node-importable (tests/cinematic.test.mjs draws it on the fake canvas).
 *
 * createDmd(createCanvas) -> {canvas, draw(view, time) -> boolean, text(view, time) -> string[]}: a 128 x 32 amber dot-matrix display (each dot
 * DMD.cell px) for the speaker panel of the backbox. The big line uses the 5x7 font stretched 2 x 3 (21 of the 32 rows). Screens (RulesView):
 *   idle / demo    "STAR CADET" (big) + a blinking "PRESS START" / "DEMO - PRESS F2"
 *   playing        the score (big, with thousands separators) | the info message (or the mission line), else "PLAYER n" .. "BALL n"
 *   tilted         "TILT" (big, blinking) | the score
 *   game over      "GAME OVER" (big) | the score
 * draw() repaints only when the visible text changed (returns true then), so the texture is re-uploaded only when needed.
 * Own 5x7 dot font (digits, A-Z, a little punctuation; lower case is shown in capitals, unknown characters as blanks).
 */

export const DMD = Object.freeze({ cols: 128, rows: 32, cell: 5 });

/** 5x7 glyphs: 7 rows of 5 bits (MSB = left column). */
const FONT = Object.freeze({
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2],
  5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  ' ': [0, 0, 0, 0, 0, 0, 0], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4], ':': [0, 12, 12, 0, 12, 12, 0], '/': [1, 2, 2, 4, 8, 8, 16], "'": [4, 4, 8, 0, 0, 0, 0], '+': [0, 4, 4, 31, 4, 4, 0],
  '%': [25, 26, 2, 4, 8, 11, 19], '#': [10, 31, 10, 10, 31, 10, 0], '*': [0, 21, 14, 31, 14, 21, 0],
});

/** Plain decimal with thousands separators (a negative score is blank). @param {number} n */
export function dmdScore(n) {
  if (!(n >= 0)) return '';
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Width in dots of a text line at `scale` (5-dot glyphs + 1 gap, x scale). @param {string} s @param {number} [scale=1] */
export function dmdWidth(s, scale = 1) {
  return s.length ? (s.length * 6 - 1) * scale : 0;
}

const clean = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim().toUpperCase();

/**
 * @param {(w:number, h:number)=>any} createCanvas
 */
export function createDmd(createCanvas) {
  const { cols, rows, cell } = DMD;
  const W = cols * cell, H = rows * cell;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  // sprites: one lit dot, and the dark grid of unlit dots (drawn once, copied on every repaint)
  const dot = createCanvas(cell, cell);
  {
    const g = dot.getContext('2d');
    const r = cell * 0.45, c = cell / 2;
    const grad = g.createRadialGradient(c - r * 0.2, c - r * 0.2, 0, c, c, r);
    grad.addColorStop(0, '#fff6d8');
    grad.addColorStop(0.5, '#ffb42a');
    grad.addColorStop(1, '#e06a00');
    g.fillStyle = grad;
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  }
  const grid = createCanvas(W, H);
  {
    const g = grid.getContext('2d');
    g.fillStyle = '#040100';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1a0c00';
    g.beginPath();
    const r = cell * 0.36;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { g.moveTo(x * cell + cell / 2 + r, y * cell + cell / 2); g.arc(x * cell + cell / 2, y * cell + cell / 2, r, 0, Math.PI * 2); }
    g.fill();
  }

  /** @type {Uint8Array} the lit dots of the current frame */
  const lit = new Uint8Array(cols * rows);
  const MARGIN = 2;
  /** Text at (x0, y0) with the glyphs stretched sx x sy dots per font dot. */
  function put(s, x0, y0, sx = 1, sy = sx) {
    let x = x0;
    for (const ch of s) {
      const glyph = FONT[ch] || FONT[' '];
      for (let gy = 0; gy < 7; gy++) {
        const bits = glyph[gy];
        for (let gx = 0; gx < 5; gx++) {
          if (!(bits & (16 >> gx))) continue;
          for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) {
            const px = x + gx * sx + dx, py = y0 + gy * sy + dy;
            if (px >= 0 && px < cols && py >= 0 && py < rows) lit[py * cols + px] = 1;
          }
        }
      }
      x += 6 * sx;
    }
  }
  const centre = (s, y, sx = 1, sy = sx) => put(s, Math.round((cols - dmdWidth(s, sx)) / 2), y, sx, sy);
  /** Shrink a line to the width of the display inside the margins (drops characters at the end). */
  const fit = (s, scale = 1) => { let t = s; while (t.length && dmdWidth(t, scale) > cols - 2 * MARGIN) t = t.slice(0, -1); return t; };

  /**
   * The text of the display for a view (stable for an unchanged screen; blinking items depend on `time`).
   * @param {any} v RulesView (or null) @param {number} [time=0] seconds
   * @returns {string[]} [kind, ...lines]
   */
  function text(v, time = 0) {
    const blink = Math.floor(time * 2) % 2 === 0;
    if (!v || v.phase === 'idle') return ['title', 'STAR CADET', blink ? 'PRESS START' : ''];
    if (v.demo) return ['title', 'STAR CADET', blink ? 'DEMO - PRESS F2' : ''];
    const score = dmdScore(v.score);
    if (v.tilted) return ['big', blink ? 'TILT' : '', score];
    if (v.phase === 'gameOver') return ['big', 'GAME OVER', score];
    const player = v.player > 0 ? `PLAYER ${v.player}` : '';
    let msg = clean(v.info) || clean(String(v.mission || '').split('\n')[0]);
    if (msg === player) msg = '';                                    // "Player 1" is already on the status line
    return msg ? ['play', '', '', score, msg] : ['play', player, v.ballNumber > 0 ? `BALL ${v.ballNumber}` : '', score, ''];
  }

  let last = '';
  return {
    canvas, text,
    /** Repaint for the view; true when the picture changed. @param {any} v @param {number} [time=0] */
    draw(v, time = 0) {
      const t = text(v, time);
      const key = t.join('|');
      if (key === last) return false;
      last = key;
      lit.fill(0);
      if (t[0] === 'title' || t[0] === 'big') {
        if (t[1]) centre(fit(t[1], 2), 1, 2, 3);
        if (t[2]) centre(fit(t[2]), 25);
      } else {
        const sc = dmdWidth(t[3], 2) <= cols - 2 * MARGIN ? t[3] : t[3].replace(/,/g, '');   // 9-digit scores drop the separators
        if (sc) centre(fit(sc, 2), 1, 2, 3);
        if (t[4]) centre(fit(t[4]), 25);
        else {
          if (t[1]) put(fit(t[1]), MARGIN, 25);
          if (t[2]) put(t[2], cols - MARGIN - dmdWidth(t[2]), 25);
        }
      }
      ctx.drawImage(grid, 0, 0);
      for (let i = 0; i < lit.length; i++) if (lit[i]) ctx.drawImage(dot, (i % cols) * cell, Math.floor(i / cols) * cell);
      return true;
    },
  };
}
