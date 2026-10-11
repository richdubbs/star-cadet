/**
 * tests/helpers/seeded_rand.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * Deterministic Rand01 sources for tests. Use these instead of Math.random everywhere in tests.
 */
export { mulberry32 } from '../../src/render/art/rng.js';

/** A Rand01 that always returns v (0.5 removes the physics lateral jitter term: (0.5 - rand01) = 0). */
export function constantRand(v = 0.5) {
  return () => v;
}

/** A Rand01 that replays the given numbers cyclically. */
export function sequenceRand(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
