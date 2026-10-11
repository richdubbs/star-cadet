/**
 * src/render/art/rng.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2
 * mulberry32(seed) -> Rand01. All ART randomness comes from here (paintAll derives one stream per painter from the seed, so the same seed
 * gives identical drawing operations).  Pure, no imports; tests/helpers/seeded_rand.mjs re-exports this function.
 */
/** @param {number} seed @returns {import('../../types.js').Rand01} */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
