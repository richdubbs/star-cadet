/**
 * src/data/freeze.js
 * OWNER: DATA  (ARCHITECT-SEEDED, real code)
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * Deep-freeze helper used by every src/data/*.js file. Pure, Node-safe.
 */

/**
 * Recursively freezes plain objects/arrays and returns the same reference.
 * @template T
 * @param {T} o
 * @returns {Readonly<T>}
 */
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}
