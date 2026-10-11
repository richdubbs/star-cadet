/**
 * src/ui/panel.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.3; SPEC 6.2 / 6.3
 * createPanel({canvas, art, data, scale}) -> {update(view), repaint(view), ariaText(view), lastAria(), setScale(n), getScale()}
 *
 * The scoreboard panel. `canvas` is the 203x394 #panel-canvas (any CanvasLike), `art` the static ArtPack.panel canvas (bezel, three black
 * boxes, logo, the printed word BALL; no digits). The static art is drawn once at creation; afterwards update(view) repaints (art + dots)
 * ONLY when view.revision changed since the last repaint, and returns true when it did (so the facade can refresh #panel-aria in the same step).
 *
 * Field rectangles come from PANEL.fields (panel-local px): score1 = 9 right-aligned cells of 15 px, player1 and ball1 = one 15x22 digit,
 * info = 15 x 2 cells, mission = 15 x 4 cells (text cell 11x22). Score text is formatScore(view.score) (plain decimal, blank when negative,
 * suppressed above 1,000,000,000 - SPEC 6.2); the player digit is blank in phase 'idle'; the ball digit is blank when ballNumber is 0.
 *
 * Resolution: the logical panel is 203x394 but it is shown 1.5x - 4x larger on a typical screen, so the canvas backing store can be made
 * `scale` times bigger (setScale(n), 1..4; the facade picks n from the CSS size and devicePixelRatio): the static art is stretched, the
 * dots are drawn at full resolution (ctx.scale) and stay crisp. scale 1 (the default, and always in Node) is the plain 203x394 canvas.
 * The two text boxes use fitText: a message that does not fit its 15 x 2 / 15 x 4 cells (e.g. "Extra Ball Available
250000") is condensed to up
 * to 22 columns instead of losing its last line.
 *
 * If no art canvas is available a plain bezel with three black boxes is drawn instead, so the panel stays usable.
 * Only the 2D-context subset of ARCHITECTURE.md 9.2 is used. Importable in Node (no DOM at import time).
 *
 * ASSUMPTIONS: the whole panel is repainted (static art + dots) on a revision change instead of erasing single boxes: 203x394 is tiny and
 * it cannot leave stale dots even if ART's boxes are not pure black.
 */
import { PANEL } from '../data/constants.js';
import { drawDotText } from './dotfont.js';
import { formatScore } from './format.js';

/**
 * Text a screen reader gets for the panel: "Player N, ball B, score S. <info> <mission>" ('\n' becomes a space).
 * @param {import('../types.js').RulesView} view @returns {string}
 */
export function panelAriaText(view) {
  if (!view) return '';
  const bits = [];
  if (view.phase !== 'idle' && view.player > 0) bits.push('Player ' + view.player);
  if (view.ballNumber > 0) bits.push('ball ' + view.ballNumber);
  const score = formatScore(view.score);
  if (score !== '') bits.push('score ' + score);
  let out = bits.join(', ');
  if (out) out = out.charAt(0).toUpperCase() + out.slice(1) + '.';
  const flat = (/** @type {any} */ s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
  for (const part of [flat(view.info), flat(view.mission)]) if (part) out += (out ? ' ' : '') + part;
  return out;
}

/**
 * Plain-text version of the scoreboard for the phone-portrait layout (css/ui.css "portrait HUD": the table gets the full width and the scoreboard canvas
 * is replaced by a few lines of text under it): {head:"Player 1 - Ball 2", score:"748750", info, mission}; line breaks in the messages become spaces.
 * @param {import('../types.js').RulesView} view @returns {{head:string, score:string, info:string, mission:string}}
 */
export function panelHudParts(view) {
  const flat = (/** @type {any} */ s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
  if (!view) return { head: '', score: '', info: '', mission: '' };
  const idle = view.phase === 'idle';
  const bits = [];
  if (!idle && view.player > 0) bits.push('Player ' + view.player);
  if (view.ballNumber > 0) bits.push('Ball ' + view.ballNumber);
  return {
    head: idle ? 'Star Cadet Pinball' : bits.join(' - '),
    score: view.score > 1e9 ? '' : formatScore(view.score),
    info: flat(view.info),
    mission: flat(view.mission),
  };
}

/** The widest condensed layout (columns) the two text boxes may use for a message that does not fit (cell 165 / 22 = 7.5 px). */
export const MAX_CONDENSED_COLS = 22;

/**
 * Canvas scale factor for a panel shown `cssWidth` CSS px wide on a screen with `dpr` device pixels per CSS px.
 * @param {number} cssWidth @param {number} dpr @param {number} [baseWidth] logical panel width (203)
 * @returns {number} integer 1..4
 */
export function panelScaleFor(cssWidth, dpr, baseWidth = PANEL.rect.w) {
  const px = Number(cssWidth) * (Number(dpr) > 0 ? Number(dpr) : 1);
  if (!(px > 0) || !(baseWidth > 0)) return 1;
  return Math.max(1, Math.min(4, Math.ceil(px / baseWidth - 0.25)));
}

/**
 * @param {{canvas:any, art?:any, data?:{PANEL?:typeof PANEL}, scale?:number}} opts
 * @returns {{update:(view:import('../types.js').RulesView)=>boolean, repaint:(view:import('../types.js').RulesView)=>void,
 *            ariaText:(view:import('../types.js').RulesView)=>string, lastAria:()=>string, setScale:(n:number)=>boolean, getScale:()=>number}}
 */
export function createPanel(opts) {
  const { canvas, art } = opts || {};
  const P = (opts && opts.data && opts.data.PANEL) || PANEL;
  const F = P.fields;
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  let scale = clampScale(opts && opts.scale);
  if (canvas && canvas.width !== P.rect.w * scale) canvas.width = P.rect.w * scale;
  if (canvas && canvas.height !== P.rect.h * scale) canvas.height = P.rect.h * scale;
  /** @type {import('../types.js').RulesView|null} */
  let lastView = null;

  let painted = false;
  /** @type {number|undefined} */
  let lastRevision;
  let aria = '';

  function paintStatic() {
    if (!ctx) return;
    if (art) {
      if (scale === 1) ctx.drawImage(art, 0, 0);
      else ctx.drawImage(art, 0, 0, P.rect.w * scale, P.rect.h * scale);
      return;
    }
    // fallback: bezel + the three black boxes (field rect expanded by 4 px, the score row box by 5 px)
    if (scale !== 1) { ctx.save(); ctx.scale(scale, scale); }
    ctx.fillStyle = P.colors.bezel;
    ctx.fillRect(0, 0, P.rect.w, P.rect.h);
    ctx.fillStyle = P.colors.black;
    const box = (x, y, w, h, m) => ctx.fillRect(x - m, y - m, w + 2 * m, h + 2 * m);
    box(F.player1.x, F.score1.y, F.score1.x + F.score1.w - F.player1.x, F.score1.h, 5);
    box(F.info.x, F.info.y, F.info.w, F.info.h, 4);
    box(F.mission.x, F.mission.y, F.mission.w, F.mission.h, 4);
    if (scale !== 1) ctx.restore();
  }

  /** @param {import('../types.js').RulesView} view */
  function paintDynamic(view) {
    if (!ctx) return;
    if (scale !== 1) { ctx.save(); ctx.scale(scale, scale); }       // dots are drawn in logical px, at the full backing resolution
    const score = view.score > 1e9 ? '' : formatScore(view.score);
    drawDotText(ctx, score, F.score1, { cellW: F.score1.cellW, cellH: F.score1.h, cols: F.score1.cells, rows: 1, align: 'right' });
    const player = view.phase !== 'idle' && view.player > 0 ? String(view.player) : '';
    drawDotText(ctx, player, F.player1, { cellW: F.player1.w, cellH: F.player1.h, cols: 1, rows: 1 });
    const ball = view.ballNumber > 0 ? String(view.ballNumber) : '';
    drawDotText(ctx, ball, F.ball1, { cellW: F.ball1.w, cellH: F.ball1.h, cols: 1, rows: 1 });
    drawDotText(ctx, view.info, F.info, { cellW: F.info.cellW, cellH: F.info.cellH, cols: F.info.cols, rows: F.info.rows, maxCols: MAX_CONDENSED_COLS });
    drawDotText(ctx, view.mission, F.mission, { cellW: F.mission.cellW, cellH: F.mission.cellH, cols: F.mission.cols, rows: F.mission.rows, maxCols: MAX_CONDENSED_COLS });
    if (scale !== 1) ctx.restore();
  }

  paintStatic();

  /** @param {import('../types.js').RulesView} view */
  function repaint(view) {
    paintStatic();
    paintDynamic(view);
    painted = true;
    lastRevision = view.revision;
    lastView = view;
    aria = panelAriaText(view);
  }

  return {
    update(view) {
      if (!view) return false;
      if (painted && view.revision === lastRevision) return false;
      repaint(view);
      return true;
    },
    repaint,
    ariaText: panelAriaText,
    lastAria: () => aria,
    /**
     * Change the backing-store resolution (1..4 x the logical 203x394). Resizing a canvas clears it, so the panel is repainted at once
     * (static art + the last view, or just the art before the first view). Returns true when the scale changed.
     * @param {number} n
     */
    setScale(n) {
      const next = clampScale(n);
      if (next === scale) return false;
      scale = next;
      if (canvas) { canvas.width = P.rect.w * scale; canvas.height = P.rect.h * scale; }
      if (lastView) repaint(lastView); else paintStatic();
      return true;
    },
    getScale: () => scale,
  };
}

/** @param {any} n @returns {number} an integer 1..4 */
function clampScale(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(4, v)) : 1;
}
