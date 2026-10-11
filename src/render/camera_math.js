/**
 * src/render/camera_math.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1; SPEC 1.3-1.4
 * Pure camera maths (no three import): the ORIGINAL camera pose, the view-offset window for a canvas, projection checkpoints and the
 * extra debug-camera framing helpers. Everything here is unit-tested without WebGL (tests/render.test.mjs).
 *
 * Original camera (SPEC 1.4): pure 24 degree pitch, focal length 400.000702 px, principal point (183, 238) inside a visible window of
 * 365 x 416 px. In Three.js axes: position (0, 21.0, 13.5), forward (0, -0.913545, -0.406737), up (0, 0.406737, -0.913545).
 * Recipe: PerspectiveCamera(61.505, 366/476, 0.5, 120) + setViewOffset(366 S, 476 S, x, y, w, h) with S = canvasWidth / 365.
 *
 * ASSUMPTIONS:
 *  - viewOffsetFor(canvasWidthPx) is the contract function (canvas aspect exactly 365:416). viewOffsetForSize() is the general version used
 *    by the renderer: it scales by S = min(w/365, h/416) and CENTRES the 365x416 window inside the canvas (a canvas of a different aspect
 *    just shows a little more of the cabinet), and adds the nudge shake (px at 365-px width, +x = image shifts right, +y = image shifts down).
 */
import { CAMERA, TABLE, projectToTablePx } from '../data/constants.js';

/** Constants of the original camera, in Three.js axes where noted. */
export const ORIGINAL_CAMERA = Object.freeze({
  fovDeg: CAMERA.fovDeg,                    // 61.505 = 2 atan(238 / 400.000702)
  aspect: 366 / 476,                        // aspect of the symmetric full frame (never overwritten on resize)
  near: CAMERA.near, far: CAMERA.far,
  fullW: CAMERA.fullFrame[0], fullH: CAMERA.fullFrame[1],   // 366 x 476
  winW: CAMERA.viewport[0], winH: CAMERA.viewport[1],       // 365 x 416
  position: Object.freeze([0, 21.0, 13.5]),                 // Three.js axes
  up: Object.freeze([0, 0.406737, -0.913545]),              // Three.js axes
  forward: Object.freeze([0, -0.913545, -0.406737]),        // Three.js axes
  focalPx: -CAMERA.D,
});

/**
 * Arguments of camera.setViewOffset for a canvas of the contract aspect (365:416).
 * @param {number} canvasWidthPx
 * @returns {{fullW:number, fullH:number, x:number, y:number, w:number, h:number}}
 */
export function viewOffsetFor(canvasWidthPx) {
  const S = canvasWidthPx / ORIGINAL_CAMERA.winW;
  return { fullW: ORIGINAL_CAMERA.fullW * S, fullH: ORIGINAL_CAMERA.fullH * S, x: 0, y: 0, w: ORIGINAL_CAMERA.winW * S, h: ORIGINAL_CAMERA.winH * S };
}

/**
 * General view-offset window for any canvas size (CSS pixels), centring the 365x416 window and applying the nudge shake.
 * @param {number} cssW @param {number} cssH
 * @param {{x:number,y:number}} [shake]  image shift in original px at 365-px width (+x right, +y down)
 * @returns {{fullW:number, fullH:number, x:number, y:number, w:number, h:number, S:number}}
 */
export function viewOffsetForSize(cssW, cssH, shake) {
  const S = Math.min(cssW / ORIGINAL_CAMERA.winW, cssH / ORIGINAL_CAMERA.winH);
  const sx = shake ? shake.x : 0;
  const sy = shake ? shake.y : 0;
  return {
    fullW: ORIGINAL_CAMERA.fullW * S, fullH: ORIGINAL_CAMERA.fullH * S,
    x: -(cssW - ORIGINAL_CAMERA.winW * S) / 2 - sx * S,
    y: -(cssH - ORIGINAL_CAMERA.winH * S) / 2 - sy * S,
    w: cssW, h: cssH, S,
  };
}

/**
 * Project a T-frame point with the ORIGINAL camera to table-bitmap pixels (SPEC 1.3), 365-px-wide image space.
 * @returns {[number, number]}
 */
export function projectPoint(x, y, z = 0) { return projectToTablePx(x, y, z); }

/**
 * Table-bitmap pixel -> canvas pixel for a canvas described by a viewOffsetForSize() result (no shake needed: it is inside `off`).
 * @param {number} px @param {number} py @param {{x:number,y:number,S:number}} off @returns {[number, number]}
 */
export function bitmapPxToCanvas(px, py, off) { return [px * off.S - off.x, py * off.S - off.y]; }

/**
 * Orthographic framing of the whole playfield for the 'top' debug camera.
 * @param {number} aspect canvas width / height
 * @param {number} [margin=0.5] extra table units around the playfield
 * @returns {{left:number, right:number, top:number, bottom:number, centerX:number, centerY:number}} extents in table units around the table centre;
 *          `top`/`bottom` run along the T-frame y axis (top = table top y = yMin).
 */
export function topViewBounds(aspect, margin = 0.5) {
  const needW = TABLE.width + 2 * margin;
  const needH = TABLE.height + 2 * margin;
  let w = needW, h = needH;
  if (aspect >= needW / needH) w = h * aspect; else h = w / aspect;
  return { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2, centerX: TABLE.centerX, centerY: TABLE.centerY };
}
