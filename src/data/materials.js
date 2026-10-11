/**
 * src/data/materials.js
 * OWNER: DATA  (ARCHITECT-SEEDED, real values)
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * SPEC 2.2. Keys are the DAT group numbers. Component defs already carry resolved {material, kicker} objects;
 * these tables exist for tests and for physics' own table-outline / ramp needs.
 */
import { deepFreeze } from './freeze.js';

export const DEFAULT_MATERIAL = deepFreeze({ smoothness: 0.95, elasticity: 0.6 });
/** threshold 8.9999999e10 = never a hard hit, boost 0. */
export const DEFAULT_KICKER = deepFreeze({ threshold: 8.9999999e10, boost: 0 });

/** @type {Readonly<Record<number, {smoothness:number, elasticity:number}>>} */
export const MATERIALS = deepFreeze({
  95:  { smoothness: 0.8, elasticity: 0.5 },   // ordinary walls, gates, blocker
  96:  { smoothness: 0.6, elasticity: 0.6 },   // round posts
  97:  { smoothness: 0.9, elasticity: 0.5 },   // slingshot rubbers 329/330, wormhole rubbers, shells 103/106
  98:  { smoothness: 0.9, elasticity: 0.8 },   // one-ways
  354: { smoothness: 0.5, elasticity: 0.75 },  // flippers
  503: { smoothness: 0.7, elasticity: 0.2 },   // kickbacks
});

/** @type {Readonly<Record<number, import('../types.js').Kicker>>} */
export const KICKERS = deepFreeze({
  99:  { threshold: 5.0, boost: 15, throwMult: 0.2, throwDir: [0, 1, 0], throwAngle: 0.1 },   // table outline (code forces boost 15)
  371: { threshold: 2.5, boost: 17 },                                                          // bumpers a_bump1-4
  404: { threshold: 2.5, boost: 12 },                                                          // bumpers a_bump5-7
  431: { threshold: 3.0, boost: 5 },                                                           // pop-up targets
  441: { threshold: 3.0, boost: 5 },                                                           // solo targets
  468: { threshold: 1.0, boost: 18 },                                                          // rebounders v_rebo1-4
  504: { threshold: 0, boost: 55 },                                                            // kickbacks (threshold value when ARMED)
  509: { threshold: 8.9999999e10, boost: 45, throwMult: 5, throwDir: [0, -1, 0], throwAngle: 1.256637 },  // a_kout1
  511: { threshold: 8.9999999e10, boost: 35, throwMult: 5, throwDir: [-1, 1, 0], throwAngle: 0 },         // a_kout2
  513: { threshold: 8.9999999e10, boost: 35, throwMult: 5, throwDir: [-1, -1, 0], throwAngle: 0 },        // a_kout3
  337: { threshold: 8.9999999e10, boost: 35, throwMult: 5, throwDir: [1, 1, 0], throwAngle: 0 },          // v_sink1
  339: { threshold: 8.9999999e10, boost: 35, throwMult: 5, throwDir: [1, -1, 0], throwAngle: 0 },         // v_sink2
  341: { threshold: 8.9999999e10, boost: 35, throwMult: 5, throwDir: [1, 1, 0], throwAngle: 0 },          // v_sink3
  343: { threshold: 8.9999999e10, boost: 35, throwMult: 5, throwDir: [0, -1, 0], throwAngle: 0 },         // v_sink7
});
