/**
 * src/physics/ramps.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4.3 (layers / ramps), 5.3 (rampEnter / rampExit / rampLine1); SPEC 3.5, 4.4 (ramp field), 4.10
 * Pure geometry for the launch ramp (18 planes) and the hidden tube (2 planes): plane records with the surface height and the plane
 * force, and the list of UN-INFLATED one-sided seam lines with the mask change each one performs (pass-through, ball not deflected).
 *
 *   plane seams    the three edges of every triangle (outward normals), mask 2, the ball takes the plane that owns the edge
 *   mouth seams    `enter` (mask 1 -> 2, takes the plane that owns the mouth edge), `enterUpper` (mask 4 -> 2)
 *   exit seams     `exit` (2 -> 1), `exitUpper` (2 -> 4), `exitFar` (tube far end, 2 -> 1)
 *   line 1         pure trigger for a mask-4 ball
 * A triangle edge that coincides with a mouth seam is NOT created a second time (in the original the mouth seam IS that edge with another
 * group), so a ball sitting on the mouth never meets a coincident mask-2 line.
 *
 * ASSUMPTIONS:
 *  - `exitFar` (data lists the wall1 order of the DAT) and `line1` are re-oriented so that a ball travelling along the tube chord /
 *    along the s_onewy12 pass direction hits them (the one-sided line only blocks a ray against its normal). `enter*`/`exit*` keep the data order.
 *  - The plane that owns a mouth seam is found by the nearest triangle-edge midpoint.
 *  - Surface height is clamped to the range of the plane vertex heights so a ball in the 0.3 rail margin never gets an extrapolated height.
 */
import { PHYS } from '../data/constants.js';

/**
 * @typedef {Object} Plane
 * @property {string} ramp @property {number} index @property {number} a @property {number} b @property {number} c
 * @property {number} fx @property {number} fy  plane force (u/s^2) @property {[number,number][]} v @property {number} zLo @property {number} zHi
 * @property {number} drag  extra drag coefficient while on this ramp (BallFieldMult 0.2)
 */
/**
 * @typedef {Object} Seam
 * @property {'plane'|'enter'|'enterUpper'|'exit'|'exitUpper'|'exitFar'|'line1'} kind
 * @property {[number,number]} p0 @property {[number,number]} p1 @property {number} mask  mask of the ball that can hit it
 * @property {number} newMask @property {Plane|null} plane
 */

/** Surface height of the plane at (x,y) (clamped to the plane's vertex height range). */
export function planeZ(plane, x, y) {
  const z = plane.a * x + plane.b * y + plane.c;
  return z < plane.zLo ? plane.zLo : z > plane.zHi ? plane.zHi : z;
}

/** Point in triangle (any winding). */
export function inTriangle(v, x, y) {
  const d1 = (x - v[1][0]) * (v[0][1] - v[1][1]) - (v[0][0] - v[1][0]) * (y - v[1][1]);
  const d2 = (x - v[2][0]) * (v[1][1] - v[2][1]) - (v[1][0] - v[2][0]) * (y - v[2][1]);
  const d3 = (x - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (y - v[0][1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Order p0,p1 so that a ray travelling along (dx,dy) hits the one-sided line (n = (dy,-dx) must oppose the ray). */
export function orientAgainst(p0, p1, dx, dy) {
  const ex = p1[0] - p0[0], ey = p1[1] - p0[1];
  const nx = ey, ny = -ex;
  return nx * dx + ny * dy < 0 ? [p0, p1] : [p1, p0];
}

const mid = (p0, p1) => [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];

/**
 * Build planes and seams of one ramp definition.
 * @param {import('../types.js').RampDef} def
 * @param {{pass?: [number,number]}} [hints] line1: unit pass direction of the coincident one-way (a ball travelling along it fires line 1)
 * @returns {{name:string, mask:number, planes:Plane[], seams:Seam[], zOffsetFlag:number, fieldMult:number, wallBallOffset:number}}
 */
export function buildRamp(def, hints = {}) {
  const scale = PHYS.rampForceScale;
  const planes = [];
  let zLo = Infinity, zHi = -Infinity;
  def.planes.forEach((p, i) => {
    for (const v of p.v) {
      const z = p.offset[0] * v[0] + p.offset[1] * v[1] + p.offset[2];
      if (z < zLo) zLo = z;
      if (z > zHi) zHi = z;
    }
    planes.push({
      ramp: def.name, index: i, a: p.offset[0], b: p.offset[1], c: p.offset[2],
      fx: scale * Math.sin(p.g1) * Math.cos(p.g2), fy: scale * Math.sin(p.g1) * Math.sin(p.g2), v: p.v.map((q) => [q[0], q[1]]),
      zLo: 0, zHi: 0, drag: def.fieldMult,
    });
  });
  for (const p of planes) { p.zLo = zLo; p.zHi = zHi; }

  /** triangle edges, oriented with outward normals */
  const triEdges = [];       // {plane, p0, p1, mid}
  for (const pl of planes) {
    const [a, b, c] = pl.v;
    const area = (a[0] * b[1] - b[0] * a[1] + b[0] * c[1] - c[0] * b[1] + c[0] * a[1] - a[0] * c[1]) / 2;
    const loop = area >= 0 ? [a, b, c] : [a, c, b];
    for (let i = 0; i < 3; i++) {
      const p0 = loop[i], p1 = loop[(i + 1) % 3];
      triEdges.push({ plane: pl, p0, p1, mid: mid(p0, p1), used: false });
    }
  }
  const owner = (seam) => {
    if (!seam) return null;
    const m = mid(seam.p0, seam.p1);
    let best = null, bd = Infinity;
    for (const te of triEdges) {
      const d = Math.hypot(te.mid[0] - m[0], te.mid[1] - m[1]);
      if (d < bd) { bd = d; best = te; }
    }
    if (best) best.used = true;                // replaced by the mouth seam
    return best ? best.plane : null;
  };

  /** @type {Seam[]} */
  const seams = [];
  const enterPlane = owner(def.enter);
  const upperPlane = owner(def.enterUpper);
  for (const te of triEdges) {
    if (!te.used) seams.push({ kind: 'plane', p0: te.p0, p1: te.p1, mask: def.mask, newMask: def.mask, plane: te.plane });
  }
  const add = (kind, s, plane, p0 = s.p0, p1 = s.p1) => seams.push({ kind, p0, p1, mask: s.ballMask, newMask: s.newMask, plane });
  if (def.enter) add('enter', def.enter, enterPlane);
  if (def.enterUpper) add('enterUpper', def.enterUpper, upperPlane);
  if (def.exit) add('exit', def.exit, null);
  if (def.exitUpper) add('exitUpper', def.exitUpper, null);
  if (def.exitFar) {
    // the ball arrives from the mouth: travelling direction = from the mouth centre to the far seam centre
    const from = def.enter ? mid(def.enter.p0, def.enter.p1) : mid(def.planes[0].v[0], def.planes[0].v[1]);
    const to = mid(def.exitFar.p0, def.exitFar.p1);
    const [p0, p1] = orientAgainst(def.exitFar.p0, def.exitFar.p1, to[0] - from[0], to[1] - from[1]);
    add('exitFar', def.exitFar, null, p0, p1);
  }
  if (def.line1) {
    const pass = hints.pass || [0.826529, 0.562895];
    const [p0, p1] = orientAgainst(def.line1.p0, def.line1.p1, pass[0], pass[1]);
    add('line1', def.line1, null, p0, p1);
  }
  return {
    name: def.name, mask: def.mask, planes, seams, zOffsetFlag: def.zOffsetFlag, fieldMult: def.fieldMult, wallBallOffset: def.wallBallOffset,
  };
}
