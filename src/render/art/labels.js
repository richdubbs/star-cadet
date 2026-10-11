/**
 * src/render/art/labels.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2 / SPEC 6.8 (composition), ui.md L5/L7 (the original prints no words except the apron credits; our own
 * wording is allowed).  The painted words of the table: lane / target-bank labels (RE-ENTRY, HYPERSPACE, FUEL, MEDAL, MISSION, BOOSTER,
 * SKILL SHOT, LAUNCH) and the nine rank names around the central emblem, all drawn with the original stroke alphabet of font.js.
 * LABELS is exported data so tests can prove that no label sits on a wall island, under the deck or on top of another label.
 * Positions are T-frame (x = +8 at the screen LEFT); `angle` is a screen rotation in DEGREES, clockwise (0 = reads left to right,
 * -90 = reads bottom to top).  `size` = cap height in table units.
 */
import { rgba } from './draw.js';
import { drawLetters, drawLettersOnArc, screenAt, textWidth } from './font.js';
import { EMBLEM } from './decals.js';

/**
 * @typedef {{id:string, text:string, x:number, y:number, angle:number, size:number, tracking:number, patch:'floor'|'deck', color:string}} Label
 * @type {ReadonlyArray<Label>}
 */
export const LABELS = Object.freeze([
  { id: 'reentry', text: 'RE-ENTRY', x: -0.3, y: -8.75, angle: 0, size: 0.3, tracking: 0.3, patch: 'floor', color: '#8fb0e0' },
  // (the old spot, y -11.55 right behind the wall-296 housing, was hidden by that 0.85-high wall from the original camera: only "HYPERSP" showed)
  { id: 'hyperspace', text: 'HYPERSPACE', x: -1.5, y: -8.0, angle: 0, size: 0.24, tracking: 0.3, patch: 'floor', color: '#8fb0e0' },
  { id: 'fuel', text: 'FUEL', x: 5.3, y: -9.35, angle: 0, size: 0.3, tracking: 0.3, patch: 'floor', color: '#d8d070' },
  { id: 'medal', text: 'MEDAL', x: -0.55, y: -1.45, angle: 0, size: 0.3, tracking: 0.3, patch: 'floor', color: '#8fb0e0' },
  { id: 'mission', text: 'MISSION', x: 3.15, y: 4.0, angle: -90, size: 0.28, tracking: 0.3, patch: 'floor', color: '#8fb0e0' },
  { id: 'booster', text: 'BOOSTER', x: -2.62, y: 2.65, angle: 90, size: 0.22, tracking: 0.3, patch: 'floor', color: '#8fb0e0' },
  { id: 'skillshot', text: 'SKILL SHOT', x: -6.93, y: -0.78, angle: -90, size: 0.24, tracking: 0.3, patch: 'floor', color: '#f4e2b8' },
  { id: 'launch', text: 'LAUNCH', x: -7.02, y: 9.2, angle: -90, size: 0.34, tracking: 0.3, patch: 'floor', color: '#f4e2b8' },
  // (the old spot, 6.25 / 3.0 reading left to right, was half covered by the drum of launch bumper a_bump6; standing between the two bumpers it is fully visible)
  { id: 'launchlanes', text: 'LAUNCH', x: 6.2, y: 3.35, angle: -90, size: 0.24, tracking: 0.3, patch: 'deck', color: '#d8c8f0' },
]);

/** Screen angles (degrees clockwise from the top) of the 9 middle-ring (rank) lamps, SPEC App. A ring parametrisation. */
export const RANK_RING = Object.freeze({
  radius: 3.0,
  size: 0.19,
  tracking: 0.28,
  angles: Object.freeze([348, 30, 72, 105, 149, 190, 235, 272, 310]),
});

/** World-space (T-frame) rectangle of a label: centre, half extents of the rotated box and its four corners. */
export function labelBox(l) {
  const w = textWidth(l.text, l.size, l.tracking), h = l.size;
  const a = (l.angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  // local screen frame: x right (= T -x), y down (= T +y); rotate clockwise by a
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([lx, ly]) => {
    const sx = lx * c - ly * s, sy = lx * s + ly * c;
    return [l.x - sx, l.y + sy];
  });
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  return { corners, xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
}

function drawLabel(ctx, l) {
  screenAt(ctx, l.x, l.y, (l.angle * Math.PI) / 180, () => {
    drawLetters(ctx, l.text, l.size, {
      weight: 0.17, tracking: l.tracking, fill: rgba(l.color, 0.78), outline: { color: rgba('#050814', 0.65), width: 0.022 },
    });
  });
}

/**
 * Paints the labels of one texture (ctx already inside tableSpace().enter()).  For 'floor' it also paints the rank-name ring.
 * @param {*} ctx
 * @param {'floor'|'deck'} [which]
 * @param {{RANK_NAMES?:string[]}} [data]
 */
export function paintLabels(ctx, which = 'floor', data = undefined) {
  for (const l of LABELS) if (l.patch === which) drawLabel(ctx, l);
  if (which === 'floor') {
    const names = data?.RANK_NAMES;
    if (!names) return;
    screenAt(ctx, EMBLEM.x, EMBLEM.y, 0, () => {
      names.forEach((name, i) => {
        const deg = RANK_RING.angles[i];
        if (deg === undefined) return;
        const a = -Math.PI / 2 + (deg * Math.PI) / 180;
        const lower = Math.sin(a) > 0.15; // lower half: stand the letters upright
        drawLettersOnArc(ctx, name.toUpperCase(), RANK_RING.radius, a, RANK_RING.size, {
          tracking: RANK_RING.tracking, weight: 0.17, fill: rgba('#9db8e8', 0.7), inside: lower, outline: { color: rgba('#050814', 0.55), width: 0.015 },
        });
      });
    });
  }
}
