/**
 * src/render/convert.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1; SPEC 1.2
 * T-frame <-> Three.js axes. three.x = -t.x, three.y = t.z, three.z = t.y. A T-frame CCW angle a = mesh.rotation.y = +a.
 * The mapping is a PROPER rotation (determinant +1, no mirroring), so triangle winding is preserved by it.
 * Pure (no three import): usable in Node tests.
 * ASSUMPTIONS: none beyond the SPEC; extra helpers below are additive (rotYOfDir, lerp/clamp utilities used by the scene code).
 */

/** @returns {[number, number, number]} Three.js [x, y, z] for a T-frame point/direction */
export function t2v(x, y, z = 0) { return [-x, z, y]; }

/** @returns {[number, number, number]} T-frame [x, y, z] for a Three.js point (same mapping, it is an involution) */
export function v2t(x, y, z) { return [-x, z, y]; }

/** T-frame CCW angle -> Three.js rotation.y */
export function angleToRotY(a) { return a; }

/** T-frame CCW angle (rad) of the direction (dx, dy): the `a` such that rotating T-frame +x by `a` gives (dx, dy) / |d|. */
export function rotYOfDir(dx, dy) { return Math.atan2(dy, dx); }

/** Clamp helper shared by the scene modules. */
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Linear interpolation. */
export function lerp(a, b, t) { return a + (b - a) * t; }

/** Exponential approach of `cur` to `target` with time constant `tau` seconds, for a frame of `dt` seconds (frame-rate independent). */
export function approach(cur, target, dt, tau) {
  if (tau <= 0) return target;
  return target + (cur - target) * Math.exp(-dt / tau);
}

/** Linear (constant speed) approach: moves `cur` towards `target` by at most `rate * dt`. */
export function slew(cur, target, dt, rate) {
  const d = target - cur;
  const m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
}
